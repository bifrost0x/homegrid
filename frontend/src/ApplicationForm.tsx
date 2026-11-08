import { useState, useRef, useId, type FormEvent } from "react";
import {
  Globe,
  Upload,
  Search,
  Check,
  ChevronDown,
  Layers,
  CloudDownload,
} from "lucide-react";
import {
  api,
  upload,
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
import { serviceIconUrl } from "./serviceIcons";
import { findServiceIcon } from "./serviceIndex";
import { detectService, type DetectedService } from "./serviceDetection";
import { IconPicker } from "./IconPicker";
import { appSchema } from "./appSchema";
import { ErrorMessage, Icon } from "./components";
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
    else if (fetched.status === "found" && fetched.automatic)
      chooseIcon(fetched.previousIcon);
    setFetched({ status: "idle" });
  }
  // Asking the service itself is the fallback when the catalog has no logo.
  // The server fetches the icon (it can reach LAN services the browser may
  // not trust) and stores a re-encoded copy like an upload.
  const [fetched, setFetched] = useState<
    | { status: "idle" }
    | { status: "fetching"; host: string }
    | {
        status: "found";
        host: string;
        previousIcon: string;
        automatic: boolean;
      }
    | { status: "failed"; host: string; message: string }
  >({ status: "idle" });
  const fetchGeneration = useRef(0);
  function forgetFetchedIcon() {
    fetchGeneration.current++;
    if (fetched.status === "found" && fetched.automatic)
      setIcon(fetched.previousIcon);
    if (fetched.status !== "idle") setFetched({ status: "idle" });
  }
  /**
   * @param suggestedName the name HomeGrid filled in itself; the page title
   * replaces it only while the user has not typed a different name.
   */
  async function fetchServiceLogo(
    target: string,
    automatic: boolean,
    suggestedName?: string,
  ) {
    const origin = faviconPreviewUrl(target);
    if (!origin) return;
    const host = new URL(origin).host;
    const generation = ++fetchGeneration.current;
    const previousIcon = icon;
    setFetched({ status: "fetching", host });
    try {
      const result = await api<{ url: string; title?: string }>(
        "/icons/discover",
        "POST",
        { url: target },
      );
      if (generation !== fetchGeneration.current) return;
      const title = result.title?.trim();
      if (title && suggestedName !== undefined)
        setName((current) => (current === suggestedName ? title : current));
      if (automatic) {
        setIcon(result.url);
      } else {
        chooseIcon(result.url);
      }
      setFetched({ status: "found", host, previousIcon, automatic });
    } catch (e) {
      if (generation !== fetchGeneration.current) return;
      setFetched({
        status: "failed",
        host,
        message: e instanceof Error ? e.message : String(e),
      });
    }
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
                forgetFetchedIcon();
                recognize(name, e.target.value);
              }}
              placeholder="https://media.home"
              inputMode="url"
              onBlur={() => {
                setPreviewUrl(faviconPreviewUrl(url));
                let currentName = name;
                if (!app && !name.trim()) {
                  currentName =
                    (recognizes && detectService("", url)?.name) ||
                    suggestAppName(url);
                  setName(currentName);
                  recognize(currentName, url);
                }
                if (
                  recognizes &&
                  !iconChosen &&
                  (icon === "favicon" || icon === "") &&
                  fetched.status === "idle" &&
                  !detectService(currentName, url)
                )
                  void fetchServiceLogo(
                    url,
                    true,
                    !app && !name.trim() ? currentName : undefined,
                  );
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
                      ? (findServiceIcon(icon)?.name ?? "Service logo")
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
            <button
              type="button"
              className="button secondary"
              disabled={
                busy || fetched.status === "fetching" || !faviconPreviewUrl(url)
              }
              title="Ask the service for its icon"
              onClick={() => void fetchServiceLogo(url, false)}
            >
              <CloudDownload size={16} />
              From service
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
          {fetched.status !== "idle" && (
            <div className="service-fetch" role="status">
              {fetched.status === "fetching" && (
                <span>Asking {fetched.host} for its logo…</span>
              )}
              {fetched.status === "found" && (
                <>
                  <span>
                    Using the logo from <strong>{fetched.host}</strong>.
                  </span>
                  {fetched.automatic && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={keepPreviousIcon}
                    >
                      Keep previous icon
                    </button>
                  )}
                </>
              )}
              {fetched.status === "failed" && (
                <span>
                  No logo from {fetched.host}: {fetched.message}. Pick one below
                  or upload your own.
                </span>
              )}
            </div>
          )}
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
