import { serviceCatalog } from "./serviceCatalog";
import { serviceIcons, type ServiceIcon } from "./serviceIndex";

export type DetectionSignal = "name" | "host" | "path" | "port";

export interface DetectedService {
  id: string;
  name: string;
  icon: string;
  signal: DetectionSignal;
}

// Hostname labels and name words that never identify a service on their own.
export const GENERIC_LABELS: ReadonlySet<string> = new Set([
  "www",
  "home",
  "lan",
  "local",
  "localhost",
  "localdomain",
  "internal",
  "intranet",
  "app",
  "apps",
  "my",
  "web",
  "server",
  "srv",
  "host",
  "homelab",
  "lab",
  "dashboard",
  "admin",
  "portal",
]);

// Real service names that are too common in hostnames to trust: "vault" is far
// more often Vaultwarden than HashiCorp Vault, "stash" or "flood" can be
// anything. They only match an application name that is exactly the service
// name ("Outline"), never a word inside a longer name or a hostname label.
export const AMBIGUOUS_KEYS: ReadonlySet<string> = new Set([
  "vault",
  "element",
  "stash",
  "flood",
  "outline",
]);

// Product names in the extended tier that are ordinary words or file types.
// An application called "Files" or a host named "router" says nothing about
// which product it runs, so these never identify an extended logo. Curated
// services are reviewed by hand and do not need this list.
export const COMMON_WORDS: ReadonlySet<string> = new Set([
  "act",
  "acme",
  "agenda",
  "anchor",
  "api",
  "apollo",
  "astral",
  "astro",
  "aura",
  "backup",
  "bios",
  "bottom",
  "box",
  "broker",
  "buy",
  "buzz",
  "calc",
  "cards",
  "charts",
  "chess",
  "cloud",
  "cmd",
  "cms",
  "code",
  "config",
  "cosmic",
  "csv",
  "cup",
  "dia",
  "disc",
  "docs",
  "drop",
  "duo",
  "dvd",
  "edge",
  "email",
  "erp",
  "exe",
  "files",
  "folder",
  "forge",
  "forte",
  "haptic",
  "helix",
  "hermes",
  "hosting",
  "html",
  "hydra",
  "ide",
  "json",
  "kick",
  "linear",
  "linux",
  "locals",
  "mail",
  "maps",
  "matter",
  "max",
  "may",
  "maybe",
  "md",
  "media",
  "meta",
  "micro",
  "monitor",
  "msi",
  "music",
  "nas",
  "nebula",
  "network",
  "notes",
  "one",
  "orange",
  "orb",
  "origin",
  "otp",
  "paper",
  "pdf",
  "phase",
  "photos",
  "plume",
  "podcast",
  "policy",
  "poly",
  "pulse",
  "quest",
  "ramp",
  "rapid",
  "reader",
  "router",
  "send",
  "sell",
  "shadow",
  "shell",
  "shop",
  "slash",
  "slice",
  "sql",
  "ssh",
  "stacks",
  "status",
  "storage",
  "storm",
  "sure",
  "svg",
  "tempo",
  "tether",
  "thread",
  "torrent",
  "trading",
  "tunnels",
  "txt",
  "unity",
  "ups",
  "upload",
  "vector",
  "video",
  "view",
  "vps",
  "waves",
  "wiki",
]);
const MIN_EXTENDED_KEY = 3;

// Keys shorter than this (curated aliases such as "ha", "jf" or "pve") only
// match a complete name or hostname label, never a word inside a longer name.
const MIN_PARTIAL_KEY = 4;
const MAX_NAME_WORDS = 4;
// Mirrors the server's application limits (100 bytes name, 2048 bytes URL).
const MAX_NAME_LENGTH = 100;
const MAX_URL_LENGTH = 2048;

export function serviceKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// One pass over all logos, curated first, so a curated service keeps every
// key it shares with an extended logo. Ports only come from the curated
// catalog, where each one is checked to be distinctive.
function buildIndexes(services: readonly ServiceIcon[]) {
  const keys = new Map<string, ServiceIcon>();
  const exactOnly = new Map<string, ServiceIcon>();
  for (const service of services) {
    for (const key of [
      serviceKey(service.id),
      serviceKey(service.name),
      ...service.aliases,
    ]) {
      if (key.length < 2 || GENERIC_LABELS.has(key)) continue;
      if (
        !service.curated &&
        (key.length < MIN_EXTENDED_KEY || COMMON_WORDS.has(key))
      )
        continue;
      // "Vault" alone usually means Vaultwarden; never guess HashiCorp Vault.
      if (key === "vault") continue;
      const index = AMBIGUOUS_KEYS.has(key) ? exactOnly : keys;
      if (!index.has(key)) index.set(key, service);
    }
  }
  const byId = new Map(services.map((service) => [service.id, service]));
  const ports = new Map<number, ServiceIcon>();
  for (const service of serviceCatalog)
    for (const port of service.ports ?? [])
      if (!ports.has(port)) ports.set(port, byId.get(service.id)!);
  return { keys, exactOnly, ports };
}

