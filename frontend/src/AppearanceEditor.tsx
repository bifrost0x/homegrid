import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, Image, ImageOff, Trash2, Upload } from "lucide-react";
import type { Settings } from "./lib";
import {
  backgroundKind,
  extraAccents,
  gradients,
  matchingPreset,
  palettes,
  photoThumbnail,
  photos,
  presets,
  type BackgroundKind,
  type Preset,
} from "./themes";

const namedAccents = [
  "sage",
  "blue",
  "amber",
  "rose",
  "violet",
  "cyan",
] as const;

type Update = (change: (current: Settings) => Settings) => void;

/** A labelled group of native radio buttons styled as a segmented control. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hint?: string;
}) {
  const name = useId();
  return (
    <div className="setting-row">
      <span className="setting-label" id={name + "-label"}>
        {label}
      </span>
      <div
        className="segmented"
        role="radiogroup"
        aria-labelledby={name + "-label"}
      >
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="appearance-section" aria-labelledby={id}>
      <header>
        <h3 id={id}>{title}</h3>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function PresetSwatch({ preset }: { preset: Preset }) {
  const gradient = gradients.find((g) => g.id === preset.wallpaper);
  const photo = photos.some((p) => p.id === preset.wallpaper);
  return (
    <span
      className="design-thumbnail"
      data-design={preset.palette}
      data-theme={preset.theme}
      data-accent={preset.accent}
      style={gradient ? { backgroundImage: gradient.css } : undefined}
    >
      {photo && (
        <img src={photoThumbnail(preset.wallpaper)} alt="" loading="lazy" />
      )}
      <span className="design-miniature" aria-hidden="true">
        <i />
        <span>
          <b />
          <b />
          <b />
        </span>
      </span>
    </span>
  );
}

export function AppearanceEditor({
  draft,
  update,
  onPreset,
  onWallpaper,
  onChooseImage,
  onRemoveImage,
  readingImage,
  busy,
}: {
  draft: Settings;
  update: Update;
  onPreset: (id: string) => void;
  /** Selects a photo, gradient or "none" and drops any unsaved upload. */
  onWallpaper: (id: string) => void;
  onChooseImage: (file: File) => void;
  onRemoveImage: () => void;
  readingImage: boolean;
  busy: boolean;
}) {
  const kind = backgroundKind(draft);
  const [tab, setTab] = useState<BackgroundKind>(kind);
  // Follow changes made elsewhere, such as applying a preset or cancelling.
  useEffect(() => setTab(kind), [kind]);
  const active = matchingPreset(draft);
  const paletteId = useId();
  const set =
    <K extends keyof Settings>(key: K) =>
    (value: Settings[K]) =>
      update((current) => ({ ...current, [key]: value }));

  function chooseKind(next: BackgroundKind) {
    setTab(next);
    if (next === "none") onWallpaper("none");
    else if (next === "gradient" && kind !== "gradient")
      onWallpaper(gradients[0].id);
    else if (next === "photo" && kind !== "photo")
      onWallpaper(
        photos.find((photo) => photo.id === draft.design)?.id ?? photos[0].id,
      );
  }

  return (
    <div className="appearance-editor">
      <label>
        Dashboard title
        <input
          value={draft.title}
          maxLength={100}
          onChange={(e) => set("title")(e.target.value)}
          required
        />
      </label>

      <Section
        title="Presets"
        description="A preset sets mode, palette, accent and background in one step. Fine-tune any of them below."
      >
        <div className="preset-grid">
          {presets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className="design-option"
              aria-label={`Apply ${preset.name} preset`}
              aria-pressed={active?.id === preset.id}
              title={preset.description}
              onClick={() => onPreset(preset.id)}
            >
              <PresetSwatch preset={preset} />
              <strong>{preset.name}</strong>
              {active?.id === preset.id && (
                <span className="design-selected" aria-hidden="true">
                  <Check size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Colors"
        description="Mode switches between light and dark. The palette tints page and cards; the accent colors buttons and highlights."
      >
        <Segmented
          label="Mode"
          value={draft.theme}
          onChange={set("theme")}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <div className="setting-row">
          <span className="setting-label" id={paletteId}>
            Palette
          </span>
          <div
            className="palette-grid"
            role="radiogroup"
            aria-labelledby={paletteId}
          >
            {palettes.map((palette) => (
              <label key={palette.id} className="palette-option">
                <input
                  type="radio"
                  name={paletteId}
                  value={palette.id}
                  checked={draft.design === palette.id}
                  onChange={() => set("design")(palette.id)}
                />
                <span className="palette-preview" aria-hidden="true">
                  {(["light", "dark"] as const).map((theme) => (
                    <span
                      key={theme}
                      className="palette-chip"
                      data-design={palette.id}
                      data-theme={theme}
                      data-accent={draft.accent}
                    >
                      <i />
                    </span>
                  ))}
                </span>
                <span>{palette.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">Accent</span>
          <div
            className="accent-swatches"
            role="group"
            aria-label="Accent color"
          >
            {namedAccents.map((accent) => {
              const selected = !draft.custom_accent && draft.accent === accent;
              return (
                <button
                  type="button"
                  key={accent}
                  className="accent-swatch"
                  data-accent={accent}
                  aria-label={"Use " + accent + " accent"}
                  aria-pressed={selected}
                  title={accent}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      accent,
                      custom_accent: "",
                    }))
                  }
                >
                  <span className="swatch-color">
                    {selected && <Check size={14} />}
                  </span>
                </button>
              );
            })}
            {extraAccents.map((accent) => {
              const selected =
                draft.custom_accent.toLowerCase() === accent.hex.toLowerCase();
              return (
                <button
                  type="button"
                  key={accent.hex}
                  className="accent-swatch"
                  aria-label={"Use " + accent.name.toLowerCase() + " accent"}
                  aria-pressed={selected}
                  title={accent.name}
                  onClick={() => set("custom_accent")(accent.hex)}
                >
                  <span
                    className="swatch-color"
                    style={{ background: accent.hex, color: "#fff" }}
                  >
                    {selected && <Check size={14} />}
                  </span>
                </button>
              );
            })}
            <label className="accent-custom" title="Pick any color">
              <span className="visually-hidden">Custom accent color</span>
              <input
                type="color"
                value={draft.custom_accent || "#49654c"}
                onChange={(e) => set("custom_accent")(e.target.value)}
              />
            </label>
          </div>
          <p className="field-hint">
            {draft.custom_accent
              ? `Custom ${draft.custom_accent}. Button text adjusts for contrast.`
              : "Pick a color or choose any shade with the last swatch."}
          </p>
        </div>
      </Section>

      <Section
        title="Background"
        description="What appears behind your dashboard. Strength controls how much of it shows through."
      >
        <Segmented
          label="Background type"
          value={tab}
          onChange={chooseKind}
          options={[
            { value: "none", label: "None" },
            { value: "gradient", label: "Gradient" },
            { value: "photo", label: "Photo" },
            { value: "upload", label: "Your image" },
          ]}
        />
        {tab === "none" && (
          <p className="background-empty">
            <ImageOff size={18} />
            Only the palette color fills the page.
          </p>
        )}
        {tab === "gradient" && (
          <div className="background-grid" role="group" aria-label="Gradients">
            {gradients.map((gradient) => (
              <button
                type="button"
                key={gradient.id}
                className="background-option"
                aria-label={`Use ${gradient.name} gradient`}
                aria-pressed={
                  kind === "gradient" && draft.wallpaper === gradient.id
                }
                onClick={() => onWallpaper(gradient.id)}
              >
                <span style={{ backgroundImage: gradient.css }} />
                {gradient.name}
              </button>
            ))}
          </div>
        )}
        {tab === "photo" && (
          <div className="background-grid" role="group" aria-label="Photos">
            {photos.map((photo) => (
              <button
                type="button"
                key={photo.id}
                className="background-option"
                aria-label={`Use ${photo.name} photo`}
                aria-pressed={kind === "photo" && draft.wallpaper === photo.id}
                onClick={() => onWallpaper(photo.id)}
              >
                <img src={photoThumbnail(photo.id)} alt="" loading="lazy" />
                {photo.name}
              </button>
            ))}
          </div>
        )}
        {tab === "upload" && (
          <div className="background-upload">
            {draft.background ? (
              <img
                className="background-preview"
                src={draft.background}
                alt="Current dashboard background"
              />
            ) : (
              <span
                className="background-preview placeholder"
                aria-hidden="true"
              >
                <Upload size={20} />
              </span>
            )}
            <div className="icon-tools">
              <label className="button secondary upload">
                <Image size={16} />
                Choose image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onChooseImage(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {(draft.background || readingImage) && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={onRemoveImage}
                >
                  <Trash2 size={15} />
                  Remove
                </button>
              )}
            </div>
            <p className="field-hint">PNG, JPEG or WebP, up to 5 MB.</p>
            {readingImage && (
              <p className="field-hint" role="status">
                Preparing your image…
              </p>
            )}
          </div>
        )}
        {kind !== "none" && (
          <>
            <Segmented
              label="Strength"
              value={draft.background_strength}
              onChange={set("background_strength")}
              options={[
                { value: "subtle", label: "Subtle" },
                { value: "balanced", label: "Balanced" },
                { value: "vivid", label: "Vivid" },
              ]}
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.blur}
                onChange={(e) => set("blur")(e.target.checked)}
              />
              Subtle background blur
            </label>
          </>
        )}
      </Section>

      <Section
        title="Cards"
        description="How each application is drawn. Arrangement and columns live under Layout."
      >
        <Segmented
          label="Density"
          value={draft.density}
          onChange={set("density")}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
        />
        <Segmented
          label="Corners"
          value={draft.radius}
          onChange={set("radius")}
          options={[
            { value: "rounded", label: "Rounded" },
            { value: "square", label: "Square" },
          ]}
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.show_descriptions}
            onChange={(e) => set("show_descriptions")(e.target.checked)}
          />
          Show application descriptions
        </label>
      </Section>
    </div>
  );
}
