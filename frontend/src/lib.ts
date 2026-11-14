import { emit } from "./events";
export type IconColor =
  "auto" | "sage" | "blue" | "amber" | "rose" | "violet" | "cyan";
export interface Application {
  id: number;
  name: string;
  url: string;
  description: string;
  icon: string;
  category_id: number;
  sort_order: number;
  open_in_new_tab: boolean;
  favorite: boolean;
  icon_color: IconColor;
}
export interface Category {
  id: number;
  name: string;
  sort_order: number;
  collapsed: boolean;
}
export interface Settings {
  title: string;
  theme: "system" | "light" | "dark";
  accent: "sage" | "blue" | "amber" | "rose" | "violet" | "cyan";
  density: "comfortable" | "compact";
  radius: "rounded" | "square";
  background: string;
  blur: boolean;
  show_descriptions: boolean;
  design: string;
  wallpaper: string;
  custom_accent: string;
  background_strength: "subtle" | "balanced" | "vivid";
  content_width: "focused" | "standard" | "wide" | "full";
  columns: "auto" | "2" | "3" | "4" | "5" | "6";
  group_columns: "1" | "2" | "3";
  card_style: "cards" | "tiles" | "list";
  status_checks: boolean;
  web_search: WebSearchEngine | "";
  web_search_url: string;
}
export type WebSearchEngine =
  "duckduckgo" | "startpage" | "brave" | "google" | "bing" | "custom";
export const searchEngines: Record<
  Exclude<WebSearchEngine, "custom">,
  { name: string; template: string }
> = {
  duckduckgo: { name: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s" },
  startpage: {
    name: "Startpage",
    template: "https://www.startpage.com/do/search?q=%s",
  },
  brave: {
    name: "Brave Search",
    template: "https://search.brave.com/search?q=%s",
  },
  google: { name: "Google", template: "https://www.google.com/search?q=%s" },
  bing: { name: "Bing", template: "https://www.bing.com/search?q=%s" },
};
/**
 * The name of the selected web search: the engine's name, or the host of a
 * custom address. Undefined while web search is off or misconfigured.
 */
export function webSearchName(
  settings: Pick<Settings, "web_search" | "web_search_url">,
) {
  const url = webSearchUrl(settings, "x");
  if (!url) return undefined;
  return settings.web_search === "custom"
    ? new URL(url).hostname
    : searchEngines[settings.web_search as keyof typeof searchEngines]?.name;
}
/** The web search address for a query, or undefined while web search is off. */
export function webSearchUrl(
  settings: Pick<Settings, "web_search" | "web_search_url">,
  query: string,
) {
  const terms = query.trim();
  if (!terms || !settings.web_search) return undefined;
  const template =
    settings.web_search === "custom"
      ? settings.web_search_url
      : searchEngines[settings.web_search]?.template;
  if (!template || !template.includes("%s")) return undefined;
  const url = template.replace("%s", encodeURIComponent(terms));
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
export type ServiceState = "up" | "down" | "unknown";
export interface ServiceStatus {
  enabled: boolean;
  statuses: Record<string, ServiceState>;
}
export interface Session {
  setup_required: boolean;
  authenticated: boolean;
  username: string;
  csrf_token: string;
}
export interface UndoRecord {
  token: string;
  label: string;
  expires_at: string;
}
export function isExampleApp(app: Pick<Application, "url">): boolean {
  try {
    return new URL(app.url).hostname === "example.homegrid.invalid";
  } catch {
    return false;
  }
}
export const defaults: Settings = {
  title: "Your services, together.",
  theme: "system",
  accent: "sage",
  density: "comfortable",
  radius: "rounded",
  background: "",
  blur: false,
  show_descriptions: true,
  design: "homegrid",
  wallpaper: "none",
  custom_accent: "",
  background_strength: "subtle",
  content_width: "standard",
  columns: "auto",
  group_columns: "1",
  card_style: "cards",
  status_checks: false,
  web_search: "",
  web_search_url: "",
};
let csrf = "";
export function setSession(session: Session) {
  csrf = session.csrf_token;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  /** Background polls do not count as use and never extend the session. */
  options: { background?: boolean } = {},
): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...(options.background ? { "X-HomeGrid-Background": "1" } : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  if (response.status === 401) {
    emit("homegrid:unauthorized");
  }
  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const error = (await response.json()).error;
      message = error.message;
      if (response.status === 403 && error.code === "csrf") {
        const session = await api<Session>("/auth/session");
        setSession(session);
        emit("homegrid:session-refreshed", session);
        message =
          path === "/auth/login"
            ? "Your sign-in session changed. Please try signing in again."
            : "Your session changed. Please try again.";
      }
    } catch {
      /* Use the safe fallback for non-JSON responses. */
    }
    throw new Error(message);
  }
  if (response.headers.get("X-HomeGrid-Undo")) emit("homegrid:undo-available");
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
export function filterApps(
  apps: Application[],
  categories: Category[],
  query: string,
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  return apps
    .map((app, index) => {
      const name = app.name.toLocaleLowerCase();
      const text = [
        name,
        app.description,
        categoryNames.get(app.category_id) ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase();
      const matches = words.every((word) => text.includes(word));
      const rank =
        words.filter((word) => name.includes(word)).length * 100 +
        (app.favorite ? 10 : 0);
      return { app, index, matches, rank };
    })
    .filter((item) => item.matches)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((item) => item.app);
}
export function appHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "Application";
  }
}
export function duplicateName(name: string): string {
  const suffix = " copy";
  let prefix = "";
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(name.trim())) {
    if (new TextEncoder().encode(prefix + segment + suffix).length > 100) break;
    prefix += segment;
  }
  return (prefix.trimEnd() || "Application") + suffix;
}
export function suggestAppName(value: string): string {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return "";
    const host = url.hostname.replace(/^www\./i, "");
    if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
    return host
      .split(".")[0]
      .replace(/[-_]+/g, " ")
      .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
  } catch {
    return "";
  }
}
export function faviconPreviewUrl(value: string): string {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.origin
      : "";
  } catch {
    return "";
  }
}
export function moveApplication(
  apps: Application[],
  id: number,
  offset: number,
) {
  const app = apps.find((a) => a.id === id);
  if (!app) return apps.map((a) => a.id);
  const siblings = apps.filter((a) => a.category_id === app.category_id);
  const neighbor = siblings[siblings.findIndex((a) => a.id === id) + offset];
  const ids = apps.map((a) => a.id);
  if (!neighbor) return ids;
  const from = ids.indexOf(id),
    to = ids.indexOf(neighbor.id);
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}
export function launch(app: Application) {
  if (isExampleApp(app)) {
    emit("homegrid:configure-example", app);
    return;
  }
  if (app.open_in_new_tab)
    window.open(app.url, "_blank", "noopener,noreferrer");
  else window.location.assign(app.url);
}
export function validateImageFile(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Choose an image smaller than 5 MB.");
}
export async function upload(file: File) {
  validateImageFile(file);
  const form = new FormData();
  form.append("file", file);
  return (await api<{ url: string }>("/uploads", "POST", form)).url;
}
