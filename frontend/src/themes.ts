import type { CSSProperties } from "react";
import type { Settings } from "./lib";

type Theme = "light" | "dark";

/** Surface palettes tint page, cards, text and lines for light and dark mode. */
export const palettes: ReadonlyArray<{ id: string; name: string }> = [
  { id: "homegrid", name: "Sage" },
  { id: "porcelain", name: "Porcelain" },
  { id: "dune", name: "Dune" },
  { id: "terracotta", name: "Terracotta" },
  { id: "rosewood", name: "Rosewood" },
  { id: "lavender", name: "Lavender" },
  { id: "forest", name: "Forest" },
  { id: "lagoon", name: "Lagoon" },
  { id: "arctic", name: "Arctic" },
  { id: "midnight", name: "Midnight" },
  { id: "aurora", name: "Aurora" },
  { id: "ember", name: "Ember" },
  { id: "graphite", name: "Graphite" },
  { id: "paper", name: "Paper" },
  { id: "nord", name: "Nord" },
  { id: "mocha", name: "Mocha" },
  { id: "slate", name: "Slate" },
  { id: "sakura", name: "Sakura" },
];

/** Bundled photographs; each has a full image and a small thumbnail. */
export const photos: ReadonlyArray<{ id: string; name: string }> = [
  { id: "homegrid", name: "Alpine lake" },
  { id: "porcelain", name: "Island houses" },
  { id: "dune", name: "Dunes" },
  { id: "terracotta", name: "Canyon" },
  { id: "rosewood", name: "Maple garden" },
  { id: "lavender", name: "Lavender fields" },
  { id: "forest", name: "Old forest" },
  { id: "lagoon", name: "Lagoon" },
  { id: "arctic", name: "Icebergs" },
  { id: "midnight", name: "City at night" },
  { id: "aurora", name: "Northern lights" },
  { id: "ember", name: "Volcanic coast" },
];

/** Generated backgrounds: no image files, crisp at every resolution. */
export const gradients: ReadonlyArray<{
  id: string;
  name: string;
  css: string;
}> = [
  {
    id: "gradient-dawn",
    name: "Dawn",
    css: "radial-gradient(at 12% 18%, #ffd6a5 0, transparent 55%), radial-gradient(at 88% 12%, #ffadc6 0, transparent 50%), radial-gradient(at 70% 88%, #c7b8ff 0, transparent 55%), linear-gradient(135deg, #fff1e6, #f7e1f2)",
  },
  {
    id: "gradient-meadow",
    name: "Meadow",
    css: "radial-gradient(at 18% 22%, #d9f2b4 0, transparent 55%), radial-gradient(at 82% 30%, #a8e6cf 0, transparent 50%), radial-gradient(at 50% 92%, #f6f1c1 0, transparent 60%), linear-gradient(160deg, #eef8e4, #dff1ea)",
  },
  {
    id: "gradient-tide",
    name: "Tide",
    css: "radial-gradient(at 15% 80%, #7ed6df 0, transparent 55%), radial-gradient(at 85% 15%, #6c9cff 0, transparent 55%), radial-gradient(at 60% 50%, #b8f2e6 0, transparent 60%), linear-gradient(135deg, #dff6ff, #d6e4ff)",
  },
  {
    id: "gradient-sand",
    name: "Sand",
    css: "radial-gradient(at 20% 20%, #f3d9b1 0, transparent 55%), radial-gradient(at 85% 70%, #e8c39e 0, transparent 55%), linear-gradient(150deg, #faf3e8, #f1e3cf)",
  },
  {
    id: "gradient-blossom",
    name: "Blossom",
    css: "radial-gradient(at 80% 20%, #ffc8dd 0, transparent 55%), radial-gradient(at 20% 75%, #ffafcc 0, transparent 50%), radial-gradient(at 50% 40%, #fde2ff 0, transparent 60%), linear-gradient(135deg, #fff0f5, #fbe4f0)",
  },
  {
    id: "gradient-mist",
    name: "Mist",
    css: "radial-gradient(at 25% 25%, #e2e8f0 0, transparent 55%), radial-gradient(at 75% 80%, #cbd5e1 0, transparent 55%), linear-gradient(160deg, #f8fafc, #e5e9f0)",
  },
  {
    id: "gradient-dusk",
    name: "Dusk",
    css: "radial-gradient(at 15% 85%, #ff8c61 0, transparent 50%), radial-gradient(at 85% 20%, #6a4c93 0, transparent 55%), radial-gradient(at 55% 55%, #c0587e 0, transparent 60%), linear-gradient(160deg, #2b2147, #4a2a4f)",
  },
  {
    id: "gradient-nebula",
    name: "Nebula",
    css: "radial-gradient(at 20% 30%, #7b2ff7 0, transparent 50%), radial-gradient(at 80% 70%, #2d6cdf 0, transparent 55%), radial-gradient(at 60% 10%, #c2185b 0, transparent 45%), linear-gradient(135deg, #0f0c29, #1b1640)",
  },
  {
    id: "gradient-boreal",
    name: "Boreal",
    css: "radial-gradient(at 25% 20%, #1de9b6 0, transparent 45%), radial-gradient(at 75% 35%, #00b0ff 0, transparent 50%), radial-gradient(at 50% 95%, #304ffe 0, transparent 60%), linear-gradient(170deg, #06141f, #0b2233)",
  },
  {
    id: "gradient-ember",
    name: "Embers",
    css: "radial-gradient(at 20% 80%, #ff6b35 0, transparent 50%), radial-gradient(at 80% 25%, #f7c548 0, transparent 45%), radial-gradient(at 55% 50%, #c1121f 0, transparent 60%), linear-gradient(160deg, #1f0d0a, #3a1510)",
  },
  {
    id: "gradient-deepsea",
    name: "Deep sea",
    css: "radial-gradient(at 20% 20%, #0a9396 0, transparent 50%), radial-gradient(at 80% 80%, #005f73 0, transparent 55%), radial-gradient(at 70% 20%, #94d2bd 0, transparent 40%), linear-gradient(160deg, #001219, #01303f)",
  },
  {
    id: "gradient-carbon",
    name: "Carbon",
    css: "radial-gradient(at 20% 15%, #3a3f47 0, transparent 55%), radial-gradient(at 85% 85%, #2a2f36 0, transparent 55%), linear-gradient(160deg, #15171a, #22262b)",
  },
];

