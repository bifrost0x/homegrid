import { useEffect, useState } from "react";
import type { Settings } from "../lib";
import { appearanceStyle } from "../themes";

const customProperties = [
  "--accent",
  "--accent-soft",
  "--accent-text",
  "--custom-ink-light",
  "--custom-ink-dark",
] as const;

function useSystemDark() {
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return dark;
}

/** Applies saved appearance settings to the document root and title. */
export function useAppearance(settings: Settings) {
  const systemDark = useSystemDark();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme =
      settings.theme === "system"
        ? systemDark
          ? "dark"
          : "light"
        : settings.theme;
    root.dataset.accent = settings.accent;
    root.dataset.design = settings.design;
    const customStyle = appearanceStyle(settings);
    for (const key of customProperties) {
      const value = customStyle[key as keyof typeof customStyle];
      if (value) root.style.setProperty(key, String(value));
      else root.style.removeProperty(key);
    }
    document.title = settings.title + " · HomeGrid";
  }, [settings, systemDark]);
}
