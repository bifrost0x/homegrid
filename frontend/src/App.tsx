import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Search,
  Settings2,
  LogOut,
  ChevronDown,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  ArrowUpRight,
  FolderPlus,
  LayoutGrid,
  LoaderCircle,
  Star,
  SlidersHorizontal,
  Check,
  X,
  Copy,
} from "lucide-react";
import {
  api,
  defaults,
  setSession,
  moveApplication,
  appHostname,
  type Application,
  type Category,
  type Settings,
  type Session,
  type UndoRecord,
  isExampleApp,
} from "./lib";
import {
  ApplicationForm,
  CategoryForm,
  CommandPalette,
  ErrorMessage,
  Icon,
  Modal,
  saveApp,
} from "./components";
import { SettingsPanel } from "./Settings";
import { appearanceStyle, wallpaperUrl } from "./themes";
import {
  applicationDrop,
  launcherCollisionDetection,
  launcherKeyboardCoordinates,
  type ApplicationOrder,
} from "./sorting";
import { FirstRun } from "./FirstRun";
function Brand() {
  return (
    <a href="/" className="brand" aria-label="HomeGrid home">
      <span className="brand-mark">
        <i />
        <i />
        <i />
        <i />
      </span>
      HomeGrid
    </a>
  );
}
export function App() {
  const client = useQueryClient();
  useEffect(() => {
    const expired = () => {
      void client.invalidateQueries({ queryKey: ["session"] });
    };
    const refreshed = (event: Event) =>
      client.setQueryData(["session"], (event as CustomEvent<Session>).detail);
    window.addEventListener("homegrid:unauthorized", expired);
    window.addEventListener("homegrid:session-refreshed", refreshed);
    return () => {
      window.removeEventListener("homegrid:unauthorized", expired);
      window.removeEventListener("homegrid:session-refreshed", refreshed);
    };
  }, [client]);
  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/auth/session"),
  });
  useEffect(() => {
    if (query.data) {
      setSession(query.data);
      if (!query.data.authenticated) {
        for (const key of ["apps", "categories", "settings", "undo"])
          client.removeQueries({ queryKey: [key] });
      }
    }
  }, [query.data, client]);
  if (query.isPending)
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" />
        Opening HomeGrid…
      </div>
    );
  if (query.error)
    return (
      <div className="loading-screen">
        <ErrorMessage error={query.error} />
        <button className="button secondary" onClick={() => query.refetch()}>
          Try again
        </button>
      </div>
    );
  return query.data.authenticated ? (
    <Dashboard session={query.data} />
  ) : (
    <Auth setup={query.data.setup_required} />
  );
}
function Auth({ setup }: { setup: boolean }) {
  const client = useQueryClient();
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const s = await api<Session>(
        "/auth/" + (setup ? "setup" : "login"),
        "POST",
        { username, password },
      );
      setSession(s);
      client.setQueryData(["session"], s);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <Brand />
      <main className="auth-content">
        <span className="auth-symbol">
          <LayoutGrid size={30} />
        </span>
        <h1>{setup ? "A home for your homelab." : "Welcome home."}</h1>
        <p>
          {setup
            ? "Your services. Beautifully organized. Create your administrator account to get started."
            : "Your services are right where you left them."}
        </p>
        <form onSubmit={submit} className="form">
          <label>
            Username
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={1}
              maxLength={64}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={setup ? 12 : 1}
            />
          </label>
          {setup && (
            <p className="field-hint">
              Use at least 12 characters. This account manages your HomeGrid.
            </p>
          )}
          <ErrorMessage error={error} />
          <button className="button primary" disabled={busy}>
            {busy ? "Please wait…" : setup ? "Create your HomeGrid" : "Sign in"}
            <ArrowUpRight size={17} />
          </button>
        </form>
        <small className="auth-footnote">Self-hosted. Simply yours.</small>
      </main>
    </div>
  );
}
type DialogState =
  | {
      kind: "app";
      app?: Application;
      duplicate?: Application;
      categoryId?: number;
    }
  | { kind: "category"; category?: Category }
  | { kind: "settings" }
  | { kind: "delete-app"; app: Application }
  | { kind: "delete-category"; category: Category }
  | null;
