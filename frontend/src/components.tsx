import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Globe, Search, ArrowUpRight } from "lucide-react";
import {
  api,
  filterApps,
  launch,
  appHostname,
  type Application,
  type Category,
} from "./lib";
import { icons } from "./builtinIcons";
import { serviceIconUrl } from "./serviceIcons";
export function Icon({
  app,
}: {
  app: Pick<Application, "icon" | "url" | "name"> &
    Partial<Pick<Application, "icon_color">>;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [app.icon, app.url]);
  const Builtin = icons[app.icon.replace("builtin:", "")] ?? Globe;
  const serviceSrc = serviceIconUrl(app.icon);
  let src = serviceSrc || (app.icon.startsWith("/uploads/") ? app.icon : "");
  if (app.icon === "favicon") {
    try {
      src = new URL("/favicon.ico", app.url).href;
    } catch {
      src = "";
    }
  }
  return (
    <span
      className="app-icon"
      data-icon-color={app.icon_color ?? "auto"}
      data-service-icon={!!serviceSrc && !failed}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Builtin size={23} strokeWidth={1.7} />
      )}
    </span>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={wide ? "wide" : ""}>
        <div className="dialog-heading">
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {description ?? "Manage your HomeGrid."}
            </DialogDescription>
          </div>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p className="error" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}
export function CommandPalette({
  apps,
  categories,
  onClose,
  webSearch,
}: {
  apps: Application[];
  categories: Category[];
  onClose: () => void;
  /** Returns the web search address for a query while web search is on. */
  webSearch?: (query: string) => string | undefined;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const results = filterApps(apps, categories, query);
  const searchUrl = webSearch?.(query);
  // The web search is the last option after every matching application.
  const optionCount = results.length + (searchUrl ? 1 : 0);
  const selectedIndex = Math.max(0, Math.min(selected, optionCount - 1));
  const activeId =
    selectedIndex < results.length
      ? results[selectedIndex]
        ? "result-" + results[selectedIndex].id
        : undefined
      : "result-web";
  const searchWeb = () => {
    if (!searchUrl) return;
    window.open(searchUrl, "_blank", "noopener,noreferrer");
    onClose();
  };
  useEffect(() => {
    if (activeId)
      document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, query, apps]);
  return (
    <Modal
      title="Find an application"
      description="Search your services by name, description, or category."
      onClose={onClose}
    >
      <div className="palette-search">
        <Search size={20} />
        <input
          autoFocus
          aria-label="Search applications"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={activeId}
          placeholder="Where would you like to go?"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.max(0, Math.min(i + 1, optionCount - 1)));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && results[selectedIndex]) {
              launch(results[selectedIndex]);
              onClose();
            } else if (e.key === "Enter" && activeId === "result-web") {
              searchWeb();
            }
          }}
        />
      </div>
      <div className="search-results" role="listbox" id="search-results">
        {results.map((app, i) => (
          <button
            role="option"
            aria-selected={selectedIndex === i}
            id={"result-" + app.id}
            className={"search-result " + (selectedIndex === i ? "active" : "")}
            key={app.id}
            onMouseMove={() => setSelected(i)}
            onClick={() => {
              launch(app);
              onClose();
            }}
          >
            <Icon app={app} />
            <span>
              <strong>{app.name}</strong>
              <small>
                {app.description || appHostname(app.url)} ·{" "}
                {categories.find((c) => c.id === app.category_id)?.name}
              </small>
            </span>
            <ArrowUpRight size={17} />
          </button>
        ))}
        {searchUrl && (
          <button
            role="option"
            aria-selected={activeId === "result-web"}
            id="result-web"
            className={
              "search-result web-search " +
              (activeId === "result-web" ? "active" : "")
            }
            onMouseMove={() => setSelected(results.length)}
            onClick={searchWeb}
          >
            <span className="web-search-icon" aria-hidden="true">
              <Globe size={20} />
            </span>
            <span>
              <strong>Search the web for “{query.trim()}”</strong>
              <small>{new URL(searchUrl).hostname}</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
        )}
        {results.length === 0 && !searchUrl && (
          <div className="search-empty">
            <Search size={24} />
            <h3>No applications found</h3>
            <p>Try a different name or category.</p>
          </div>
        )}
      </div>
      <div className="palette-hint">
        <span>↑ ↓ to navigate</span>
        <span>↵ to open · esc to close</span>
      </div>
    </Modal>
  );
}
export function CategoryForm({
  category,
  onSave,
  onClose,
}: {
  category?: Category;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? ""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) {
          setError("Enter a category name.");
          return;
        }
        setBusy(true);
        try {
          await onSave(name.trim());
          onClose();
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Category name
        <input
          autoFocus
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Media & entertainment"
        />
      </label>
      <ErrorMessage error={error} />
      <div className="dialog-footer">
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : category ? "Save category" : "Create category"}
        </button>
      </div>
    </form>
  );
}
export async function saveApp(
  data: Omit<Application, "id" | "sort_order">,
  app?: Application,
) {
  await api("/apps" + (app ? "/" + app.id : ""), app ? "PATCH" : "POST", data);
}
