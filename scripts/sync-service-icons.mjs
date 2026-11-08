#!/usr/bin/env node
// Synchronizes the bundled service logos with frontend/src/service-catalog.json
// and the upstream Dashboard Icons collection.
//
// Usage (from the repository root):
//   node scripts/sync-service-icons.mjs            download, verify and regenerate
//   node scripts/sync-service-icons.mjs --offline  regenerate from the local SVGs
//   node scripts/sync-service-icons.mjs --check    fail if any generated file is stale
//
// Two tiers are bundled. Curated services are hand-written in
// service-catalog.json and also become templates. Every other SVG icon in the
// upstream collection becomes an extended entry, derived from the upstream
// metadata.json. Downloads come from a single pinned upstream commit. Every
// file is checked against the git blob hash published in the upstream tree,
// must pass the static-artwork gate before and after minification, and is
// recorded with both hashes in service-catalog.lock.json. Nothing is fetched
// at runtime by HomeGrid itself. Set GITHUB_TOKEN to raise the API rate limit.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { minifySvg } from "./svg-minify.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  manifest: join(root, "frontend/src/service-catalog.json"),
  lock: join(root, "frontend/src/service-catalog.lock.json"),
  icons: join(root, "frontend/public/service-icons"),
  typescript: join(root, "frontend/src/serviceIconsExtended.ts"),
  go: join(root, "internal/store/service_icons_gen.go"),
  inventory: join(root, "docs/third-party-icons.md"),
  notice: join(root, "frontend/public/service-icons/NOTICE.txt"),
};
export const MAX_SVG_BYTES = 60 * 1024;
// Larger upstream files are not even downloaded: minification removes editor
// data, never embedded bitmaps, so they cannot get below MAX_SVG_BYTES.
const MAX_DOWNLOAD_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_CONCURRENCY = 8;
const COLORS = new Set(["sage", "blue", "amber", "rose", "violet", "cyan"]);
// Mirrors the frontend's format check for "service:<id>" values.
const EXTENDED_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function fail(message) {
  console.error(`sync-service-icons: ${message}`);
  process.exit(1);
}

