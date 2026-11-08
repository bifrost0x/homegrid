import { serviceCatalog } from "./serviceCatalog";
import { extendedServiceIcons } from "./serviceIconsExtended";

// Every bundled service logo: the curated catalog in catalog order, then the
// extended tier generated from the upstream collection. Large, so only the
// lazily loaded form, picker and detection modules import it.
export interface ServiceIcon {
  id: string;
  name: string;
  category: string;
  /** Alternative names, normalized to [a-z0-9]. */
  aliases: readonly string[];
  curated: boolean;
}

export const serviceIcons: readonly ServiceIcon[] = Object.freeze([
  ...serviceCatalog.map((service) => ({
    id: service.id,
    name: service.name,
    category: service.category,
    aliases: service.aliases ?? [],
    curated: true,
  })),
  ...extendedServiceIcons.map(([id, name, category, ...aliases]) => ({
    id,
    name,
    category,
    aliases,
    curated: false,
  })),
]);

const byId = new Map(serviceIcons.map((icon) => [icon.id, icon]));

/** Looks up a bundled logo by "service:<id>" or by its bare id. */
export function findServiceIcon(icon: string): ServiceIcon | undefined {
  return byId.get(icon.startsWith("service:") ? icon.slice(8) : icon);
}

const compact = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// Precomputed once: the text every query word must occur in, and the
// compact keys that rank exact and prefix matches first.
const searchable = serviceIcons.map((icon, index) => ({
  icon,
  index,
  text: [icon.id, icon.name, ...icon.aliases].join(" ").toLocaleLowerCase(),
  keys: [compact(icon.id), compact(icon.name), ...icon.aliases],
}));

/**
 * Logos matching every word of the query in their id, name or aliases.
 * Exact name or alias matches come first, then prefix matches, then the
 * rest; within each group curated logos precede extended ones. An empty
 * query returns the curated catalog.
 */
export function searchServiceIcons(query: string): ServiceIcon[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return serviceIcons.filter((icon) => icon.curated);
  const joined = compact(words.join(""));
  const rank = (keys: string[]) =>
    !joined
      ? 2
      : keys.includes(joined)
        ? 0
        : keys.some((key) => key.startsWith(joined))
          ? 1
          : 2;
  return searchable
    .filter(({ text }) => words.every((word) => text.includes(word)))
    .map((entry) => ({ ...entry, rank: rank(entry.keys) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ icon }) => icon);
}
