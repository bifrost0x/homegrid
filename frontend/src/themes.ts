import type { CSSProperties } from "react";
import type { Settings } from "./lib";

export const designs: ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  theme: "light" | "dark";
  accent: Settings["accent"];
  wallpaper: string;
}> = [
  {
    id: "homegrid",
    name: "HomeGrid",
    description: "Alpine peaks, a mirror lake and morning light",
    theme: "light",
    accent: "sage",
    wallpaper: "homegrid",
  },
  {
    id: "porcelain",
    name: "Porcelain",
    description: "White island houses above a cobalt sea",
    theme: "light",
    accent: "blue",
    wallpaper: "porcelain",
  },
  {
    id: "dune",
    name: "Dune",
    description: "Golden dunes, wind-carved ridges and a wide horizon",
    theme: "light",
    accent: "amber",
    wallpaper: "dune",
  },
  {
    id: "terracotta",
    name: "Terracotta",
    description: "Red canyon walls under a dramatic sunset",
    theme: "light",
    accent: "rose",
    wallpaper: "terracotta",
  },
  {
    id: "rosewood",
    name: "Rosewood",
    description: "Crimson maples around a quiet Japanese pond",
    theme: "dark",
    accent: "rose",
    wallpaper: "rosewood",
  },
  {
    id: "lavender",
    name: "Lavender",
    description: "Lavender hills and a farmhouse at blue hour",
    theme: "light",
    accent: "violet",
    wallpaper: "lavender",
  },
  {
    id: "forest",
    name: "Forest",
    description: "Sunbeams, old cedars and a moss-covered river",
    theme: "dark",
    accent: "sage",
    wallpaper: "forest",
  },
  {
    id: "lagoon",
    name: "Lagoon",
    description: "A turquoise lagoon and a secluded island beach",
    theme: "light",
    accent: "cyan",
    wallpaper: "lagoon",
  },
  {
    id: "arctic",
    name: "Arctic",
    description: "Blue icebergs beneath snow-covered mountains",
    theme: "light",
    accent: "blue",
    wallpaper: "arctic",
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Rainlit city architecture in blue and amber",
    theme: "dark",
    accent: "blue",
    wallpaper: "midnight",
  },
  {
    id: "aurora",
    name: "Aurora",
    description: "Northern lights reflected in a mountain fjord",
    theme: "dark",
    accent: "violet",
    wallpaper: "aurora",
  },
  {
    id: "ember",
    name: "Ember",
    description: "A volcanic coast beneath an orange evening sky",
    theme: "dark",
    accent: "amber",
    wallpaper: "ember",
  },
];

export function wallpaperUrl(settings: Settings): string {
  if (settings.background?.trim()) return settings.background;
  const selected = designs.find((design) => design.id === settings.wallpaper);
  return selected ? `/backgrounds/${selected.id}.webp` : "";
}

export function applyDesign(settings: Settings, id: string): Settings {
  const selected = designs.find((design) => design.id === id);
  if (!selected) return { ...settings };
  return {
    ...settings,
    design: selected.id,
    theme: selected.theme,
    accent: selected.accent,
    wallpaper: selected.wallpaper,
    custom_accent: "",
    background: "",
    background_strength: "balanced",
    blur: false,
  };
}

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
