import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Check,
  FolderPlus,
  GripVertical,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { api, moveApplication, type Application, type Session } from "../lib";
import { on } from "../events";
import { CommandPalette, ErrorMessage } from "../components";
import { wallpaperUrl } from "../themes";
import { applicationDrop, type ApplicationOrder } from "../sorting";
import { FirstRun } from "../FirstRun";
import { Brand } from "../Brand";
import { AppDragPreview } from "./AppCard";
import { CategorySection } from "./CategorySection";
import { DashboardContext, type DashboardState } from "./context";
import { DashboardDialogs, type DialogState } from "./DashboardDialogs";
import { Favorites } from "./Favorites";
import { Feedback } from "./Feedback";
import { useAppearance } from "./useAppearance";
import { useCommandShortcut } from "./useCommandShortcut";
import { useDashboardData } from "./useDashboardData";
import { useOrganizeDrag } from "./useOrganizeDrag";

function count(n: number, singular: string, plural: string) {
  return n + " " + (n === 1 ? singular : plural);
}
function summary(apps: Application[]) {
  const categories = new Set(apps.map((app) => app.category_id)).size;
  return (
    count(apps.length, "application", "applications") +
    " in " +
    count(categories, "category", "categories")
  );
}

export function Dashboard({ session }: { session: Session }) {
  const client = useQueryClient();
  const data = useDashboardData();
  const { apps, categories, settings, loading, refresh } = data;
  const [dialog, setDialog] = useState<DialogState>(null),
    [moveFocus, setMoveFocus] = useState<{
      id: number;
      categoryId: number;
    } | null>(null),
    [organizing, setOrganizing] = useState(false),
    [notice, setNotice] = useState(""),
    [dismissedUndo, setDismissedUndo] = useState(""),
    [palette, setPalette] = useState(false),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  useAppearance(settings);
  useCommandShortcut(useCallback(() => setPalette((open) => !open), []));
  useEffect(() => {
    const unsubscribe = [
      on(
        "homegrid:undo-available",
        () => void client.invalidateQueries({ queryKey: ["undo"] }),
      ),
      on("homegrid:configure-example", (app) =>
        setDialog({ kind: "app", app }),
      ),
    ];
    return () => unsubscribe.forEach((off) => off());
  }, [client]);
  useEffect(() => {
    if (!moveFocus || busy) return;
    const target =
      document.getElementById("move-category-" + moveFocus.id) ??
      document.getElementById("category-toggle-" + moveFocus.categoryId);
    target?.focus();
    setMoveFocus(null);
  }, [moveFocus, busy]);

  const availableUndo =
    data.latestUndo &&
    data.latestUndo.token !== dismissedUndo &&
    Date.parse(data.latestUndo.expires_at) > Date.now()
      ? data.latestUndo
      : undefined;

  async function action(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await refresh();
      if (message) setNotice(message);
    } catch (e) {
      setError(e);
      void data.refreshUndo();
    } finally {
      setBusy(false);
    }
  }
  const reorder = (kind: "apps" | "categories", ids: number[]) =>
    action(() => api("/" + kind + "/reorder", "PUT", { ids }));
  function applyApplicationDrop(
    order: ApplicationOrder | null,
    restoreFocus = false,
  ) {
    if (!order || busy || !organizing) return;
    const target = order.move
      ? categories.find((category) => category.id === order.move?.category_id)
      : undefined;
    if (order.move && !target) return;
    void action(
      () => api("/apps/reorder", "PUT", order),
      target ? "Application moved to " + target.name + "." : undefined,
    ).then(() => {
      if (restoreFocus && order.move)
        setMoveFocus({ id: order.move.id, categoryId: order.move.category_id });
    });
  }
  const drag = useOrganizeDrag({
    apps,
    categories,
    enabled: organizing && !busy,
    onReorderCategories: (ids) => void reorder("categories", ids),
    onApplicationDrop: applyApplicationDrop,
  });

  const state: DashboardState = {
    busy,
    organizing,
    descriptions: settings.show_descriptions,
    categories,
    applications: {
      edit: (app) => setDialog({ kind: "app", app }),
      duplicate: (app) => setDialog({ kind: "app", duplicate: app }),
      remove: (app) => setDialog({ kind: "delete-app", app }),
      toggleFavorite: (app) =>
        void action(
          () =>
            api("/apps/" + app.id, "PATCH", {
              ...app,
              favorite: !app.favorite,
            }),
          app.favorite ? "Removed from favorites." : "Added to favorites.",
        ),
      move: (app, offset) =>
        void reorder("apps", moveApplication(apps, app.id, offset)),
      moveToCategory: (app, categoryId) =>
        applyApplicationDrop(
          applicationDrop(apps, app.id, "app-category-" + categoryId),
          true,
        ),
    },
    categoryActions: {
      toggle: (category) =>
        void action(() =>
          api("/categories/" + category.id, "PATCH", {
            ...category,
            collapsed: !category.collapsed,
          }),
        ),
      edit: (category) => setDialog({ kind: "category", category }),
      remove: (category) => setDialog({ kind: "delete-category", category }),
      move: (category, offset) => {
        const from = categories.findIndex((c) => c.id === category.id);
        const to = from + offset;
        if (to >= 0 && to < categories.length)
          void reorder(
            "categories",
            arrayMove(
              categories.map((c) => c.id),
              from,
              to,
            ),
          );
      },
      addApplication: (category) =>
        setDialog({ kind: "app", categoryId: category.id }),
    },
  };

  const queryError = data.error;
  const empty = !loading && !apps.length;
  const visibleCategories = categories.filter(
    (category) =>
      organizing || apps.some((app) => app.category_id === category.id),
  );
  const wallpaper = wallpaperUrl(settings);
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
      {wallpaper && (
        <div
          className="custom-background"
          style={{ backgroundImage: `url(${JSON.stringify(wallpaper)})` }}
        />
      )}
      <header className="topbar">
        <Brand />
        <nav aria-label="Main navigation">
          <button
            className="icon-button"
            aria-label="Open settings"
            title="Settings"
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
        <div className="page-heading" hidden={empty}>
          <div>
            <h1>{settings.title}</h1>
            {!loading && <p>{summary(apps)}</p>}
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
        <div className="toolbar" hidden={empty}>
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
        <Feedback
          notice={notice}
          undo={availableUndo}
          busy={busy}
          onUndo={(undo) =>
            void action(async () => {
              await api("/undo", "POST", { token: undo.token });
              setNotice("Change undone.");
            }, "Change undone.")
          }
          onDismiss={() => {
            setNotice("");
            if (availableUndo) setDismissedUndo(availableUndo.token);
          }}
        />
        {queryError && (
          <button className="button secondary" onClick={() => void refresh()}>
            Retry loading
          </button>
        )}
        {!loading && (
          <Favorites
            apps={apps}
            onConfigure={(app) => setDialog({ kind: "app", app })}
          />
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
          <DashboardContext.Provider value={state}>
            <DndContext {...drag.context}>
              <SortableContext
                items={categories.map((c) => "category-" + c.id)}
                strategy={rectSortingStrategy}
              >
                <div className="category-list">
                  {visibleCategories.map((category, index) => (
                    <CategorySection
                      key={category.id}
                      category={category}
                      apps={apps.filter((a) => a.category_id === category.id)}
                      first={index === 0}
                      last={index === visibleCategories.length - 1}
                      showEmptyAction={apps.length > 0}
                    />
                  ))}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={null}>
                {drag.draggedApp && <AppDragPreview app={drag.draggedApp} />}
              </DragOverlay>
            </DndContext>
          </DashboardContext.Provider>
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
      </main>
      {palette && (
        <CommandPalette
          apps={apps}
          categories={categories}
          onClose={() => setPalette(false)}
        />
      )}
      <DashboardDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        apps={apps}
        categories={categories}
        settings={settings}
        busy={busy}
        setBusy={setBusy}
        refresh={refresh}
      />
    </div>
  );
}
