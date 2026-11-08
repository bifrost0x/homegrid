import type { DetectedService } from "./serviceDetection";

type Detect = (name: string, url: string) => DetectedService | undefined;

/**
 * Fills in recognized service logos for imported applications that have no
 * icon of their own. Works on both accepted formats (versioned backups and the
 * simple { apps: [...] } list) and never changes an icon that is already set.
 * Anything that is not shaped like an application is passed through untouched
 * so the server can reject it with its usual validation message.
 */
export function recognizeImportedLogos(data: unknown, detect: Detect) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { data, recognized: 0 };
  const source = data as { apps?: unknown };
  if (!Array.isArray(source.apps)) return { data, recognized: 0 };
  let recognized = 0;
  const apps = source.apps.map((app: unknown) => {
    if (!app || typeof app !== "object" || Array.isArray(app)) return app;
    const entry = app as Record<string, unknown>;
    const icon = entry.icon;
    if (icon !== undefined && icon !== "" && icon !== "favicon") return app;
    if (typeof entry.name !== "string" || typeof entry.url !== "string")
      return app;
    const service = detect(entry.name, entry.url);
    if (!service) return app;
    recognized++;
    return { ...entry, icon: service.icon };
  });
  return { data: { ...source, apps }, recognized };
}