export interface Preset {
  id: string;
  name: string;
  description: string;
  /** Surface palette stored in settings.design. */
  palette: string;
  theme: Theme;
  accent: Settings["accent"];
  /** Photo id, gradient id or "none". */
  wallpaper: string;
  strength: Settings["background_strength"];
}

function preset(
  id: string,
  name: string,
  description: string,
  theme: Theme,
  accent: Settings["accent"],
  wallpaper = id,
  palette = id,
  strength: Settings["background_strength"] = "balanced",
): Preset {
  return { id, name, description, palette, theme, accent, wallpaper, strength };
}

/** A preset sets palette, mode, accent and background in one step. */
export const presets: ReadonlyArray<Preset> = [
  preset(
    "homegrid",
    "HomeGrid",
    "Alpine lake in morning light",
    "light",
    "sage",
  ),
  preset(
    "porcelain",
    "Porcelain",
    "White houses above a cobalt sea",
    "light",
    "blue",
  ),
  preset("dune", "Dune", "Golden dunes and a wide horizon", "light", "amber"),
  preset(
    "terracotta",
    "Terracotta",
    "Red canyon walls at sunset",
    "light",
    "rose",
  ),
  preset(
    "rosewood",
    "Rosewood",
    "Crimson maples around a quiet pond",
    "dark",
    "rose",
  ),
  preset(
    "lavender",
    "Lavender",
    "Lavender hills at blue hour",
    "light",
    "violet",
  ),
  preset("forest", "Forest", "Sunbeams over a mossy river", "dark", "sage"),
  preset(
    "lagoon",
    "Lagoon",
    "A turquoise lagoon and island beach",
    "light",
    "cyan",
  ),
  preset(
    "arctic",
    "Arctic",
    "Blue icebergs under snowy peaks",
    "light",
    "blue",
  ),
  preset(
    "midnight",
    "Midnight",
    "Rainlit city in blue and amber",
    "dark",
    "blue",
  ),
  preset("aurora", "Aurora", "Northern lights over a fjord", "dark", "violet"),
  preset(
    "ember",
    "Ember",
    "Volcanic coast under an orange sky",
    "dark",
    "amber",
  ),
  preset(
    "graphite",
    "Graphite",
    "Neutral grays, nothing in the way",
    "dark",
    "blue",
    "gradient-carbon",
    "graphite",
    "vivid",
  ),
  preset(
    "paper",
    "Paper",
    "Plain, bright and high in contrast",
    "light",
    "sage",
    "none",
    "paper",
  ),
  preset(
    "nord",
    "Nord",
    "Cool arctic blues for long evenings",
    "dark",
    "cyan",
    "gradient-boreal",
    "nord",
  ),
  preset(
    "mocha",
    "Mocha",
    "Warm browns and soft cream",
    "light",
    "amber",
    "gradient-sand",
    "mocha",
    "vivid",
  ),
  preset(
    "nebula",
    "Nebula",
    "Deep space violet and magenta",
    "dark",
    "violet",
    "gradient-nebula",
    "aurora",
    "vivid",
  ),
  preset(
    "sunrise",
    "Sunrise",
    "Peach and lilac morning haze",
    "light",
    "rose",
    "gradient-dawn",
    "sakura",
    "vivid",
  ),
  preset(
    "tide",
    "Tide",
    "Fresh ocean blues",
    "light",
    "blue",
    "gradient-tide",
    "slate",
    "vivid",
  ),
  preset(
    "deepsea",
    "Deep sea",
    "Dark teal water and calm focus",
    "dark",
    "cyan",
    "gradient-deepsea",
    "nord",
    "vivid",
  ),
];

