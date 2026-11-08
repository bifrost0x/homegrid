import {
  Server,
  Cloud,
  Database,
  Film,
  Music,
  House,
  Shield,
  Code,
  Globe,
  Folder,
  Network,
  HardDrive,
  Camera,
  Image,
  BookOpen,
  FileText,
  Notebook,
  Mail,
  Calendar,
  Clock,
  Router,
  Container,
  Monitor,
  Smartphone,
  Printer,
  Download,
  Archive,
  Rss,
  Link,
  Key,
  Lock,
  Wifi,
  Lightbulb,
  Heart,
  Gamepad,
  MapPin,
  Terminal,
  GitBranch,
  Headphones,
  Search,
  Settings,
  ChartLine,
  Clipboard,
  Bookmark,
  type LucideIcon,
} from "lucide-react";
import type { IconColor } from "./lib";
import { serviceCatalog } from "./serviceCatalog";

const catalog: Record<string, [LucideIcon, string]> = {
  server: [Server, "host machine rack computing"],
  cloud: [Cloud, "sync storage nextcloud"],
  database: [Database, "sql postgres mysql data"],
  film: [Film, "movies video media jellyfin plex cinema"],
  music: [Music, "audio songs lidarr navidrome"],
  home: [House, "house smart assistant automation"],
  shield: [Shield, "security firewall protection adguard pihole"],
  code: [Code, "development editor programming"],
  globe: [Globe, "web browser internet"],
  folder: [Folder, "files directory syncthing"],
  network: [Network, "lan connection vpn wireguard tailscale"],
  "hard-drive": [HardDrive, "disk nas storage truenas"],
  camera: [Camera, "surveillance security photo nvr frigate"],
  image: [Image, "photos pictures gallery immich photoprism"],
  "book-open": [BookOpen, "reading ebooks library kavita calibre"],
  "file-text": [FileText, "documents pdf paperless"],
  notebook: [Notebook, "notes recipes mealie writing"],
  mail: [Mail, "email inbox messages"],
  calendar: [Calendar, "events dates schedule"],
  clock: [Clock, "time timers schedule"],
  router: [Router, "network proxy nginx traefik routing"],
  container: [Container, "docker portainer dockge containers"],
  monitor: [Monitor, "display desktop remote sonarr guacamole"],
  smartphone: [Smartphone, "mobile phone device"],
  printer: [Printer, "printing paper"],
  download: [Download, "torrent transfer qbittorrent transmission sabnzbd"],
  archive: [Archive, "backup zip compression storage"],
  rss: [Rss, "feeds news freshrss miniflux"],
  link: [Link, "urls links shortcuts"],
  key: [Key, "password secrets vaultwarden credentials"],
  lock: [Lock, "authentication identity login authentik authelia"],
  wifi: [Wifi, "wireless network access"],
  lightbulb: [Lightbulb, "lights ideas automation"],
  heart: [Heart, "health uptime kuma favorites"],
  gamepad: [Gamepad, "gaming games emulator"],
  "map-pin": [MapPin, "location maps navigation"],
  terminal: [Terminal, "shell command console ssh"],
  "git-branch": [GitBranch, "git repository gitea forgejo gitlab source"],
  headphones: [Headphones, "audiobooks podcasts listening audiobookshelf"],
  search: [Search, "find discovery lookup"],
  settings: [Settings, "configuration preferences management"],
  chart: [ChartLine, "graphs analytics grafana prometheus metrics"],
  clipboard: [Clipboard, "tasks checklist clipboard"],
  bookmark: [Bookmark, "saved links reading linkwarden"],
};
export const icons: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(catalog).map(([id, [Icon]]) => [id, Icon]),
);
export function findIcons(query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return Object.entries(icons).filter(([id]) =>
    words.every((word) => (id + " " + catalog[id][1]).includes(word)),
  );
}
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
