// Bundled service logos are referenced as "service:<id>" and served from
// /service-icons/<id>.svg. This module is part of the entry bundle, so it only
// checks the format: the server's ValidIcon allowlist decides which ids can
// be stored, and an unknown file simply fails to load and falls back to a
// vector icon. Names and aliases live in the lazily loaded serviceIndex.ts.
const SERVICE_ICON = /^service:([a-z0-9][a-z0-9-]{0,63})$/;

export function serviceIconUrl(icon: string): string {
  const id = SERVICE_ICON.exec(icon)?.[1];
  return id ? `/service-icons/${id}.svg` : "";
}