/** The twelve photographic presets. */
export const designs = presets.filter((p) =>
  photos.some((photo) => photo.id === p.wallpaper),
);

export function photoThumbnail(id: string) {
  return `/backgrounds/${id}-thumb.webp`;
}

export function wallpaperUrl(settings: Settings): string {
  if (settings.background?.trim()) return settings.background;
  const selected = photos.find((photo) => photo.id === settings.wallpaper);
  return selected ? `/backgrounds/${selected.id}.webp` : "";
}

/** CSS background-image for the dashboard: upload, photo, gradient or none. */
export function backgroundImage(settings: Settings): string {
  const url = wallpaperUrl(settings);
  if (url) return `url(${JSON.stringify(url)})`;
  return gradients.find((g) => g.id === settings.wallpaper)?.css ?? "";
}

export type BackgroundKind = "none" | "gradient" | "photo" | "upload";
export function backgroundKind(settings: Settings): BackgroundKind {
  if (settings.background?.trim()) return "upload";
  if (photos.some((photo) => photo.id === settings.wallpaper)) return "photo";
  if (gradients.some((g) => g.id === settings.wallpaper)) return "gradient";
  return "none";
}

export function applyPreset(settings: Settings, id: string): Settings {
  const selected = presets.find((p) => p.id === id);
  if (!selected) return { ...settings };
  return {
    ...settings,
    design: selected.palette,
    theme: selected.theme,
    accent: selected.accent,
    wallpaper: selected.wallpaper,
    custom_accent: "",
    background: "",
    background_strength: selected.strength,
    blur: false,
  };
}
export const applyDesign = applyPreset;

/** The preset whose palette, mode, accent and background match the settings. */
export function matchingPreset(settings: Settings) {
  return presets.find(
    (p) =>
      p.palette === settings.design &&
      p.theme === settings.theme &&
      p.accent === settings.accent &&
      !settings.custom_accent &&
      !settings.background &&
      p.wallpaper === settings.wallpaper,
  );
}

/** Extra accent colors offered as one-click custom accents. */
export const extraAccents: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Teal", hex: "#0f766e" },
  { name: "Indigo", hex: "#4f46e5" },
  { name: "Orange", hex: "#c2410c" },
  { name: "Red", hex: "#b91c1c" },
  { name: "Pink", hex: "#be185d" },
  { name: "Lime", hex: "#4d7c0f" },
  { name: "Gold", hex: "#a16207" },
  { name: "Slate", hex: "#475569" },
];

/** Pick the higher-contrast black or white ink for any valid opaque accent. */
export function appearanceStyle(settings: Settings): CSSProperties {
  const accent = settings.custom_accent;
  if (!accent || !/^#[\da-f]{6}$/i.test(accent)) return {};
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  const ink =
    (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
      ? "#000000"
      : "#ffffff";
  // These bound all catalog surfaces: .74 is below the darkest light surface;
  // .07 is the brightest dark surface. A neutral fallback also works when
  // the operating system resolves a system-mode draft differently.
  const contrast = (surface: number) =>
    (Math.max(luminance, surface) + 0.05) /
    (Math.min(luminance, surface) + 0.05);
  const lightInk =
    contrast(0.74) >= 4.5 && contrast(1) >= 4.5 ? accent : "#292929";
  const darkInk =
    contrast(0) >= 4.5 && contrast(0.07) >= 4.5 ? accent : "#f5f5f5";
  return {
    "--accent": accent,
    "--accent-soft": `${accent}1f`,
    "--accent-text": ink,
    "--custom-ink-light": lightInk,
    "--custom-ink-dark": darkInk,
  } as CSSProperties;
}
