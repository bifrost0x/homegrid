import { Check, ImageOff } from "lucide-react";
import { useId } from "react";
import { designs } from "./themes";
import { type Settings } from "./lib";

export function DesignGallery({
  settings,
  onSelect,
}: {
  settings: Settings;
  onSelect: (id: string) => void;
}) {
  const galleryId = useId();
  return (
    <fieldset className="design-library">
      <legend>Choose your design</legend>
      <p className="field-hint">
        Twelve complete looks. Pick a starting point, then change any detail
        below.
      </p>
      <div className="design-gallery">
        {designs.map((design) => (
          <div key={design.id} className="design-choice">
            <button
              type="button"
              className="design-option"
              aria-label={`Use ${design.name} design`}
              aria-describedby={`${galleryId}-${design.id}`}
              aria-pressed={settings.design === design.id}
              onClick={() => onSelect(design.id)}
            >
              <span
                className="design-thumbnail"
                data-design={design.id}
                data-theme={design.theme}
                data-accent={design.accent}
              >
                <img
                  src={`/backgrounds/${design.wallpaper}.svg`}
                  alt=""
                  loading="lazy"
                />
                <span className="design-miniature" aria-hidden="true">
                  <i />
                  <span>
                    <b />
                    <b />
                    <b />
                  </span>
                </span>
                {settings.design === design.id && (
                  <span className="design-selected">
                    <Check size={12} />
                  </span>
                )}
              </span>
              <strong>{design.name}</strong>
            </button>
            <span
              id={`${galleryId}-${design.id}`}
              className="design-description"
            >
              {design.description}
            </span>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function WallpaperLibrary({
  settings,
  onSelect,
}: {
  settings: Settings;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="wallpaper-library">
      <legend>Wallpaper library</legend>
      <p className="field-hint">
        Mix any background with any design. Included locally, ready offline.
      </p>
      <div className="wallpaper-gallery">
        <button
          type="button"
          className="wallpaper-option none"
          aria-label="No wallpaper"
          aria-pressed={!settings.background && settings.wallpaper === "none"}
          onClick={() => onSelect("none")}
        >
          <ImageOff size={21} />
          <span>No wallpaper</span>
        </button>
        {designs.map((design) => (
          <button
            type="button"
            className="wallpaper-option"
            key={design.id}
            aria-label={`Use ${design.name} wallpaper`}
            aria-pressed={
              !settings.background && settings.wallpaper === design.id
            }
            onClick={() => onSelect(design.id)}
          >
            <img
              src={`/backgrounds/${design.wallpaper}.svg`}
              alt=""
              loading="lazy"
            />
            <span>{design.name}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function LayoutControls({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const update = (key: keyof Settings, value: string) =>
    onChange({ ...settings, [key]: value });
  return (
    <>
      <div className="settings-section-heading">
        <h3>A layout that fits your setup</h3>
        <p>
          Give a large screen room to breathe, or keep everything within reach.
        </p>
      </div>
      <label>
        Dashboard width
        <select
          value={settings.content_width}
          onChange={(e) => update("content_width", e.target.value)}
        >
          <option value="focused">Focused · 1100 px</option>
          <option value="standard">Standard · 1408 px</option>
          <option value="wide">Wide · 1760 px</option>
          <option value="full">Full screen</option>
        </select>
      </label>
      <div className="form-grid">
        <label>
          Groups per row
          <select
            value={settings.group_columns}
            onChange={(e) => update("group_columns", e.target.value)}
          >
            <option value="1">One group</option>
            <option value="2">Two groups</option>
            <option value="3">Three groups</option>
          </select>
        </label>
        <label>
          Applications per row
          <select
            value={settings.columns}
            onChange={(e) => update("columns", e.target.value)}
          >
            <option value="auto">Automatic</option>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={String(n)}>
                {n} applications
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Application style
        <select
          value={settings.card_style}
          onChange={(e) => update("card_style", e.target.value)}
        >
          <option value="cards">Cards · icon and details</option>
          <option value="tiles">Tiles · centered icons</option>
          <option value="list">List · one application per row</option>
        </select>
      </label>
      <button
        type="button"
        className="text-button layout-reset"
        onClick={() =>
          onChange({
            ...settings,
            content_width: "standard",
            columns: "auto",
            group_columns: "1",
            card_style: "cards",
          })
        }
      >
        Use default layout
      </button>
    </>
  );
}