const {
  keys: keyIndex,
  exactOnly: exactIndex,
  ports: portIndex,
} = buildIndexes(serviceIcons);

function lookup(
  key: string,
  partial: boolean,
  exact = false,
): ServiceIcon | undefined {
  if (partial && key.length < MIN_PARTIAL_KEY) return undefined;
  if (GENERIC_LABELS.has(key)) return undefined;
  return keyIndex.get(key) ?? (exact ? exactIndex.get(key) : undefined);
}

// A linear scan: /\d+$/ backtracks quadratically on long digit runs.
function withoutTrailingDigits(key: string) {
  let end = key.length;
  while (
    end > 0 &&
    key.charCodeAt(end - 1) >= 48 &&
    key.charCodeAt(end - 1) <= 57
  )
    end--;
  return key.slice(0, end);
}

// Accepts "jellyfin2" or "pve-01" by retrying without a trailing number.
function lookupWithSuffix(key: string, partial: boolean, exact = false) {
  const found = lookup(key, partial, exact);
  if (found) return { service: found, length: key.length };
  const trimmed = withoutTrailingDigits(key);
  if (trimmed && trimmed !== key) {
    const service = lookup(trimmed, partial, exact);
    if (service) return { service, length: trimmed.length };
  }
  return undefined;
}

// Matches a sequence of words: the whole sequence first, then the longest
// run of up to four adjacent words ("my nginx proxy manager" prefers Nginx
// Proxy Manager over NGINX). Ties go to the earliest run, so the result does
// not depend on catalog order. Ambiguous names only count when `wholeName`
// is set and they are the entire application name.
function matchWords(
  words: string[],
  wholeName = false,
): ServiceIcon | undefined {
  if (!words.length) return undefined;
  const whole = lookupWithSuffix(words.join(""), false, wholeName);
  if (whole) return whole.service;
  let best: { service: ServiceIcon; length: number } | undefined;
  for (let start = 0; start < words.length; start++)
    for (
      let end = Math.min(words.length, start + MAX_NAME_WORDS);
      end > start;
      end--
    ) {
      const match = lookupWithSuffix(words.slice(start, end).join(""), true);
      if (match && (!best || match.length > best.length)) best = match;
    }
  return best?.service;
}

function words(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function parseServiceUrl(value: string): URL | undefined {
  const text = value.trim();
  if (!text) return undefined;
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : "http://" + text,
    );
    return ["http:", "https:"].includes(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

function hostLabels(hostname: string): string[] {
  if (!hostname || hostname.startsWith("[") || /^[\d.]+$/.test(hostname))
    return [];
  const labels = hostname.replace(/\.$/, "").split(".");
  // The last label of a multi-label name is a TLD or a local suffix.
  return labels.length > 1 ? labels.slice(0, -1) : labels;
}

function matchHost(url: URL): ServiceIcon | undefined {
  for (const label of hostLabels(url.hostname)) {
    if (GENERIC_LABELS.has(label)) continue;
    const service = matchWords(label.split(/[-_]+/).filter(Boolean));
    if (service) return service;
  }
  return undefined;
}

function matchPath(url: URL): ServiceIcon | undefined {
  const segment = url.pathname.split("/").find(Boolean);
  if (!segment) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return lookupWithSuffix(serviceKey(decoded), true)?.service;
}

function matchPort(url: URL): ServiceIcon | undefined {
  return url.port ? portIndex.get(Number(url.port)) : undefined;
}

/**
 * Recognizes a bundled service from what a user typed. Signals are tried in
 * order of reliability and the first match wins: the application name, the
 * hostname labels (left to right), the first URL path segment and finally a
 * distinctive default port. Returns undefined when nothing is recognized.
 */
export function detectService(
  name: string,
  url: string,
): DetectedService | undefined {
  // Detection also runs on imported files before the server validates them;
  // anything beyond the server's limits can never be saved anyway.
  if (name.length > MAX_NAME_LENGTH || url.length > MAX_URL_LENGTH)
    return undefined;
  const parsed = parseServiceUrl(url);
  const candidates: [DetectionSignal, () => ServiceIcon | undefined][] = [
    ["name", () => matchWords(words(name), true)],
    ["host", () => (parsed ? matchHost(parsed) : undefined)],
    ["path", () => (parsed ? matchPath(parsed) : undefined)],
    ["port", () => (parsed ? matchPort(parsed) : undefined)],
  ];
  for (const [signal, match] of candidates) {
    const service = match();
    if (service)
      return {
        id: service.id,
        name: service.name,
        icon: "service:" + service.id,
        signal,
      };
  }
  return undefined;
}
