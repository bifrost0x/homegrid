import type { IconColor } from "./lib";
import { serviceCatalog } from "./serviceCatalog";

export { icons, findIcons } from "./builtinIcons";

export interface ServiceTemplate {
  name: string;
  description: string;
  icon: string;
  icon_color: IconColor;
  keywords: string;
  category: string;
  /** Curated alternative names, normalized to lowercase letters and digits. */
  aliases?: readonly string[];
}
export const serviceCategories = [
  "Media",
  "Storage",
  "Tools",
  "Security",
  "Automation",
  "Network",
  "Monitoring",
  "Infrastructure",
  "Development",
  "Downloads",
  "Communication",
  "AI",
  "Games",
] as const;

// Templates are derived from the curated service catalog in catalog order,
// which keeps the long-standing services first.
export const serviceTemplates: ServiceTemplate[] = serviceCatalog.map(
  (service) => ({
    name: service.name,
    description: service.description,
    icon: "service:" + service.id,
    icon_color: service.color,
    keywords: service.keywords,
    category: service.category,
    aliases: service.aliases ?? [],
  }),
);
// Filters templates by every query word, then lists services whose name or
// alias equals or starts with the query before other matches.
export function findTemplates(query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const compact = words.join("").replace(/[^\p{L}\p{N}]/gu, "");
  const rank = (t: ServiceTemplate) => {
    if (!compact) return 0;
    const names = [t.name, ...(t.aliases ?? [])].map((name) =>
      name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, ""),
    );
    if (names.includes(compact)) return 0;
    return names.some((name) => name.startsWith(compact)) ? 1 : 2;
  };
  return serviceTemplates
    .filter((t) =>
      words.every((word) =>
        [t.name, t.description, t.keywords, t.category, ...(t.aliases ?? [])]
          .join(" ")
          .toLocaleLowerCase()
          .includes(word),
      ),
    )
    .map((t, index) => ({ t, index, rank: rank(t) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ t }) => t);
}
