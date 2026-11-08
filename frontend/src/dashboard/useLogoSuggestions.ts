import { useEffect, useState } from "react";
import { isExampleApp, type Application } from "../lib";
import type { DetectedService } from "../serviceDetection";

export interface LogoSuggestion {
  app: Application;
  service: DetectedService;
  /**
   * Automatic and favicon icons are replaced by default. A generic built-in
   * icon may be a deliberate choice, so it is only offered.
   */
  recommended: boolean;
}

/** Icons that a recognized service logo may replace. Uploads never qualify. */
function replaceable(icon: string) {
  return icon === "" || icon === "favicon" || icon.startsWith("builtin:");
}

export function findLogoSuggestions(
  apps: Application[],
  detect: (name: string, url: string) => DetectedService | undefined,
): LogoSuggestion[] {
  const suggestions: LogoSuggestion[] = [];
  for (const app of apps) {
    if (isExampleApp(app) || !replaceable(app.icon)) continue;
    const service = detect(app.name, app.url);
    if (!service || service.icon === app.icon) continue;
    suggestions.push({
      app,
      service,
      recommended: !app.icon.startsWith("builtin:"),
    });
  }
  return suggestions;
}

/** A stable fingerprint so a dismissed set of suggestions stays dismissed. */
export function suggestionKey(suggestions: LogoSuggestion[]) {
  return suggestions
    .map((s) => s.app.id + ":" + s.service.id)
    .sort()
    .join(",");
}

/** Recognizes logos for existing applications; loads the catalog lazily. */
export function useLogoSuggestions(apps: Application[]) {
  const [suggestions, setSuggestions] = useState<LogoSuggestion[]>([]);
  const signature = apps
    .map((app) => [app.id, app.name, app.url, app.icon].join("\u0000"))
    .join("\u0001");
  useEffect(() => {
    if (!apps.length) {
      setSuggestions([]);
      return;
    }
    let current = true;
    void import("../serviceDetection").then(({ detectService }) => {
      if (current) setSuggestions(findLogoSuggestions(apps, detectService));
    });
    return () => {
      current = false;
    };
    // The signature captures every field detection depends on, so a new
    // array with the same content does not trigger another pass.
  }, [signature]);
  return suggestions;
}

const dismissedKey = "homegrid.logo-suggestions.dismissed";

export function readDismissed() {
  try {
    return localStorage.getItem(dismissedKey) ?? "";
  } catch {
    return "";
  }
}
export function writeDismissed(key: string) {
  try {
    localStorage.setItem(dismissedKey, key);
  } catch {
    /* Storage can be unavailable; the banner then simply returns next visit. */
  }
}
