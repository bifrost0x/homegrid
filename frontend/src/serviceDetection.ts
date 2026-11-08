import { serviceCatalog, type ServiceEntry } from "./serviceCatalog";

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
// anything. These services are still found by their full or alias names.
export const AMBIGUOUS_KEYS: ReadonlySet<string> = new Set([
  "vault",
  "element",
  "stash",
  "flood",
  "outline",
]);

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

function buildIndexes(services: readonly ServiceEntry[]) {
  const keys = new Map<string, ServiceEntry>();
  const ports = new Map<number, ServiceEntry>();
  for (const service of services) {
    for (const key of [
      service.id,
      serviceKey(service.name),
      ...(service.aliases ?? []),
    ])
      if (
        key.length >= 2 &&
        !keys.has(key) &&
        !GENERIC_LABELS.has(key) &&
        !AMBIGUOUS_KEYS.has(key)
      )
        keys.set(key, service);
    for (const port of service.ports ?? [])
      if (!ports.has(port)) ports.set(port, service);
  }
  return { keys, ports };
}

const { keys: keyIndex, ports: portIndex } = buildIndexes(serviceCatalog);

function lookup(key: string, partial: boolean): ServiceEntry | undefined {
  if (partial && key.length < MIN_PARTIAL_KEY) return undefined;
  if (GENERIC_LABELS.has(key)) return undefined;
  return keyIndex.get(key);
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
function lookupWithSuffix(key: string, partial: boolean) {
  const exact = lookup(key, partial);
  if (exact) return { service: exact, length: key.length };
  const trimmed = withoutTrailingDigits(key);
  if (trimmed && trimmed !== key) {
    const service = lookup(trimmed, partial);
    if (service) return { service, length: trimmed.length };
  }
  return undefined;
}

// Matches a sequence of words: the whole sequence first, then the longest
// run of up to four adjacent words ("my nginx proxy manager" prefers Nginx
// Proxy Manager over NGINX). Ties go to the earliest run, so the result does
// not depend on catalog order.
function matchWords(words: string[]): ServiceEntry | undefined {
  if (!words.length) return undefined;
  const whole = lookupWithSuffix(words.join(""), false);
  if (whole) return whole.service;
  let best: { service: ServiceEntry; length: number } | undefined;
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

function matchHost(url: URL): ServiceEntry | undefined {
  for (const label of hostLabels(url.hostname)) {
    if (GENERIC_LABELS.has(label)) continue;
    const service = matchWords(label.split(/[-_]+/).filter(Boolean));
    if (service) return service;
  }
  return undefined;
}

function matchPath(url: URL): ServiceEntry | undefined {
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

function matchPort(url: URL): ServiceEntry | undefined {
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
  const candidates: [DetectionSignal, () => ServiceEntry | undefined][] = [
    ["name", () => matchWords(words(name))],
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
