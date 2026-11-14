/**
 * Converts dashboard configurations from Homepage, Homer and Dashy into the
 * simple { apps: [...] } import list the server already accepts. Only links
 * are carried over: widgets, layout and theme options have no HomeGrid
 * equivalent. The server validates every converted application again.
 */

export type ForeignFormat = "Homepage" | "Homer" | "Dashy";

export type ImportedApp = {
  name: string;
  url: string;
  category: string;
  icon: string;
  description: string;
};

export type ParsedConfiguration = {
  data: unknown;
  format?: ForeignFormat;
  /** Entries without a usable HTTP(S) link, such as widgets or templates. */
  skipped: number;
};

// Byte limits mirror the server's validation of names and descriptions.
const NAME_BYTES = 100;
const CATEGORY_BYTES = 80;
const DESCRIPTION_BYTES = 500;
const DEFAULT_CATEGORY = "General";

const encoder = new TextEncoder();

function clip(value: unknown, maxBytes: number) {
  if (typeof value !== "string") return "";
  // Every code point takes at least one byte, so start from at most maxBytes.
  const points = Array.from(value.replace(/\s+/g, " ").trim()).slice(
    0,
    maxBytes,
  );
  while (encoder.encode(points.join("")).length > maxBytes) points.pop();
  return points.join("").trimEnd();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The single key of a { name: value } entry, as used by Homepage. */
function single(value: unknown): [string, unknown] | undefined {
  const entry = record(value);
  if (!entry) return undefined;
  const keys = Object.keys(entry);
  return keys.length === 1 ? [keys[0], entry[keys[0]]] : undefined;
}

function link(value: unknown) {
  if (typeof value !== "string") return undefined;
  // Unresolved Homepage templates such as {{HOMEPAGE_VAR_URL}} would survive
  // URL normalization percent-encoded and create a broken application.
  if (/\{\{|\}\}/.test(value)) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

class Collector {
  apps: ImportedApp[] = [];
  skipped = 0;

  add(name: unknown, href: unknown, category: unknown, description: unknown) {
    const url = link(href);
    if (!url) {
      this.skipped++;
      return;
    }
    this.apps.push({
      name: clip(name, NAME_BYTES) || new URL(url).hostname,
      url,
      category: clip(category, CATEGORY_BYTES) || DEFAULT_CATEGORY,
      icon: "",
      description: clip(description, DESCRIPTION_BYTES),
    });
  }
}

// Homepage: services.yaml and bookmarks.yaml are lists of { Group: [...] }.
// A group lists { Name: { href, description } } services, { Name: [{ href }] }
// bookmarks or nested { Subgroup: [...] } groups.
function isHomepage(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((group) => Array.isArray(single(group)?.[1]))
  );
}

// A nested group entry maps its name to a service or a list; a bookmark's
// { href } object maps a key to a plain string instead.
function isGroupEntry(value: unknown) {
  const entry = single(value);
  return !!entry && typeof entry[1] === "object" && entry[1] !== null;
}

function homepageGroup(out: Collector, category: string, items: unknown[]) {
  for (const item of items) {
    const entry = single(item);
    if (!entry) {
      out.skipped++;
      continue;
    }
    const [name, body] = entry;
    const service = record(body);
    if (service) {
      out.add(name, service.href, category, service.description);
    } else if (Array.isArray(body) && body.some(isGroupEntry)) {
      homepageGroup(out, name, body);
    } else if (Array.isArray(body) && record(body[0])) {
      const bookmark = record(body[0])!;
      out.add(name, bookmark.href, category, bookmark.description);
    } else {
      out.skipped++;
    }
  }
}

function fromHomepage(groups: unknown[]) {
  const out = new Collector();
  for (const group of groups) {
    const [name, items] = single(group)!;
    homepageGroup(out, name, items as unknown[]);
  }
  return out;
}

// Homer: config.yml with services: [{ name, items: [{ name, subtitle, url }] }].
// Dashy: conf.yml with sections: [{ name, items: [{ title, description, url }] }].
function fromSections(
  sections: unknown[],
  title: "name" | "title",
  description: "subtitle" | "description",
) {
  const out = new Collector();
  for (const value of sections) {
    const section = record(value);
    if (!section || !Array.isArray(section.items)) {
      out.skipped++;
      continue;
    }
    for (const item of section.items) {
      const entry = record(item);
      if (!entry) {
        out.skipped++;
        continue;
      }
      out.add(entry[title], entry.url, section.name, entry[description]);
    }
  }
  return out;
}

/** Converts a parsed foreign configuration, or returns undefined. */
export function convertForeignConfig(
  value: unknown,
): ParsedConfiguration | undefined {
  let format: ForeignFormat;
  let out: Collector;
  const object = record(value);
  if (isHomepage(value)) {
    format = "Homepage";
    out = fromHomepage(value);
  } else if (object && Array.isArray(object.services)) {
    format = "Homer";
    out = fromSections(object.services, "name", "subtitle");
  } else if (object && Array.isArray(object.sections)) {
    format = "Dashy";
    out = fromSections(object.sections, "title", "description");
  } else {
    return undefined;
  }
  if (out.apps.length === 0)
    throw new Error(
      `This ${format} configuration contains no applications with an HTTP or HTTPS link.`,
    );
  return { data: { apps: out.apps }, format, skipped: out.skipped };
}

/**
 * Reads a HomeGrid backup (JSON) or a Homepage, Homer or Dashy configuration
 * (YAML). JSON keeps its existing handling, including the server's messages.
 */
export async function parseConfiguration(
  text: string,
  fileName: string,
): Promise<ParsedConfiguration> {
  if (/\.json$/i.test(fileName) || /^\s*\{/.test(text))
    return { data: JSON.parse(text) as unknown, skipped: 0 };
  const { parse } = await import("yaml");
  let value: unknown;
  try {
    // Alias expansion is bounded so a small file cannot expand without limit.
    value = parse(text, { maxAliasCount: 100, uniqueKeys: false });
  } catch {
    throw new Error("This file is not valid JSON or YAML.");
  }
  const converted = convertForeignConfig(value);
  if (!converted)
    throw new Error(
      "Choose a HomeGrid backup or a Homepage, Homer or Dashy configuration.",
    );
  return converted;
}
