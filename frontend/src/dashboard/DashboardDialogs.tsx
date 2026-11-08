import { lazy, Suspense, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api, type Application, type Category, type Settings } from "../lib";
import { CategoryForm, ErrorMessage, Modal, saveApp } from "../components";

// The form carries the service catalog and recognition; load it on first use.
const ApplicationForm = lazy(() =>
  import("../ApplicationForm").then((m) => ({ default: m.ApplicationForm })),
);

const SettingsPanel = lazy(() =>
  import("../Settings").then((m) => ({ default: m.SettingsPanel })),
);
const loading = (
  <p className="dialog-loading" role="status">
    <LoaderCircle className="spin" size={18} />
    Loading…
  </p>
);

export type DialogState =
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

interface Props {
  dialog: DialogState;
  onClose: () => void;
  apps: Application[];
  categories: Category[];
  settings: Settings;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<void>;
}

async function findOrCreateCategory(name: string) {
  const available = await api<Category[]>("/categories");
  const existing = available.find(
    (category) =>
      category.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  return existing ?? api<Category>("/categories", "POST", { name });
}

export function DashboardDialogs(props: Props) {
  const { dialog, onClose, apps, categories, settings, busy, refresh } = props;
  switch (dialog?.kind) {
    case "app":
      return (
        <Modal
          title={
            dialog.app
              ? "Edit application"
              : dialog.duplicate
                ? "Duplicate application"
                : "Add application"
          }
          description="Give it a name and a link."
          onClose={onClose}
        >
          <Suspense fallback={loading}>
            <ApplicationForm
              app={dialog.app}
              duplicate={dialog.duplicate}
              initialCategory={dialog.categoryId}
              categories={categories}
              onClose={onClose}
              onSave={async (data, newCategory) => {
                if (newCategory) {
                  const category = await findOrCreateCategory(newCategory);
                  data = { ...data, category_id: category.id };
                }
                await saveApp(data, dialog.app);
                await refresh();
              }}
            />
          </Suspense>
        </Modal>
      );
    case "category":
      return (
        <Modal
          title={dialog.category ? "Edit category" : "New category"}
          description="Group applications that belong together."
          onClose={onClose}
        >
          <CategoryForm
            category={dialog.category}
            onClose={onClose}
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
      );
    case "settings": {
      const closeWhenIdle = () => {
        if (!busy) onClose();
      };
      return (
        <Modal
          wide
          title="Settings"
          description="Appearance, layout, backups and your account."
          onClose={closeWhenIdle}
        >
          <Suspense fallback={loading}>
            <SettingsPanel
              previewApp={apps[0]}
              onBusyChange={props.setBusy}
              settings={settings}
              onClose={closeWhenIdle}
              onImported={refresh}
              onSave={async (value) => {
                await api("/settings", "PATCH", value);
                await refresh();
              }}
            />
          </Suspense>
        </Modal>
      );
    }
    case "delete-app":
    case "delete-category":
      return <DeleteDialog {...props} dialog={dialog} />;
    default:
      return null;
  }
}

function DeleteDialog({
  dialog,
  onClose,
  categories,
  busy,
  setBusy,
  refresh,
}: Props & {
  dialog: Extract<DialogState, { kind: "delete-app" | "delete-category" }>;
}) {
  const [error, setError] = useState<unknown>();
  const app = dialog.kind === "delete-app";
  const general =
    categories.find((category) => category.id === 1)?.name ?? "General";
  async function confirm() {
    setBusy(true);
    setError(undefined);
    try {
      await api(
        dialog.kind === "delete-app"
          ? "/apps/" + dialog.app.id
          : "/categories/" + dialog.category.id,
        "DELETE",
      );
      await refresh();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={app ? "Delete application?" : "Delete category?"}
      description={
        dialog.kind === "delete-app"
          ? `“${dialog.app.name}” will be removed from your HomeGrid.`
          : `Applications in “${dialog.category.name}” will move to ${general}.`
      }
      onClose={onClose}
    >
      <ErrorMessage error={error} />
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="button danger" disabled={busy} onClick={confirm}>
          {busy ? "Deleting…" : app ? "Delete application" : "Delete category"}
        </button>
      </div>
    </Modal>
  );
}
