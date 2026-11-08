import manifest from "./service-catalog.json";
import type { IconColor } from "./lib";

// One curated entry per bundled service logo. service-catalog.json is the
// single source of truth; scripts/sync-service-icons.mjs derives the icon
// files, serviceIcons.ts and the backend allowlist from it.
export interface ServiceEntry {
  id: string;
  name: string;
  category: string;
  color: IconColor;
  description: string;
  keywords: string;
  /** Distinctive alternative names and host labels, normalized to [a-z0-9]. */
  aliases?: readonly string[];
  /** Default ports that identify this service without ambiguity. */
  ports?: readonly number[];
  upstream?: string;
  vendored?: { collection: string; url: string; file: string; license: string };
}

export const serviceCatalog: readonly ServiceEntry[] = Object.freeze(
  manifest.services as ServiceEntry[],
);