function Dashboard({ session }: { session: Session }) {
  const client = useQueryClient();
  const appsQ = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<Application[]>("/apps"),
  });
  const catsQ = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/categories"),
  });
  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const undoQ = useQuery({
    queryKey: ["undo"],
    queryFn: () => api<UndoRecord[]>("/undo"),
    refetchInterval: 30000,
  });
  const apps = [...(appsQ.data ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    ),
    cats = [...(catsQ.data ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    settings = settingsQ.data ?? defaults;
  const [dialog, setDialog] = useState<DialogState>(null),
    [draggedApp, setDraggedApp] = useState<Application | null>(null),
    [moveFocus, setMoveFocus] = useState<{
      id: number;
      categoryId: number;
    } | null>(null),
    [organizing, setOrganizing] = useState(false),
    [notice, setNotice] = useState(""),
    [dismissedUndo, setDismissedUndo] = useState(""),
    [palette, setPalette] = useState(false),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [systemDark, setSystemDark] = useState(
      () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["apps"] }),
      client.invalidateQueries({ queryKey: ["categories"] }),
      client.invalidateQueries({ queryKey: ["settings"] }),
      client.invalidateQueries({ queryKey: ["undo"] }),
    ]);
  };
  useEffect(() => {
    if (!moveFocus || busy) return;
    const target =
      document.getElementById("move-category-" + moveFocus.id) ??
      document.getElementById("category-toggle-" + moveFocus.categoryId);
    target?.focus();
    setMoveFocus(null);
  }, [moveFocus, busy]);
  const latestUndo = Array.isArray(undoQ.data) ? undoQ.data[0] : undefined;
  const availableUndo =
    latestUndo &&
    latestUndo.token !== dismissedUndo &&
    Date.parse(latestUndo.expires_at) > Date.now()
      ? latestUndo
      : undefined;
  useEffect(() => {
    const undoChanged = () => {
      void client.invalidateQueries({ queryKey: ["undo"] });
    };
    const configureExample = (event: Event) =>
      setDialog({
        kind: "app",
        app: (event as CustomEvent<Application>).detail,
      });
    window.addEventListener("homegrid:undo-available", undoChanged);
    window.addEventListener("homegrid:configure-example", configureExample);
    return () => {
      window.removeEventListener("homegrid:undo-available", undoChanged);
      window.removeEventListener(
        "homegrid:configure-example",
        configureExample,
      );
    };
  }, [client]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme =
      settings.theme === "system"
        ? systemDark
          ? "dark"
          : "light"
        : settings.theme;
    document.documentElement.dataset.accent = settings.accent;
    document.documentElement.dataset.design = settings.design;
    const customStyle = appearanceStyle(settings);
    for (const key of [
      "--accent",
      "--accent-soft",
      "--accent-text",
      "--custom-ink-light",
      "--custom-ink-dark",
    ]) {
      const value = customStyle[key as keyof typeof customStyle];
      if (value) document.documentElement.style.setProperty(key, String(value));
      else document.documentElement.style.removeProperty(key);
    }
    document.title = settings.title + " · HomeGrid";
  }, [settings, systemDark]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: launcherKeyboardCoordinates,
    }),
  );
  async function action(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await refresh();
      if (message) setNotice(message);
    } catch (e) {
      setError(e);
      void client.invalidateQueries({ queryKey: ["undo"] });
    } finally {
      setBusy(false);
    }
  }
  async function reorder(kind: "apps" | "categories", ids: number[]) {
    await action(() => api("/" + kind + "/reorder", "PUT", { ids }));
  }
  function applyApplicationDrop(
    order: ApplicationOrder | null,
    restoreFocus = false,
  ) {
    if (!order || busy || !organizing) return;
    if (
      order.move &&
      !cats.some((category) => category.id === order.move?.category_id)
    )
      return;
    void action(
      () => api("/apps/reorder", "PUT", order),
      order.move
        ? "Application moved to " +
            cats.find((category) => category.id === order.move?.category_id)
              ?.name +
            "."
        : undefined,
    ).then(() => {
      if (restoreFocus && order.move)
        setMoveFocus({ id: order.move.id, categoryId: order.move.category_id });
    });
  }
  function move(kind: "apps" | "categories", id: number, offset: number) {
    if (kind === "apps") {
      void reorder("apps", moveApplication(apps, id, offset));
      return;
    }
    const list = cats;
    const from = list.findIndex((i) => i.id === id);
    const to = from + offset;
    if (to >= 0 && to < list.length)
      void reorder(
        kind,
        arrayMove<number>(
          list.map((i) => i.id),
          from,
          to,
        ),
      );
  }
  function dragEnd(event: DragEndEvent) {
    setDraggedApp(null);
    if (busy || !organizing) return;
    if (!event.over || event.active.id === event.over.id) return;
    const [kind, id] = String(event.active.id).split("-");
    if (kind === "app") {
      const activeRect = event.active.rect.current.translated;
      const targetRect = event.over.rect;
      // In a grid, horizontal position distinguishes the two card halves.
      const sameRow =
        activeRect &&
        Math.abs(activeRect.top - targetRect.top) < targetRect.height / 2;
      const after = activeRect
        ? sameRow
          ? activeRect.left + activeRect.width / 2 >
            targetRect.left + targetRect.width / 2
          : activeRect.top + activeRect.height / 2 >
            targetRect.top + targetRect.height / 2
        : false;
      applyApplicationDrop(
        applicationDrop(apps, Number(id), String(event.over.id), after),
      );
      return;
    }
    const [, over] = String(event.over.id).split("-");
    if (!String(event.over.id).startsWith(kind + "-")) return;
    const list = kind === "app" ? apps : cats;
    const from = list.findIndex((i) => i.id === Number(id)),
      to = list.findIndex((i) => i.id === Number(over));
    if (from >= 0 && to >= 0)
      void reorder(
        kind === "app" ? "apps" : "categories",
        arrayMove<number>(
          list.map((i) => i.id),
          from,
          to,
        ),
      );
  }
  const loading = appsQ.isPending || catsQ.isPending || settingsQ.isPending;
  const queryError = appsQ.error ?? catsQ.error ?? settingsQ.error;
  return (
    <div
      className={
        "dashboard " +
        settings.density +
        " " +
        settings.radius +
        (settings.blur ? " blurred" : "")
      }
      aria-busy={busy}
      data-width={settings.content_width}
      data-columns={settings.columns}
      data-groups={settings.group_columns}
      data-style={settings.card_style}
      data-strength={settings.background_strength}
    >
      {wallpaperUrl(settings) && (
        <div
          className="custom-background"
          style={{
            backgroundImage: `url(${JSON.stringify(wallpaperUrl(settings))})`,
          }}
        />
      )}
      <header className="topbar">
        <Brand />
        <nav aria-label="Main navigation">
          <span className="private-label">Your personal launchpad</span>
          <button
            className="icon-button"
            aria-label="Open settings"
            onClick={() => setDialog({ kind: "settings" })}
          >
            <Settings2 size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="Sign out"
            title={"Signed in as " + session.username}
            onClick={() =>
              void action(async () => {
                await api("/auth/logout", "POST");
                await client.invalidateQueries({ queryKey: ["session"] });
              })
            }
          >
            <LogOut size={19} />
          </button>
        </nav>
      </header>
      <main className="main-content">
        <div className="page-heading" hidden={!loading && !apps.length}>
          <div>
            <h1>{settings.title}</h1>
            <p>A little order. A lot of possibility.</p>
          </div>
          <div className="heading-actions">
            <button
              className={"button secondary " + (organizing ? "selected" : "")}
              aria-pressed={organizing}
              onClick={() => setOrganizing((v) => !v)}
            >
              {organizing ? (
                <Check size={17} />
              ) : (
                <SlidersHorizontal size={17} />
              )}{" "}
              {organizing ? "Done organizing" : "Organize"}
            </button>
            {organizing && (
              <button
                className="button secondary category-create"
                onClick={() => setDialog({ kind: "category" })}
              >
                <FolderPlus size={17} />
                New category
              </button>
            )}
          </div>
        </div>
        <div className="toolbar" hidden={!loading && !apps.length}>
          <button className="dashboard-search" onClick={() => setPalette(true)}>
            <Search size={19} />
            <span>Find an application…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button
            className="button primary"
            onClick={() => setDialog({ kind: "app" })}
          >
            <Plus size={19} />
            Add application
          </button>
        </div>
        <ErrorMessage error={error ?? queryError} />
        {(notice || availableUndo) && (
          <div className="feedback" aria-live="polite">
            <Check size={15} />
            <span>{availableUndo?.label ?? notice}</span>
            {availableUndo && (
              <button
                className="button secondary undo-button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api("/undo", "POST", { token: availableUndo.token });
                    setNotice("Change undone.");
                  }, "Change undone.")
                }
              >
                Undo
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => {
                setNotice("");
                if (availableUndo) setDismissedUndo(availableUndo.token);
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {queryError && (
          <button className="button secondary" onClick={() => void refresh()}>
            Retry loading
          </button>
        )}
        {!loading && apps.some((app) => app.favorite) && (
          <section className="favorites" aria-label="Favorites">
            <div className="favorites-heading">
              <Star size={15} />
              <h2>Favorites</h2>
            </div>
            <div className="favorite-links">
              {apps
                .filter((app) => app.favorite)
                .map((app) =>
                  isExampleApp(app) ? (
                    <button
                      type="button"
                      key={app.id}
                      className="favorite-link"
                      onClick={() => setDialog({ kind: "app", app })}
                    >
                      <Icon app={app} />
                      <span>Configure {app.name}</span>
                    </button>
                  ) : (
                    <a
                      key={app.id}
                      href={app.url}
                      onClick={(event) => {
                        if (isExampleApp(app)) {
                          event.preventDefault();
                          setDialog({ kind: "app", app });
                        }
                      }}
                      target={app.open_in_new_tab ? "_blank" : undefined}
                      rel={
                        app.open_in_new_tab ? "noopener noreferrer" : undefined
                      }
                      className="favorite-link"
                      aria-label={"Open favorite " + app.name}
                    >
                      <Icon app={app} />
                      <span>{app.name}</span>
                      <ArrowUpRight size={14} />
                    </a>
                  ),
                )}
            </div>
          </section>
        )}
        {organizing && (
          <div className="organize-guidance">
            <GripVertical size={16} />
            <span>
              Drag to arrange. Use the arrows to reorder, or choose a category
              to move an application.
            </span>
          </div>
        )}
        {loading ? (
          <div className="dashboard-loading">
            <LoaderCircle className="spin" />
            Loading your services…
          </div>
        ) : apps.length ? (
          <DndContext
            sensors={sensors}
            collisionDetection={launcherCollisionDetection}
            onDragStart={({ active }) =>
              setDraggedApp(
                apps.find((app) => "app-" + app.id === active.id) ?? null,
              )
            }
            onDragCancel={() => setDraggedApp(null)}
            onDragEnd={dragEnd}
          >
            <SortableContext
              items={cats.map((c) => "category-" + c.id)}
              strategy={rectSortingStrategy}
            >
              <div className="category-list">
                {cats
                  .filter(
                    (category) =>
                      organizing ||
                      apps.some((app) => app.category_id === category.id),
                  )
                  .map((category, index) => (
                    <CategorySection
                      key={category.id}
                      category={category}
                      apps={apps.filter((a) => a.category_id === category.id)}
                      allApps={apps}
                      categories={cats}
                      index={index}
                      total={cats.length}
                      busy={busy}
                      organizing={organizing}
                      descriptions={settings.show_descriptions}
                      onToggle={() =>
                        void action(() =>
                          api("/categories/" + category.id, "PATCH", {
                            ...category,
                            collapsed: !category.collapsed,
                          }),
                        )
                      }
                      onEdit={() => setDialog({ kind: "category", category })}
                      onDelete={() =>
                        setDialog({ kind: "delete-category", category })
                      }
                      onMove={(offset) =>
                        move("categories", category.id, offset)
                      }
                      onAdd={() =>
                        setDialog({ kind: "app", categoryId: category.id })
                      }
                      onEditApp={(app) => setDialog({ kind: "app", app })}
                      onDuplicateApp={(app) =>
                        setDialog({ kind: "app", duplicate: app })
                      }
                      onDeleteApp={(app) =>
                        setDialog({ kind: "delete-app", app })
                      }
                      onMoveApp={(app, offset) => move("apps", app.id, offset)}
                      onMoveAppToCategory={(app, categoryId) =>
                        applyApplicationDrop(
                          applicationDrop(
                            apps,
                            app.id,
                            "app-category-" + categoryId,
                          ),
                          true,
                        )
                      }
                      onFavorite={(app) =>
                        void action(
                          () =>
                            api("/apps/" + app.id, "PATCH", {
                              ...app,
                              favorite: !app.favorite,
                            }),
                          app.favorite
                            ? "Removed from favorites."
                            : "Added to favorites.",
                        )
                      }
                    />
                  ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {draggedApp && (
                <div className="app-card app-drag-preview" aria-hidden="true">
                  <div className="app-link">
                    <Icon app={draggedApp} />
                    <span className="app-copy">
                      <strong>{draggedApp.name}</strong>
                    </span>
                  </div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        ) : null}
        {!loading && !queryError && !apps.length && (
          <FirstRun
            onAdd={() => setDialog({ kind: "app" })}
            busy={busy}
            onExamples={() =>
              void action(
                () => api("/examples", "POST"),
                "Examples added. Choose one to add your URL.",
              )
            }
          />
        )}
        <footer className="page-footer">
          <span>HomeGrid</span>
          <span>Your services. Beautifully organized.</span>
        </footer>
      </main>
      {palette && (
        <CommandPalette
          apps={apps}
          categories={cats}
          onClose={() => setPalette(false)}
        />
      )}{" "}
      {dialog?.kind === "app" && (
        <Modal
          title={
            dialog.app
              ? "Edit application"
              : dialog.duplicate
                ? "Duplicate application"
                : "Add application"
          }
          description="A name, a link, and you’re ready to go."
          onClose={() => setDialog(null)}
        >
          <ApplicationForm
            app={dialog.app}
            duplicate={dialog.duplicate}
            initialCategory={dialog.categoryId}
            categories={cats}
            onClose={() => setDialog(null)}
            onSave={async (data, newCategory) => {
              if (newCategory) {
                const available = await api<Category[]>("/categories");
                const existing = available.find(
                  (category) =>
                    category.name.toLocaleLowerCase() ===
                    newCategory.toLocaleLowerCase(),
                );
                const category =
                  existing ??
                  (await api<Category>("/categories", "POST", {
                    name: newCategory,
                  }));
                data = { ...data, category_id: category.id };
              }
              await saveApp(data, dialog.app);
              await refresh();
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "category" && (
        <Modal
          title={dialog.category ? "Edit category" : "New category"}
          description="A little space for things that belong together."
          onClose={() => setDialog(null)}
        >
          <CategoryForm
            category={dialog.category}
            onClose={() => setDialog(null)}
            onSave={async (name) => {
              await api(
                "/categories" +
                  (dialog.category ? "/" + dialog.category.id : ""),
                dialog.category ? "PATCH" : "POST",
                dialog.category ? { ...dialog.category, name } : { name },
              );
              await refresh();
            }}
          />
        </Modal>
      )}
      {dialog?.kind === "settings" && (
        <Modal
          wide
          title="Make yourself at home."
          description="A few thoughtful details, just the way you like them."
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <SettingsPanel
            previewApp={apps[0]}
            onBusyChange={setBusy}
            settings={settings}
            onClose={() => {
              if (!busy) setDialog(null);
            }}
            onImported={refresh}
            onSave={async (value) => {
              await api("/settings", "PATCH", value);
              await refresh();
            }}
          />
        </Modal>
      )}
      {(dialog?.kind === "delete-app" ||
        dialog?.kind === "delete-category") && (
        <Modal
          title={
            dialog.kind === "delete-app"
              ? "Delete application?"
              : "Delete category?"
          }
          description={
            dialog.kind === "delete-app"
              ? `“${dialog.app.name}” will be removed from your HomeGrid.`
              : `Applications in “${dialog.category.name}” will move to ${cats.find((category) => category.id === 1)?.name ?? "General"}.`
          }
          onClose={() => setDialog(null)}
        >
          <ErrorMessage error={error} />
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(
                    dialog.kind === "delete-app"
                      ? "/apps/" + dialog.app.id
                      : "/categories/" + dialog.category.id,
                    "DELETE",
                  );
                  await refresh();
                  setDialog(null);
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "Deleting…"
                : dialog.kind === "delete-app"
                  ? "Delete application"
                  : "Delete category"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function CategorySection({
  category,
  apps,
  allApps,
  categories,
  index,
  total,
  busy,
  descriptions,
  onToggle,
  onEdit,
  onDelete,
  onMove,
  onAdd,
  onEditApp,
  onDeleteApp,
  onMoveApp,
  onMoveAppToCategory,
  organizing,
  onFavorite,
  onDuplicateApp,
}: {
  category: Category;
  apps: Application[];
  allApps: Application[];
  categories: Category[];
  index: number;
  total: number;
  busy: boolean;
  organizing: boolean;
  descriptions: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (offset: number) => void;
  onAdd: () => void;
  onEditApp: (app: Application) => void;
  onDeleteApp: (app: Application) => void;
  onMoveApp: (app: Application, offset: number) => void;
  onMoveAppToCategory: (app: Application, categoryId: number) => void;
  onFavorite: (app: Application) => void;
  onDuplicateApp: (app: Application) => void;
}) {
  const sortable = useSortable({
    id: "category-" + category.id,
    disabled: busy || !organizing,
  });
  const drop = useDroppable({
    id: "app-category-" + category.id,
    disabled: busy || !organizing,
  });
  return (
    <section
      ref={(node) => {
        sortable.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={
        "category-section " +
        (sortable.isDragging ? "dragging " : "") +
        (organizing ? "category-drop-target " : "") +
        (drop.isOver ? "drop-active" : "")
      }
      aria-label={category.name}
    >
      <div className="category-heading">
        {organizing && (
          <button
            className="drag-handle"
            aria-label={"Drag category " + category.name}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical size={15} />
          </button>
        )}
        <button
          id={"category-toggle-" + category.id}
          className="category-toggle"
          aria-expanded={!category.collapsed}
          onClick={onToggle}
        >
          <ChevronDown
            size={17}
            className={category.collapsed ? "collapsed-chevron" : ""}
          />
          <h2>{category.name}</h2>
          <span>{apps.length}</span>
        </button>
        {organizing && (
          <div className="category-actions">
            <button
              className="icon-button"
              aria-label={"Move category " + category.name + " up"}
              disabled={index === 0 || busy}
              onClick={() => onMove(-1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={"Move category " + category.name + " down"}
              disabled={index === total - 1 || busy}
              onClick={() => onMove(1)}
            >
              <ArrowDown size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={"Edit category " + category.name}
              onClick={onEdit}
            >
              <Pencil size={14} />
            </button>
            {category.id !== 1 && (
              <button
                className="icon-button"
                aria-label={"Delete category " + category.name}
                onClick={onDelete}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      {!category.collapsed && (
        <SortableContext
          items={apps.map((a) => "app-" + a.id)}
          strategy={rectSortingStrategy}
        >
          <div className="app-grid">
            {apps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                categories={categories}
                descriptions={descriptions}
                busy={busy}
                organizing={organizing}
                first={apps[0]?.id === app.id}
                last={apps[apps.length - 1]?.id === app.id}
                onEdit={() => onEditApp(app)}
                onDuplicate={() => onDuplicateApp(app)}
                onDelete={() => onDeleteApp(app)}
                onMove={(offset) => onMoveApp(app, offset)}
                onMoveToCategory={(categoryId) =>
                  onMoveAppToCategory(app, categoryId)
                }
                onFavorite={() => onFavorite(app)}
              />
            ))}
            {!apps.length && allApps.length > 0 && (
              <button className="empty-category" onClick={onAdd}>
                <Plus size={17} />
                Add an application
              </button>
            )}
          </div>
        </SortableContext>
      )}
    </section>
  );
}
function AppCard({
  app,
  categories,
  descriptions,
  busy,
  first,
  last,
  onEdit,
  onDelete,
  onMove,
  onMoveToCategory,
  organizing,
  onFavorite,
  onDuplicate,
}: {
  app: Application;
  categories: Category[];
  descriptions: boolean;
  busy: boolean;
  organizing: boolean;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (offset: number) => void;
  onMoveToCategory: (categoryId: number) => void;
  onFavorite: () => void;
  onDuplicate: () => void;
}) {
  const sortable = useSortable({
    id: "app-" + app.id,
    disabled: busy || !organizing,
  });
  const example = isExampleApp(app);
  const LaunchElement = example ? "button" : "a";
  return (
    <article
      data-testid="application-card"
      className={
        "app-card " +
        (organizing ? "organizing " : "") +
        (sortable.isDragging ? "dragging" : "")
      }
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <LaunchElement
        className="app-link"
        href={example ? undefined : app.url}
        type={example ? "button" : undefined}
        onAuxClick={(event) => {
          if (organizing) event.preventDefault();
        }}
        onClick={(event) => {
          if (organizing) {
            event.preventDefault();
            return;
          }
          if (isExampleApp(app)) {
            event.preventDefault();
            onEdit();
          }
        }}
        target={app.open_in_new_tab ? "_blank" : undefined}
        rel={app.open_in_new_tab ? "noopener noreferrer" : undefined}
      >
        <Icon app={app} />
        <span className="app-copy">
          <strong>{app.name}</strong>
          {isExampleApp(app) ? (
            <small className="example-label">Example · Add your URL</small>
          ) : (
            descriptions && (
              <small>{app.description || appHostname(app.url)}</small>
            )
          )}
        </span>
        <ArrowUpRight className="launch-arrow" size={16} />
      </LaunchElement>
      <div className="card-actions">
        {organizing && (
          <>
            <button
              className="drag-handle"
              aria-label={"Drag " + app.name}
              {...sortable.attributes}
              {...sortable.listeners}
            >
              <GripVertical size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={"Move " + app.name + " up"}
              disabled={first || busy}
              onClick={() => onMove(-1)}
            >
              <ArrowUp size={13} />
            </button>
            <button
              className="icon-button"
              aria-label={"Move " + app.name + " down"}
              disabled={last || busy}
              onClick={() => onMove(1)}
            >
              <ArrowDown size={13} />
            </button>
          </>
        )}
        <button
          className={
            "icon-button favorite-toggle " + (app.favorite ? "is-favorite" : "")
          }
          aria-label={
            (app.favorite ? "Remove " : "Add ") +
            app.name +
            (app.favorite ? " from favorites" : " to favorites")
          }
          aria-pressed={app.favorite}
          disabled={busy}
          onClick={onFavorite}
          title={app.favorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star size={14} fill={app.favorite ? "currentColor" : "none"} />
        </button>
        <button
          className="icon-button"
          aria-label={"Duplicate " + app.name}
          title="Duplicate application"
          onClick={onDuplicate}
        >
          <Copy size={13} />
        </button>
        <button
          className="icon-button"
          aria-label={"Edit " + app.name}
          onClick={onEdit}
        >
          <Pencil size={13} />
        </button>
        <button
          className="icon-button"
          aria-label={"Delete " + app.name}
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {organizing && (
        <select
          id={"move-category-" + app.id}
          className="move-category-select"
          aria-label={"Move " + app.name + " to category"}
          value={app.category_id}
          disabled={busy}
          onChange={(event) => onMoveToCategory(Number(event.target.value))}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      )}
    </article>
  );
}
