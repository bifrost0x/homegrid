import {
  useEffect,
  useState,
  useRef,
  useId,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import {
  Globe,
  Upload,
  Search,
  ArrowUpRight,
  Check,
  ChevronDown,
  Layers,
} from "lucide-react";
import {
  api,
  appSchema,
  filterApps,
  launch,
  upload,
  appHostname,
  duplicateName,
  suggestAppName,
  faviconPreviewUrl,
  isExampleApp,
  type IconColor,
  type Application,
  type Category,
} from "./lib";
import {
  icons,
  findTemplates,
  serviceCategories,
  serviceTemplates,
  type ServiceTemplate,
} from "./catalog";
import { serviceIconUrl, serviceIcons } from "./serviceIcons";
import { detectService, type DetectedService } from "./serviceDetection";
import { IconPicker } from "./IconPicker";
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
      data-service-icon={!!serviceSrc}
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
export function ApplicationForm({
  app,
  categories,
  onSave,
  onClose,
  initialCategory,
  duplicate,
}: {
  app?: Application;
  duplicate?: Application;
  initialCategory?: number;
  categories: Category[];
  onSave: (
    data: Omit<Application, "id" | "sort_order">,
    newCategory?: string,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const source = app ?? duplicate;
  const [name, setName] = useState(
      duplicate ? duplicateName(duplicate.name) : (app?.name ?? ""),
    ),
    [url, setUrl] = useState(
      source && isExampleApp(source) ? "" : (source?.url ?? ""),
    ),
    [previewUrl, setPreviewUrl] = useState(() =>
      faviconPreviewUrl(source?.url ?? ""),
    ),
    [description, setDescription] = useState(
      source && isExampleApp(source)
        ? (serviceTemplates.find((template) => template.icon === source.icon)
            ?.description ?? "")
        : (source?.description ?? ""),
    ),
    [category, setCategory] = useState(
      source?.category_id ?? initialCategory ?? 1,
    ),
    [icon, setIcon] = useState(source?.icon ?? "favicon"),
    [iconColor, setIconColor] = useState<IconColor>(
      source?.icon_color ?? "auto",
    ),
    [newTab, setNewTab] = useState(source?.open_in_new_tab ?? true),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const [templatesOpen, setTemplatesOpen] = useState(false),
    [templateSearch, setTemplateSearch] = useState("");
  const [templateCategory, setTemplateCategory] = useState("");
  const templatesId = useId();
  const urlInput = useRef<HTMLInputElement>(null);
  const [suggestedCategory, setSuggestedCategory] = useState("");
  // Automatic recognition only runs for new applications and stops for good
  // once the user picks an icon or a template themselves.
  const recognizes = !app && !duplicate;
  const [iconChosen, setIconChosen] = useState(false);
  const [recognized, setRecognized] = useState<{
    service: DetectedService;
    previousIcon: string;
  }>();
  function chooseIcon(next: string) {
    setIconChosen(true);
    setRecognized(undefined);
    setIcon(next);
  }
  function recognize(nextName: string, nextUrl: string) {
    if (!recognizes || iconChosen) return;
    const service = detectService(nextName, nextUrl);
    if (service) {
      if (service.id !== recognized?.service.id) setIcon(service.icon);
      setRecognized({
        service,
        previousIcon: recognized?.previousIcon ?? icon,
      });
    } else if (recognized) {
      setIcon(recognized.previousIcon);
      setRecognized(undefined);
    }
  }
  function keepPreviousIcon() {
    if (recognized) chooseIcon(recognized.previousIcon);
  }
  const matches = findTemplates(templateSearch).filter(
    (template) => !templateCategory || template.category === templateCategory,
  );
  function selectTemplate(template: ServiceTemplate) {
    setName(template.name);
    setDescription(template.description);
    chooseIcon(template.icon);
    setIconColor(template.icon_color);
    const matchingCategory = categories.find(
      (category) =>
        category.name.toLocaleLowerCase() ===
        template.category.toLocaleLowerCase(),
    );
    setSuggestedCategory(template.category);
    setCategory(matchingCategory?.id ?? 0);
    setTemplatesOpen(false);
    setError(undefined);
    urlInput.current?.focus();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = appSchema.safeParse({ name, url });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const data = {
        ...result.data,
        description,
        category_id: category || 1,
        icon,
        open_in_new_tab: newTab,
        favorite: source?.favorite ?? false,
        icon_color: iconColor,
      };
      if (!category && suggestedCategory) await onSave(data, suggestedCategory);
      else await onSave(data);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form application-form">
      <div className="application-form-fields">
        {app && isExampleApp(app) && (
          <p className="example-configure-hint">
            Add your service URL to turn this example into your application.
          </p>
        )}
        {!app && !duplicate && (
          <div className="service-chooser">
            <div className="service-chooser-summary">
              <button
                type="button"
                className="service-chooser-toggle"
                aria-label="Choose a service"
                aria-describedby={templatesId + "-hint"}
                aria-expanded={templatesOpen}
                aria-controls={templatesId}
                onClick={() => setTemplatesOpen((open) => !open)}
              >
                <Layers size={17} />
                <span>
                  <strong>Choose a service</strong>
                </span>
                <ChevronDown
                  size={17}
                  className={templatesOpen ? "chooser-expanded" : ""}
                />
              </button>
              <p className="service-chooser-hint" id={templatesId + "-hint"}>
                Start with a template, or enter your details below.
              </p>
            </div>
            {templatesOpen && (
              <section
                className="service-templates"
                id={templatesId}
                aria-label="Service templates"
              >
                <input
                  autoFocus
                  aria-label="Search service templates"
                  placeholder="Search services, media, storage…"
                  value={templateSearch}
                  onChange={(event) => setTemplateSearch(event.target.value)}
                />
                <label className="catalog-category">
                  Catalog category
                  <select
                    value={templateCategory}
                    onChange={(event) =>
                      setTemplateCategory(event.target.value)
                    }
                  >
                    <option value="">All categories</option>
                    {serviceCategories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <div className="template-results">
                  {matches.map((template, index) => (
                    <div key={template.name} className="service-template">
                      <Icon app={{ ...template, url: "" }} />
                      <span>
                        <button
                          type="button"
                          className="service-template-button"
                          aria-label={"Use " + template.name + " template"}
                          aria-describedby={
                            templatesId + "-description-" + index
                          }
                          onClick={() => selectTemplate(template)}
                        >
                          <strong>{template.name}</strong>
                        </button>
                        <small id={templatesId + "-description-" + index}>
                          {template.category} · {template.description}
                        </small>
                      </span>
                    </div>
                  ))}
                  {!matches.length && (
                    <p className="template-empty">
                      No matching services. You can still add one manually.
                    </p>
                  )}
                </div>
                <p className="field-hint">
                  Templates fill in the details. You provide the real URL.
                </p>
              </section>
            )}
          </div>
        )}
        <div className="form-grid">
          <label>
            Application name
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                recognize(e.target.value, url);
              }}
              placeholder="e.g. Jellyfin"
              maxLength={100}
            />
          </label>
          <label>
            Application URL
            <input
              value={url}
              ref={urlInput}
              onChange={(e) => {
                setUrl(e.target.value);
                recognize(name, e.target.value);
              }}
              placeholder="https://media.home"
              inputMode="url"
              onBlur={() => {
                setPreviewUrl(faviconPreviewUrl(url));
                if (!app && !name.trim()) {
                  const nextName =
                    (recognizes && detectService("", url)?.name) ||
                    suggestAppName(url);
                  setName(nextName);
                  recognize(nextName, url);
                }
              }}
            />
          </label>
        </div>
        {recognizes && (
          <div
            className={
              "service-detection" +
              (recognized ? " service-detection-active" : "")
            }
          >
            <p role="status" className="service-detection-message">
              {recognized && (
                <>
                  <img
                    className="service-detection-logo"
                    src={serviceIconUrl(recognized.service.icon)}
                    alt=""
                  />
                  <span>
                    Recognized <strong>{recognized.service.name}</strong>
                    {recognized.service.signal === "port"
                      ? " from its default port"
                      : recognized.service.signal === "name"
                        ? ""
                        : " from the address"}
                    . Its logo is selected.
                  </span>
                </>
              )}
            </p>
            {recognized && (
              <button
                type="button"
                className="button secondary service-detection-undo"
                onClick={keepPreviousIcon}
              >
                Keep previous icon
              </button>
            )}
          </div>
        )}
        <label>
          Description <span className="optional">optional</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A few words to make it yours"
            maxLength={300}
          />
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(Number(e.target.value))}
          >
            {!!suggestedCategory && (
              <option value={0}>New category: {suggestedCategory}</option>
            )}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Application icon</legend>
          <div className="icon-preview">
            <Icon
              app={{ name, url: previewUrl, icon, icon_color: iconColor }}
            />
            <div>
              <strong>
                {icon === "favicon"
                  ? "Automatic favicon"
                  : icon.startsWith("/uploads/")
                    ? "Custom image"
                    : serviceIconUrl(icon)
                      ? serviceIcons[icon.slice("service:".length)].name
                      : icon.replace("builtin:", "")}
              </strong>
              <p>Choose an icon or upload your own.</p>
            </div>
          </div>
          <div className="icon-tools">
            <button
              type="button"
              className={
                "button secondary " + (icon === "favicon" ? "selected" : "")
              }
              onClick={() => chooseIcon("favicon")}
            >
              <Globe size={16} />
              Automatic
            </button>
            <label className="button secondary upload">
              <Upload size={16} />
              Upload image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  try {
                    chooseIcon(await upload(file));
                    setError(undefined);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          </div>
          <input
            aria-label="Search icons"
            placeholder="Search bundled icons…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <IconPicker value={icon} query={search} onChange={chooseIcon} />
          <p className="field-hint icon-navigation-hint">
            Arrow keys to explore. Enter or Space to choose.
          </p>
        </fieldset>
        <fieldset className="icon-color-picker">
          <legend>Icon color</legend>
          {serviceIconUrl(icon) && (
            <p className="field-hint">
              Service artwork keeps its original colors. This changes the icon
              frame.
            </p>
          )}
          <div className="icon-color-swatches">
            {(
              [
                "auto",
                "sage",
                "blue",
                "amber",
                "rose",
                "violet",
                "cyan",
              ] as const
            ).map((color) => (
              <button
                key={color}
                type="button"
                data-icon-color={color}
                className="icon-color-swatch"
                aria-label={"Use " + color + " icon color"}
                aria-pressed={iconColor === color}
                onClick={() => setIconColor(color)}
              >
                <span className="icon-color-dot">
                  {iconColor === color && <Check size={14} />}
                </span>
                <span>{color}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="check-row">
          <input
            type="checkbox"
            checked={newTab}
            onChange={(e) => setNewTab(e.target.checked)}
          />
          Open in a new tab
        </label>
        <ErrorMessage error={error} />
      </div>
      <div className="dialog-footer">
        <button className="button secondary" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : app ? "Save changes" : "Add application"}
        </button>
      </div>
    </form>
  );
}
export function CommandPalette({
  apps,
  categories,
  onClose,
}: {
  apps: Application[];
  categories: Category[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const results = filterApps(apps, categories, query);
  const selectedIndex = Math.max(0, Math.min(selected, results.length - 1));
  useEffect(() => {
    document
      .getElementById("result-" + results[selectedIndex]?.id)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex, query, apps]);
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
          aria-activedescendant={
            results[selectedIndex]
              ? "result-" + results[selectedIndex].id
              : undefined
          }
          placeholder="Where would you like to go?"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) =>
                Math.max(0, Math.min(i + 1, results.length - 1)),
              );
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && results[selectedIndex]) {
              launch(results[selectedIndex]);
              onClose();
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
        {results.length === 0 && (
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
