import { useState, useId, useRef, useEffect } from "react";
import {
  Download,
  Upload,
  Paintbrush,
  Archive,
  UserRound,
  LayoutGrid,
} from "lucide-react";
import {
  api,
  upload,
  validateImageFile,
  type Application,
  type Settings,
} from "./lib";
import { ErrorMessage } from "./components";
import { PasswordForm } from "./Account";
import { AppearancePreview } from "./AppearancePreview";
import { applyPreset } from "./themes";
import { LayoutControls } from "./ThemeControls";
import { AppearanceEditor } from "./AppearanceEditor";
export function SettingsPanel({
  settings,
  onSave,
  onClose,
  onImported,
  previewApp,
  onBusyChange,
}: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
  onClose: () => void;
  onImported?: () => Promise<void>;
  previewApp?: Application;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(settings),
    [persisted, setPersisted] = useState(settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [data, setData] = useState<unknown>(),
    [preview, setPreview] = useState<{
      apps: number;
      categories: number;
      duplicates: number;
    }>(),
    [mode, setMode] = useState("merge"),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState("");
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((s) => ({ ...s, [key]: value }));
  const [backgroundFile, setBackgroundFile] = useState<File>();
  const [readingBackground, setReadingBackground] = useState(false);
  const backgroundGeneration = useRef(0);
  useEffect(
    () => () => {
      backgroundGeneration.current++;
    },
    [],
  );
  function cancelBackgroundRead() {
    backgroundGeneration.current++;
    setReadingBackground(false);
  }
  const [tab, setTab] = useState("Appearance");
  const tabId = useId();
  const appearanceFormId = tabId + "-appearance-form";
  const layoutFormId = tabId + "-layout-form";
  const dirty =
    readingBackground ||
    !!backgroundFile ||
    (Object.keys(draft) as (keyof Settings)[]).some(
      (key) => draft[key] !== persisted[key],
    );
  useEffect(() => {
    if (dirty) setNotice("");
  }, [draft, dirty]);
  const tabs = [
    { name: "Appearance", Icon: Paintbrush },
    { name: "Layout", Icon: LayoutGrid },
    { name: "Backup", Icon: Archive },
    { name: "Account", Icon: UserRound },
  ];
  function selectTab(name: string) {
    setTab(name);
    setError(undefined);
    setNotice("");
  }
  async function perform(action: () => Promise<void>) {
    setError(undefined);
    setBusy(true);
    onBusyChange?.(true);
    try {
      await action();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  function selectDesign(id: string) {
    cancelBackgroundRead();
    setBackgroundFile(undefined);
    setDraft((current) => applyPreset(current, id));
    setNotice("");
  }
  async function chooseBackground(file: File) {
    const generation = ++backgroundGeneration.current;
    setReadingBackground(true);
    setError(undefined);
    try {
      validateImageFile(file);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(
            new Error("This image could not be opened. Try another image."),
          );
        reader.readAsDataURL(file);
      });
      if (generation !== backgroundGeneration.current) return;
      setBackgroundFile(file);
      update("background", dataUrl);
      setError(undefined);
    } catch (e) {
      if (generation === backgroundGeneration.current) setError(e);
    } finally {
      if (generation === backgroundGeneration.current)
        setReadingBackground(false);
    }
  }
  async function saveDraft() {
    if (readingBackground || busy) return;
    if (!draft.title.trim()) {
      setError(new Error("Enter a dashboard title."));
      return;
    }
    if (new TextEncoder().encode(draft.title).length > 100) {
      setError(
        new Error(
          "This dashboard title is too long. Shorten it and try again.",
        ),
      );
      return;
    }
    await perform(async () => {
      const saved = backgroundFile
        ? { ...draft, background: await upload(backgroundFile) }
        : draft;
      await onSave(saved);
      setDraft(saved);
      setPersisted(saved);
      setBackgroundFile(undefined);
      setNotice("Appearance and layout saved.");
    });
  }
  function cancelChanges() {
    cancelBackgroundRead();
    setBackgroundFile(undefined);
    setDraft(persisted);
    setError(undefined);
    setNotice("Unsaved changes discarded.");
  }
  return (
    <div className="settings-panel" data-tab={tab}>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings"
        onKeyDown={(e) => {
          const current = tabs.findIndex((t) => t.name === tab);
          let next = current;
          if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
          else if (e.key === "ArrowLeft")
            next = (current - 1 + tabs.length) % tabs.length;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = tabs.length - 1;
          else return;
          e.preventDefault();
          selectTab(tabs[next].name);
          document.getElementById(tabId + "-" + tabs[next].name)?.focus();
        }}
      >
        {tabs.map(({ name, Icon }) => (
          <button
            key={name}
            id={tabId + "-" + name}
            role="tab"
            aria-selected={tab === name}
            aria-controls={tabId + "-panel-" + name}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => selectTab(name)}
          >
            <Icon size={16} />
            {name}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={tabId + "-panel-Appearance"}
        aria-labelledby={tabId + "-Appearance"}
        hidden={tab !== "Appearance"}
        tabIndex={0}
      >
        <div className="appearance-layout">
          <form
            id={appearanceFormId}
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
          >
            <fieldset className="settings-form-fields" disabled={busy}>
              <AppearanceEditor
                draft={draft}
                update={setDraft}
                onPreset={selectDesign}
                onWallpaper={(wallpaper) => {
                  cancelBackgroundRead();
                  setBackgroundFile(undefined);
                  setDraft((current) => ({
                    ...current,
                    wallpaper,
                    background: "",
                  }));
                }}
                onChooseImage={(file) => void chooseBackground(file)}
                onRemoveImage={() => {
                  cancelBackgroundRead();
                  update("background", "");
                  setBackgroundFile(undefined);
                }}
                readingImage={readingBackground}
                busy={busy}
              />
            </fieldset>
          </form>
          <AppearancePreview settings={draft} app={previewApp} />
        </div>
      </div>
      <div
        role="tabpanel"
        id={tabId + "-panel-Layout"}
        aria-labelledby={tabId + "-Layout"}
        hidden={tab !== "Layout"}
        tabIndex={0}
      >
        <div className="appearance-layout">
          <form
            id={layoutFormId}
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
          >
            <fieldset className="settings-form-fields" disabled={busy}>
              <LayoutControls
                settings={draft}
                onChange={(next) => setDraft(next)}
              />
              <p className="field-hint">
                Save keeps all your appearance and layout changes together.
                Columns adapt to the available space on smaller screens.
              </p>
            </fieldset>
          </form>
          <AppearancePreview settings={draft} app={previewApp} layout />
        </div>
      </div>
      <section
        className="backup-section"
        role="tabpanel"
        id={tabId + "-panel-Backup"}
        aria-labelledby={tabId + "-Backup"}
        hidden={tab !== "Backup"}
        tabIndex={0}
      >
        <h3>Your configuration</h3>
        <p>
          Keep a backup, or bring your applications from another installation.
        </p>
        <div className="icon-tools">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const backup = await api("/export");
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(backup, null, 2)], {
                    type: "application/json",
                  }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "homegrid-backup.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                setNotice("Configuration exported.");
              })
            }
          >
            <Download size={16} />
            Export configuration
          </button>
          <label className="button secondary upload">
            <Upload size={16} />
            Import configuration
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  cancelBackgroundRead();
                  setPreview(undefined);
                  setData(undefined);
                  setConfirmed(false);
                  void perform(async () => {
                    if (file.size > 5 * 1024 * 1024)
                      throw new Error("Choose a JSON file smaller than 5 MB.");
                    const parsed: unknown = JSON.parse(await file.text());
                    setPreview(await api("/import/preview", "POST", parsed));
                    setData(parsed);
                    setConfirmed(false);
                  });
                }
              }}
            />
          </label>
        </div>
        {preview && (
          <div className="import-preview">
            <h4>Import preview</h4>
            <p>
              {preview.apps} applications · {preview.categories} categories ·{" "}
              {preview.duplicates} duplicate URLs
            </p>
            <label>
              Import mode
              <select
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="merge">
                  Merge — keep existing applications
                </option>
                <option value="replace">
                  Replace — overwrite current configuration
                </option>
              </select>
            </label>
            {mode === "replace" && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I understand my current configuration will be replaced.
              </label>
            )}
            <button
              className="button primary"
              disabled={busy || (mode === "replace" && !confirmed)}
              onClick={() =>
                void perform(async () => {
                  cancelBackgroundRead();
                  const result = await api<{ imported: number }>(
                    "/import/apply",
                    "POST",
                    { data, mode, confirm: true },
                  );
                  setNotice(`Imported ${result.imported} applications.`);
                  setPreview(undefined);
                  await onImported?.();
                  const importedSettings = await api<Settings>("/settings");
                  setDraft(importedSettings);
                  setPersisted(importedSettings);
                  setBackgroundFile(undefined);
                })
              }
            >
              Apply import
            </button>
          </div>
        )}
      </section>
      <div
        role="tabpanel"
        id={tabId + "-panel-Account"}
        aria-labelledby={tabId + "-Account"}
        hidden={tab !== "Account"}
        tabIndex={0}
      >
        <PasswordForm />
      </div>
      <ErrorMessage error={error} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="settings-footer">
        {dirty && (
          <p className="settings-draft-note" aria-live="polite">
            Unsaved changes
          </p>
        )}
        <div
          className="dialog-footer settings-footer-actions"
          role="group"
          aria-label="Settings actions"
        >
          {(tab === "Appearance" || tab === "Layout") && (
            <>
              <button
                type="submit"
                form={tab === "Appearance" ? appearanceFormId : layoutFormId}
                className="button primary"
                disabled={busy || readingBackground}
              >
                {busy
                  ? "Saving…"
                  : tab === "Appearance"
                    ? "Save appearance"
                    : "Save layout"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={cancelChanges}
              >
                Cancel changes
              </button>
            </>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              cancelBackgroundRead();
              onClose();
            }}
          >
            {dirty ? "Discard and close" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