// Returns the reasons an SVG must not be bundled; an empty list means it may
// ship. The rules mirror frontend/src/service-icons.test.ts: no scripting, no
// event handlers, no external references, no DTD tricks, no animation and
// nothing that could trigger a network request. The only embedded content
// allowed is a base64 raster bitmap inside <image>, which an <img>-loaded SVG
// renders without any further loading. Pass bytes = 0 to skip the size limit.
export const RASTER_DATA_URI =
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;
export function svgProblems(svg, bytes = Buffer.byteLength(svg)) {
  const problems = [];
  if (bytes > MAX_SVG_BYTES)
    problems.push(`larger than ${MAX_SVG_BYTES} bytes`);
  const rules = [
    [/<script\b/i, "contains <script>"],
    [/<foreignObject\b/i, "contains <foreignObject>"],
    [/<(iframe|embed|object|audio|video)\b/i, "embeds external content"],
    [/<(animate|animateTransform|animateMotion|set)\b/i, "contains animation"],
    [
      /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i,
      "contains a DTD or stylesheet PI",
    ],
    [/javascript:/i, "contains a javascript: URL"],
    [/\son[a-z]+\s*=/i, "contains an event handler attribute"],
    [/@import|expression\s*\(/i, "contains CSS imports or expressions"],
    [
      /(?:-webkit-)?image-set\s*\(|cross-fade\s*\(/i,
      "contains a CSS image function",
    ],
  ];
  for (const [pattern, reason] of rules)
    if (pattern.test(svg)) problems.push(reason);
  for (const tag of svg.matchAll(/<([a-zA-Z][\w:.-]*)\b([^>]*)>/g)) {
    const element = tag[1].toLowerCase();
    for (const match of tag[2].matchAll(
      // Any namespace prefix can be bound to XLink, so match every *:href.
      /\s(?:[\w.-]+:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    )) {
      const value = match[1] ?? match[2];
      if (/^#[\w.-]+$/.test(value)) continue;
      if (
        element === "image" &&
        RASTER_DATA_URI.test(value.replace(/&#(?:10|13|x[aAdD]);/g, ""))
      )
        continue;
      problems.push(`external href ${value.slice(0, 40)}`);
    }
  }
  for (const match of svg.matchAll(/url\(\s*["']?([^\s)"']*)/gi))
    if (!/^#[\w.-]+$/.test(match[1]))
      problems.push(`external url() ${match[1].slice(0, 40)}`);
  for (const match of svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    if (/https?:|\/\//i.test(match[1])) problems.push("style references a URL");
  for (const match of svg.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))
    if (/https?:|\/\//i.test(match[1] ?? match[2]))
      problems.push("style attribute references a URL");
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) problems.push("has no <svg> root");
  else if (!/\s(viewBox|width)\s*=/i.test(open[0]))
    problems.push("has neither viewBox nor width");
  return [...new Set(problems)];
}

// Gates the upstream file, minifies it and gates the result again: removing
// comments or editor markup must never produce something the gate rejects.
export function prepareSvg(buffer) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { problems: ["is not valid UTF-8"] };
  }
  const before = svgProblems(text, 0);
  if (before.length) return { problems: before };
  let minified;
  try {
    minified = minifySvg(text);
  } catch (error) {
    return { problems: [`cannot be minified safely (${error.message})`] };
  }
  const output = Buffer.from(minified);
  const after = svgProblems(minified, output.length);
  if (after.length) return { problems: after };
  return { buffer: output };
}

function gitBlobSha(buffer) {
  return createHash("sha1")
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest("hex");
}
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function request(url, accept) {
  const headers = { accept, "user-agent": "homegrid-icon-sync" };
  if (process.env.GITHUB_TOKEN && url.startsWith("https://api.github.com/"))
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

const normalize = (value) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function validateManifest(manifest) {
  const { upstream, services } = manifest;
  if (!/^[\w.-]+\/[\w.-]+$/.test(upstream?.repository ?? ""))
    fail("manifest upstream.repository must be owner/name");
  if (!SHA1.test(upstream?.commit ?? ""))
    fail("manifest upstream.commit must be a full commit SHA");
  if (!Array.isArray(services) || !services.length)
    fail("manifest has no services");
  const ids = new Set(),
    keys = new Map(),
    ports = new Map();
  for (const service of services) {
    const where = `service ${JSON.stringify(service.id)}`;
    if (!/^[a-z0-9]+$/.test(service.id ?? "")) fail(`${where}: invalid id`);
    if (ids.has(service.id)) fail(`${where}: duplicate id`);
    ids.add(service.id);
    for (const field of ["name", "category", "description", "keywords"])
      if (typeof service[field] !== "string" || !service[field].trim())
        fail(`${where}: missing ${field}`);
    if (!COLORS.has(service.color)) fail(`${where}: unsupported color`);
    if (!!service.upstream === !!service.vendored)
      fail(`${where}: needs exactly one of upstream or vendored`);
    for (const file of [service.upstream, ...(service.fallbacks ?? [])])
      if (file !== undefined && !/^[a-z0-9][a-z0-9.-]*\.svg$/.test(file))
        fail(`${where}: invalid upstream file ${file}`);
    if (service.vendored) {
      for (const field of ["collection", "url", "file", "license"])
        if (typeof service.vendored[field] !== "string")
          fail(`${where}: vendored.${field} is required`);
      if (service.vendored.file !== `${service.id}.svg`)
        fail(`${where}: vendored.file must be ${service.id}.svg`);
      if (!COLLECTIONS[service.vendored.collection])
        fail(`${where}: unknown collection ${service.vendored.collection}`);
    }
    for (const alias of service.aliases ?? [])
      if (alias !== normalize(alias) || !alias)
        fail(`${where}: alias ${alias} must be lowercase letters and digits`);
    for (const key of new Set([
      service.id,
      normalize(service.name),
      ...(service.aliases ?? []),
    ])) {
      if (keys.has(key) && keys.get(key) !== service.id)
        fail(`${where}: "${key}" is also claimed by ${keys.get(key)}`);
      keys.set(key, service.id);
    }
    for (const port of service.ports ?? []) {
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        fail(`${where}: invalid port ${port}`);
      if (ports.has(port))
        fail(`${where}: port ${port} is also claimed by ${ports.get(port)}`);
      ports.set(port, service.id);
    }
  }
}

// Vendored artwork from outside the pinned collection, credited by collection.
const COLLECTIONS = {
  "dashboard-icons": {},
  "selfhst-icons": {
    title: "selfh.st Icons by selfh.st and contributors",
    short: "selfh.st Icons, selfh.st and contributors",
    license: "Creative Commons Attribution 4.0 International",
    licenseUrl:
      "https://github.com/selfhst/icons/blob/b2378abb1a0c64149bb7621815b849d89602de23/LICENSE",
    licenseText:
      "Its complete license and warranty disclaimer are included as `frontend/public/service-icons/LICENSE-selfhst.txt`.",
    licenseFile: "LICENSE-selfhst.txt",
  },
  webssh: {
    title: "WebSSH by bifrost0x and contributors",
    short: "WebSSH, bifrost0x and contributors",
    license: "Apache License 2.0",
    licenseUrl:
      "https://github.com/bifrost0x/webssh/blob/26257eba3a7c6691aedb42b7aa9874d2e3753392/LICENSE",
    licenseText:
      "The license text is identical to `frontend/public/service-icons/LICENSE.txt`.",
    licenseFile: "LICENSE.txt",
  },
};

// Brand spellings for words of upstream file names. The long tail is
// title-cased; an upstream alias that spells the whole name with capitals
// (for example "UniFi") takes precedence over both.
const NAME_WORDS = {
  adguard: "AdGuard",
  ai: "AI",
  amd: "AMD",
  api: "API",
  asus: "ASUS",
  aws: "AWS",
  cd: "CD",
  ce: "CE",
  cms: "CMS",
  crm: "CRM",
  css: "CSS",
  db: "DB",
  devops: "DevOps",
  dns: "DNS",
  dvd: "DVD",
  erp: "ERP",
  esphome: "ESPHome",
  freebsd: "FreeBSD",
  ftp: "FTP",
  gcp: "GCP",
  github: "GitHub",
  gitlab: "GitLab",
  gpt: "GPT",
  graphql: "GraphQL",
  hp: "HP",
  hpe: "HPE",
  html: "HTML",
  http: "HTTP",
  https: "HTTPS",
  ibm: "IBM",
  icloud: "iCloud",
  ii: "II",
  iii: "III",
  io: "IO",
  ios: "iOS",
  iot: "IoT",
  ip: "IP",
  ipados: "iPadOS",
  iphone: "iPhone",
  itunes: "iTunes",
  javascript: "JavaScript",
  json: "JSON",
  kvm: "KVM",
  ldap: "LDAP",
  linkedin: "LinkedIn",
  llm: "LLM",
  macos: "macOS",
  mariadb: "MariaDB",
  mongodb: "MongoDB",
  mqtt: "MQTT",
  mysql: "MySQL",
  nas: "NAS",
  nvidia: "NVIDIA",
  nzb: "NZB",
  oauth: "OAuth",
  onedrive: "OneDrive",
  openwrt: "OpenWrt",
  opnsense: "OPNsense",
  os: "OS",
  paypal: "PayPal",
  pdf: "PDF",
  pfsense: "pfSense",
  php: "PHP",
  phpmyadmin: "phpMyAdmin",
  postgresql: "PostgreSQL",
  qbittorrent: "qBittorrent",
  qnap: "QNAP",
  rss: "RSS",
  sdk: "SDK",
  sftp: "SFTP",
  smtp: "SMTP",
  sql: "SQL",
  sqlite: "SQLite",
  ssh: "SSH",
  sso: "SSO",
  tplink: "TP-Link",
  truenas: "TrueNAS",
  tv: "TV",
  typescript: "TypeScript",
  ugreen: "UGREEN",
  ui: "UI",
  unifi: "UniFi",
  url: "URL",
  usb: "USB",
  vm: "VM",
  vpn: "VPN",
  vscode: "VS Code",
  wordpress: "WordPress",
  xml: "XML",
  youtube: "YouTube",
};
const LOWER_WORDS = new Set(["and", "for", "in", "of", "on", "the", "to"]);

export function displayName(id, aliases = []) {
  const key = normalize(id);
  const spelled = aliases.find(
    (alias) =>
      normalize(alias) === key &&
      /[A-Z]/.test(alias) &&
      /^[\p{L}\p{N}][\p{L}\p{N} .!+&'-]*$/u.test(alias),
  );
  if (spelled) return spelled;
  return id
    .split("-")
    .filter(Boolean)
    .map(
      (word, index) =>
        NAME_WORDS[word] ??
        (index > 0 && LOWER_WORDS.has(word)
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1)),
    )
    .join(" ");
}

// Upstream categories, lowercased, mapped onto serviceCategories in
// frontend/src/catalog.ts. The first specific match wins; the generic
// "tools"-like categories and anything unmapped fall back to Tools.
const CATEGORY_MAP = {
  media: "Media",
  "media-servers": "Media",
  entertainment: "Media",
  anime: "Media",
  streaming: "Media",
  "video-streaming": "Media",
  "music-streaming": "Media",
  music: "Media",
  video: "Media",
  storage: "Storage",
  file: "Storage",
  "file-sharing-&-sync": "Storage",
  security: "Security",
  "password-managers": "Security",
  vpn: "Security",
  automation: "Automation",
  "home-automation": "Automation",
  "smart-home": "Automation",
  network: "Network",
  networking: "Network",
  "networking-tools": "Network",
  monitoring: "Monitoring",
  "monitoring-tools": "Monitoring",
  cloud: "Infrastructure",
  "cloud-computing": "Infrastructure",
  "server-panels": "Infrastructure",
  "operating-systems": "Infrastructure",
  "linux-distributions": "Infrastructure",
  "containerization-&-orchestration": "Infrastructure",
  hardware: "Infrastructure",
  infrastructure: "Infrastructure",
  database: "Infrastructure",
  databases: "Infrastructure",
  devops: "Development",
  development: "Development",
  "developer-tools": "Development",
  "version-control-systems": "Development",
  "programming-languages": "Development",
  "download-managers": "Downloads",
  communication: "Communication",
  collaboration: "Communication",
  social: "Communication",
  "social-media": "Communication",
  "email-providers": "Communication",
  "ai-&-llm-platforms": "AI",
  gaming: "Games",
  "gaming-platforms": "Games",
  videogames: "Games",
};

export function serviceCategory(categories = []) {
  for (const category of categories) {
    const mapped = CATEGORY_MAP[category.toLowerCase()];
    if (mapped) return mapped;
  }
  return "Tools";
}

const baseName = (file) => file.replace(/\.svg$/, "");
const variants = (id, meta) =>
  [
    `${id}.svg`,
    meta?.colors?.light && `${meta.colors.light}.svg`,
    meta?.colors?.dark && `${meta.colors.dark}.svg`,
    `${id}-light.svg`,
    `${id}-dark.svg`,
  ].filter((file, index, all) => file && all.indexOf(file) === index);

// Upstream files a curated entry stands for: its own file and fallbacks, and
// for an entry vendored from the same collection, the file it came from.
function curatedFiles(services) {
  const files = new Set();
  for (const service of services) {
    for (const file of [service.upstream, ...(service.fallbacks ?? [])])
      if (file) files.add(file);
    if (service.vendored?.collection === "dashboard-icons")
      files.add(service.vendored.url.split("/").pop());
  }
  return files;
}

async function fetchTree({ repository }, sha) {
  const url = `https://api.github.com/repos/${repository}/git/trees/${sha}`;
  const tree = JSON.parse(
    (await request(url, "application/vnd.github+json")).toString("utf8"),
  );
  if (tree.truncated) fail(`upstream tree ${sha} listing is truncated`);
  return new Map(tree.tree.map((entry) => [entry.path, entry]));
}

async function downloadBlob(upstream, path, entry) {
  const url = `https://raw.githubusercontent.com/${upstream.repository}/${upstream.commit}/${path}`;
  const buffer = await request(url, "*/*");
  if (gitBlobSha(buffer) !== entry.sha)
    fail(`${path} does not match upstream blob ${entry.sha}`);
  return buffer;
}

// Tries each candidate file in order and returns the first acceptable one.
// Variants that do not exist upstream are passed over silently unless none do.
async function downloadIcon(files, upstream, tree, reasons) {
  const present = files.filter((file) => tree.get(file)?.type === "blob");
  if (!present.length) reasons.push(`${files.join(", ")} not found upstream`);
  for (const file of present) {
    const entry = tree.get(file);
    if (entry.size > MAX_DOWNLOAD_BYTES) {
      reasons.push(`${file} is ${Math.round(entry.size / 1024)} KB`);
      continue;
    }
    const raw = await downloadBlob(upstream, `svg/${file}`, entry);
    const { buffer, problems } = prepareSvg(raw);
    if (problems) {
      reasons.push(`${file} ${problems.join("; ")}`);
      continue;
    }
    return { file, blob: entry.sha, raw: raw.length, buffer };
  }
  return undefined;
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    }),
  );
  return results;
}

async function syncUpstream(manifest, outputs, sizes) {
  const { upstream, services } = manifest;
  const rootTree = await fetchTree(upstream, upstream.commit);
  const svgDir = rootTree.get("svg"),
    metadataEntry = rootTree.get("metadata.json");
  if (svgDir?.type !== "tree" || metadataEntry?.type !== "blob")
    fail("upstream commit has no svg/ directory or metadata.json");
  const tree = await fetchTree(upstream, svgDir.sha);
  const metadata = JSON.parse(
    (await downloadBlob(upstream, "metadata.json", metadataEntry)).toString(
      "utf8",
    ),
  );

  const curatedIds = new Set(services.map((service) => service.id));
  const used = curatedFiles(services);
  const skipped = [];
  const jobs = services
    .filter((service) => service.upstream)
    .map((service) => ({
      id: service.id,
      files: [service.upstream, ...(service.fallbacks ?? [])],
      curated: true,
    }));
  for (const id of Object.keys(metadata).sort()) {
    const meta = metadata[id];
    if (meta?.base !== "svg") continue;
    const files = variants(id, meta);
    if (files.some((file) => used.has(file))) continue;
    if (!EXTENDED_ID.test(id)) {
      skipped.push({ id, reason: "name is not a valid icon id" });
      continue;
    }
    if (curatedIds.has(id)) {
      skipped.push({ id, reason: `id is taken by a different curated logo` });
      continue;
    }
    const strings = (value) =>
      Array.isArray(value)
        ? value.filter((item) => typeof item === "string")
        : [];
    jobs.push({
      id,
      files,
      aliases: strings(meta.aliases),
      categories: strings(meta.categories),
    });
  }

  const results = await mapLimit(jobs, DOWNLOAD_CONCURRENCY, async (job) => {
    const reasons = [];
    const download = await downloadIcon(job.files, upstream, tree, reasons);
    return { job, download, reasons };
  });
  const icons = [];
  const missing = [];
  for (const { job, download, reasons } of results) {
    if (!download) {
      if (job.curated) missing.push(`${job.id} (${reasons.join("; ")})`);
      else skipped.push({ id: job.id, reason: reasons.join("; ") });
      continue;
    }
    sizes.upstream += download.raw;
    sizes.minified += download.buffer.length;
    outputs.set(join(paths.icons, `${job.id}.svg`), download.buffer);
    icons.push({
      id: job.id,
      source: download.file,
      blob: download.blob,
      sha256: sha256(download.buffer),
      ...(job.curated
        ? {}
        : { aliases: job.aliases, categories: job.categories }),
    });
  }
  if (missing.length)
    fail(
      `no acceptable SVG for ${missing.join(", ")}; remove these entries or add fallbacks`,
    );
  skipped.sort((a, b) => a.id.localeCompare(b.id));
  return {
    repository: upstream.repository,
    commit: upstream.commit,
    metadata: metadataEntry.sha,
    icons,
    skipped,
  };
}

function readLock(manifest) {
  if (!existsSync(paths.lock))
    fail(`${paths.lock} is missing; run the sync without --offline`);
  const lock = JSON.parse(readFileSync(paths.lock, "utf8"));
  if (
    lock.repository !== manifest.upstream.repository ||
    lock.commit !== manifest.upstream.commit
  )
    fail("the lock is for a different upstream commit; run the sync online");
  if (!SHA1.test(lock.metadata ?? "") || !Array.isArray(lock.icons))
    fail("the lock is malformed");
  const ids = new Set();
  for (const icon of lock.icons) {
    const where = `lock entry ${JSON.stringify(icon?.id)}`;
    if (!EXTENDED_ID.test(icon?.id ?? "") || ids.has(icon.id))
      fail(`${where}: invalid or duplicate id`);
    ids.add(icon.id);
    if (!/^[a-z0-9][a-z0-9.-]*\.svg$/.test(icon.source ?? ""))
      fail(`${where}: invalid source`);
    if (!SHA1.test(icon.blob ?? "") || !SHA256.test(icon.sha256 ?? ""))
      fail(`${where}: invalid hashes`);
    for (const field of ["aliases", "categories"])
      if (
        icon[field] !== undefined &&
        !(
          Array.isArray(icon[field]) &&
          icon[field].every((item) => typeof item === "string")
        )
      )
        fail(`${where}: invalid ${field}`);
  }
  if (!Array.isArray(lock.skipped)) fail("the lock is malformed");
  return lock;
}

// Reconciles the lock with the manifest: curated entries must have a verified
// download recorded; extended entries that a curated entry now covers drop
// out. The result is written back, so --check notices an outdated lock.
function reconcile(manifest, lock) {
  const { services } = manifest;
  const byId = new Map(lock.icons.map((icon) => [icon.id, icon]));
  const curatedIds = new Set(services.map((service) => service.id));
  const used = curatedFiles(services);
  const icons = [];
  for (const service of services.filter((service) => service.upstream)) {
    const icon = byId.get(service.id);
    const files = [service.upstream, ...(service.fallbacks ?? [])];
    if (!icon || !files.includes(icon.source))
      fail(
        `${service.id}: no verified download of ${files.join(" or ")} is recorded; run the sync without --offline`,
      );
    const { id, source, blob, sha256: hash } = icon;
    icons.push({ id, source, blob, sha256: hash });
  }
  const extended = lock.icons
    .filter(
      (icon) =>
        !curatedIds.has(icon.id) &&
        !used.has(icon.source) &&
        !used.has(`${icon.id}.svg`),
    )
    .map(({ id, source, blob, sha256: hash, aliases, categories }) => ({
      id,
      source,
      blob,
      sha256: hash,
      aliases: aliases ?? [],
      categories: categories ?? [],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    repository: lock.repository,
    commit: lock.commit,
    metadata: lock.metadata,
    icons: [...icons, ...extended],
    skipped: lock.skipped
      .filter((entry) => !curatedIds.has(entry.id))
      .map(({ id, reason }) => ({ id, reason })),
    extendedCount: extended.length,
  };
}

// Names, categories and detection aliases of the extended tier. An alias is
// kept only when it identifies exactly one logo: it must not be claimed by a
// curated entry or by any other extended entry.
export function deriveExtended(icons, services) {
  const curatedKeys = new Set();
  for (const service of services)
    for (const key of [
      service.id,
      normalize(service.name),
      ...(service.aliases ?? []),
    ])
      curatedKeys.add(key);
  const counts = new Map();
  const count = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const entries = icons.map((icon) => {
    const name = displayName(icon.id, icon.aliases);
    const own = new Set([normalize(icon.id), normalize(name)]);
    const candidates = [...new Set(icon.aliases.map(normalize))].filter(
      (key) => key.length >= 3 && !own.has(key),
    );
    for (const key of [...own, ...candidates]) count(key);
    return {
      id: icon.id,
      name,
      category: serviceCategory(icon.categories),
      candidates,
    };
  });
  return entries.map(({ candidates, ...entry }) => ({
    ...entry,
    aliases: candidates
      .filter((key) => counts.get(key) === 1 && !curatedKeys.has(key))
      .sort(),
  }));
}

const quote = (value) => JSON.stringify(value);
const sourceFile = (service) => service.vendored.url.split("/").pop();

function renderLock(lock) {
  const line = (value) => `    ${JSON.stringify(value)}`;
  return `{
  "$comment": "Generated by scripts/sync-service-icons.mjs: the verified upstream files behind every bundled logo. Do not edit.",
  "repository": ${quote(lock.repository)},
  "commit": ${quote(lock.commit)},
  "metadata": ${quote(lock.metadata)},
  "icons": [
${lock.icons.map(line).join(",\n")}
  ],
  "skipped": [
${lock.skipped.map(line).join(",\n")}
  ]
}
`;
}

function renderTypeScript(extended) {
  const rows = extended.map(
    (entry) =>
      `  ${quote([entry.id, entry.name, entry.category, ...entry.aliases])},`,
  );
  return `// Generated by scripts/sync-service-icons.mjs from service-catalog.lock.json. Do not edit.
// Logos beyond the curated catalog, as [id, name, category, ...aliases].
// Aliases are normalized to [a-z0-9] and claimed by no other logo.
export type ExtendedServiceIcon = readonly [
  id: string,
  name: string,
  category: string,
  ...aliases: string[],
];

// prettier-ignore
export const extendedServiceIcons: readonly ExtendedServiceIcon[] = [
${rows.join("\n")}
];
`;
}

function renderGo(ids) {
  return `// Code generated by scripts/sync-service-icons.mjs from frontend/src/service-catalog.json; DO NOT EDIT.

package store

// serviceIconIDs lists the bundled service logos accepted as "service:<id>":
// the curated catalog first, then the extended Dashboard Icons tier.
var serviceIconIDs = []string{
${ids.map((id) => `\t${quote(id)},`).join("\n")}
}
`;
}

function summary(manifest, lock) {
  const { services } = manifest;
  const vendored = services.filter((service) => service.vendored);
  const modified = vendored.filter((service) => service.vendored.modified);
  const foreign = vendored.filter(
    (service) => service.vendored.collection !== "dashboard-icons",
  );
  const total = services.length + lock.extendedCount;
  return {
    total,
    curated: services.length,
    extended: lock.extendedCount,
    dashboardIcons: total - foreign.length,
    minified: lock.icons.length,
    vendored,
    modified,
    foreign,
  };
}

const MINIFIED_TEXT =
  "comments, metadata, editor-specific markup and insignificant whitespace were removed; shapes, path data, colors and text are unchanged";

function renderInventory(manifest, lock) {
  const { upstream, services } = manifest;
  const s = summary(manifest, lock);
  const base = `https://github.com/${upstream.repository}/blob/${upstream.commit}`;
  const curatedIds = new Set(services.map((service) => service.id));
  const vendoredRows = s.vendored.map((service) => {
    const notes = service.vendored.modified ?? "Unchanged.";
    return `| \`${service.id}.svg\` | [${sourceFile(service)}](${service.vendored.url}) | ${service.vendored.license} | ${notes} |`;
  });
  const rows = lock.icons.map((icon) => {
    const tier = curatedIds.has(icon.id) ? "curated" : "extended";
    return `| \`${icon.id}.svg\` | ${icon.source} | ${tier} | \`${icon.blob}\` |`;
  });
  const skippedRows = lock.skipped.map(
    (entry) => `| ${entry.id} | ${entry.reason.replace(/\|/g, "\\|")} |`,
  );
  const foreignText = s.foreign
    .map((service) => {
      const collection = COLLECTIONS[service.vendored.collection];
      const change = service.vendored.modified
        ? `Modified for HomeGrid: ${service.vendored.modified}`
        : "No changes were made to this artwork.";
      return `The ${service.name} SVG is from [${collection.title}](${service.vendored.url}), distributed under [${collection.license}](${collection.licenseUrl}). ${collection.licenseText} ${change}`;
    })
    .join("\n\n");
  const modifiedText = s.modified
    .filter((service) => service.vendored.collection === "dashboard-icons")
    .map(
      (service) =>
        `The ${service.name} SVG was vendored from an earlier commit and modified: ${service.vendored.modified}`,
    )
    .join(" ");
  return `# Bundled service icons

<!-- Generated by scripts/sync-service-icons.mjs from frontend/src/service-catalog.json and service-catalog.lock.json. Do not edit. -->

The ${s.total} SVGs in \`frontend/public/service-icons/\` identify services. ${s.curated} belong to the curated catalog in \`frontend/src/service-catalog.json\`, which also provides the service templates. The other ${s.extended} form the extended tier: every remaining SVG icon of the pinned Dashboard Icons commit, named and categorized from its upstream \`metadata.json\` (blob \`${lock.metadata}\`). Extended logos are found through service recognition and the icon picker.

All files are checked by \`scripts/sync-service-icons.mjs\` and the frontend test suite: no scripts, event handlers, external references, embedded documents, animation or DTDs (embedded content is limited to base64 raster images), and at most ${MAX_SVG_BYTES / 1024} KB each. Downloaded files must match the git blob hash listed below. They are loaded as independent image documents; SVG IDs and styles therefore remain isolated. No icon CDN, external font, script, tracking asset or runtime download is used.

${s.dashboardIcons} icons are from [Dashboard Icons by Homarr Labs and contributors](${base}), distributed under [Apache License 2.0](${base}/LICENSE). The complete license is included as \`frontend/public/service-icons/LICENSE.txt\`. The upstream distribution has no root NOTICE file. The ${s.minified} files downloaded from the pinned commit were minified for distribution: ${MINIFIED_TEXT}. ${modifiedText}

${foreignText}

Product names, logos and trademarks belong to their respective owners. These icons identify the corresponding services and do not imply endorsement. Collection licenses do not grant trademark rights.

The runtime distribution includes a copy of these credits in \`/service-icons/NOTICE.txt\`, alongside the licenses.

To add a curated service, edit \`frontend/src/service-catalog.json\` and run \`node scripts/sync-service-icons.mjs\` from the repository root. The same command refreshes the extended tier.

## Vendored files

| Local file | Source SVG | License | Changes |
| --- | --- | --- | --- |
${vendoredRows.join("\n")}

## Files from Dashboard Icons

Upstream files are in \`svg/\` at [${upstream.repository}@${upstream.commit.slice(0, 12)}](${base}/svg), licensed Apache-2.0.

| Local file | Upstream file | Tier | Upstream blob |
| --- | --- | --- | --- |
${rows.join("\n")}

## Upstream icons not bundled

| Upstream icon | Reason |
| --- | --- |
${skippedRows.join("\n")}
`;
}

function renderNotice(manifest, lock) {
  const { upstream } = manifest;
  const s = summary(manifest, lock);
  const modified = s.modified.filter(
    (service) => service.vendored.collection === "dashboard-icons",
  );
  const foreign = s.foreign
    .map((service) => {
      const collection = COLLECTIONS[service.vendored.collection];
      return `${service.name} SVG: ${collection.short}.
Source: ${service.vendored.url}
License: ${collection.license}; see ${collection.licenseFile}.
The ${service.name} artwork is ${service.vendored.modified ? "modified" : "unchanged"}.`;
    })
    .join("\n\n");
  return `Service icons

${s.dashboardIcons} SVGs: Dashboard Icons, Homarr Labs and contributors.
Source: https://github.com/${upstream.repository}/blob/${upstream.commit}
${modified.map((service) => `${service.name} source: ${service.vendored.url}`).join("\n")}
License: Apache-2.0; see LICENSE.txt.
${modified
  .map(
    (service) =>
      `${service.name} artwork modified for HomeGrid: ${service.vendored.modified.charAt(0).toLowerCase()}${service.vendored.modified.slice(1)}`,
  )
  .join("\n")}
The other ${s.minified} SVGs from this collection were minified for HomeGrid:
${MINIFIED_TEXT}.

${foreign}

Product names, logos and trademarks belong to their respective owners. Used for
service identification only; no endorsement is implied. Collection licenses
do not grant trademark rights.

Full per-file source inventory: docs/third-party-icons.md in the source distribution.
`;
}

async function main(argv) {
  const args = new Set(argv);
  const check = args.has("--check");
  const offline = check || args.has("--offline");
  for (const arg of args)
    if (!["--check", "--offline"].includes(arg)) fail(`Unknown option ${arg}`);

  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  validateManifest(manifest);
  const { services } = manifest;
  const outputs = new Map();
  const sizes = { upstream: 0, minified: 0 };
  const lock = reconcile(
    manifest,
    offline ? readLock(manifest) : await syncUpstream(manifest, outputs, sizes),
  );
  const curatedIds = new Set(services.map((service) => service.id));
  const extendedIcons = lock.icons.filter((icon) => !curatedIds.has(icon.id));
  const extended = deriveExtended(extendedIcons, services);

  let total = 0;
  const hashes = new Map(lock.icons.map((icon) => [icon.id, icon.sha256]));
  const ids = [
    ...services.map((service) => service.id),
    ...extended.map((entry) => entry.id),
  ];
  for (const id of ids) {
    const file = join(paths.icons, `${id}.svg`);
    if (!outputs.has(file) && !existsSync(file))
      fail(`${id}: ${file} is missing; run the sync without --offline`);
    const buffer = outputs.get(file) ?? readFileSync(file);
    const problems = svgProblems(buffer.toString("utf8"), buffer.length);
    if (problems.length)
      fail(`${id}.svg fails the artwork gate: ${problems.join("; ")}`);
    if (hashes.has(id) && sha256(buffer) !== hashes.get(id))
      fail(`${id}.svg differs from the verified download; run the sync`);
    total += buffer.length;
  }
  const expected = new Set(ids.map((id) => `${id}.svg`));
  const stray = readdirSync(paths.icons).filter(
    (name) => name.endsWith(".svg") && !expected.has(name),
  );
  if (stray.length)
    console.warn(
      `not in the catalog (left untouched): ${stray.length > 20 ? `${stray.length} files` : stray.join(", ")}`,
    );

  outputs.set(paths.lock, renderLock(lock));
  outputs.set(paths.typescript, renderTypeScript(extended));
  outputs.set(paths.go, renderGo(ids));
  outputs.set(paths.inventory, renderInventory(manifest, lock));
  outputs.set(paths.notice, renderNotice(manifest, lock));

  const stale = [];
  for (const [file, content] of outputs) {
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (existsSync(file) && readFileSync(file).equals(next)) continue;
    stale.push(file);
    if (!check) writeFileSync(file, next);
  }
  if (!offline) {
    for (const entry of lock.skipped)
      console.warn(`skipped ${entry.id}: ${entry.reason}`);
    console.log(
      `downloaded ${(sizes.upstream / 1024).toFixed(1)} KB, ${(sizes.minified / 1024).toFixed(1)} KB after minification`,
    );
  }
  if (check && stale.length)
    fail(
      `out of date, run the sync: ${stale.length > 10 ? `${stale.length} files` : stale.join(", ")}`,
    );
  console.log(
    `${ids.length} service icons (${services.length} curated, ${extended.length} extended, ${lock.skipped.length} upstream icons skipped), ${(total / 1024).toFixed(1)} KB total; ${
      check ? "up to date" : `${stale.length} file(s) written`
    }`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => fail(error.message));
