#!/usr/bin/env node
// Synchronizes the bundled service logos with frontend/src/service-catalog.json.
//
// Usage (from the repository root):
//   node scripts/sync-service-icons.mjs            download, verify and regenerate
//   node scripts/sync-service-icons.mjs --offline  regenerate from the local SVGs
//   node scripts/sync-service-icons.mjs --check    fail if any generated file is stale
//
// Downloads come from a single pinned upstream commit. Every file is checked
// against the git blob hash published in the upstream tree, then passes the
// same static-artwork gate the frontend tests enforce. Nothing is fetched at
// runtime by HomeGrid itself. Set GITHUB_TOKEN to raise the API rate limit.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  manifest: join(root, "frontend/src/service-catalog.json"),
  icons: join(root, "frontend/public/service-icons"),
  typescript: join(root, "frontend/src/serviceIcons.ts"),
  go: join(root, "internal/store/service_icons_gen.go"),
  inventory: join(root, "docs/third-party-icons.md"),
  notice: join(root, "frontend/public/service-icons/NOTICE.txt"),
};
export const MAX_SVG_BYTES = 60 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_CONCURRENCY = 8;
const COLORS = new Set(["sage", "blue", "amber", "rose", "violet", "cyan"]);

const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const offline = check || args.has("--offline");
for (const arg of args)
  if (!["--check", "--offline"].includes(arg)) fail(`Unknown option ${arg}`);

function fail(message) {
  console.error(`sync-service-icons: ${message}`);
  process.exit(1);
}

// Returns the reasons an SVG must not be bundled; an empty list means it may
// ship. The rules mirror frontend/src/service-icons.test.ts: no scripting, no
// event handlers, no external references, no DTD tricks, no animation and
// nothing that could trigger a network request. The only embedded content
// allowed is a base64 raster bitmap inside <image>, which an <img>-loaded SVG
// renders without any further loading.
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
  ];
  for (const [pattern, reason] of rules)
    if (pattern.test(svg)) problems.push(reason);
  for (const tag of svg.matchAll(/<([a-zA-Z][\w:.-]*)\b([^>]*)>/g)) {
    const element = tag[1].toLowerCase();
    for (const match of tag[2].matchAll(
      /\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
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
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) problems.push("has no <svg> root");
  else if (!/\s(viewBox|width)\s*=/i.test(open[0]))
    problems.push("has neither viewBox nor width");
  return [...new Set(problems)];
}

function gitBlobSha(buffer) {
  return createHash("sha1")
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest("hex");
}

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
  if (!/^[0-9a-f]{40}$/.test(upstream?.commit ?? ""))
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

async function fetchUpstreamTree({ repository, commit }) {
  const url = `https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`;
  const tree = JSON.parse(
    (await request(url, "application/vnd.github+json")).toString("utf8"),
  );
  if (tree.truncated) fail("upstream tree listing is truncated");
  return new Map(
    tree.tree
      .filter((entry) => entry.type === "blob" && entry.path.startsWith("svg/"))
      .map((entry) => [entry.path.slice(4), entry]),
  );
}

async function downloadService(service, upstream, tree, report) {
  for (const file of [service.upstream, ...(service.fallbacks ?? [])]) {
    const entry = tree.get(file);
    if (!entry) {
      report.push(`${service.id}: ${file} does not exist upstream`);
      continue;
    }
    if (entry.size > MAX_SVG_BYTES) {
      report.push(`${service.id}: ${file} skipped (${entry.size} bytes)`);
      continue;
    }
    const url = `https://raw.githubusercontent.com/${upstream.repository}/${upstream.commit}/svg/${file}`;
    const buffer = await request(url, "image/svg+xml");
    if (gitBlobSha(buffer) !== entry.sha)
      fail(`${service.id}: ${file} does not match upstream blob ${entry.sha}`);
    const problems = svgProblems(buffer.toString("utf8"), buffer.length);
    if (problems.length) {
      report.push(`${service.id}: ${file} rejected (${problems.join("; ")})`);
      continue;
    }
    return { file, buffer };
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

const quote = (value) => JSON.stringify(value);
const sourceUrl = (upstream, file) =>
  `https://github.com/${upstream.repository}/blob/${upstream.commit}/svg/${file}`;
const sourceFile = (service) =>
  service.vendored ? service.vendored.url.split("/").pop() : service.source;

function renderTypeScript(services) {
  const entries = services.map((service) => {
    const fields = [
      `src: ${quote(`/service-icons/${service.id}.svg`)}`,
      `name: ${quote(service.name)}`,
    ];
    if (service.aliases?.length)
      fields.push(`aliases: [${service.aliases.map(quote).join(", ")}]`);
    return `    ${service.id}: { ${fields.join(", ")} },`;
  });
  return `// Generated by scripts/sync-service-icons.mjs from service-catalog.json. Do not edit.
export interface ServiceIcon {
  src: string;
  name: string;
  aliases?: readonly string[];
}

// prettier-ignore
export const serviceIcons: Readonly<Record<string, ServiceIcon>> =
  Object.freeze({
${entries.join("\n")}
  });

export function serviceIconUrl(icon: string): string {
  if (!icon.startsWith("service:")) return "";
  const id = icon.slice("service:".length);
  return Object.hasOwn(serviceIcons, id) ? serviceIcons[id].src : "";
}
`;
}

function renderGo(services) {
  return `// Code generated by scripts/sync-service-icons.mjs from frontend/src/service-catalog.json; DO NOT EDIT.

package store

// serviceIconIDs lists the bundled service logos accepted as "service:<id>".
var serviceIconIDs = []string{
${services.map((service) => `\t${quote(service.id)},`).join("\n")}
}
`;
}

function counts(services) {
  const upstream = services.filter((service) => service.upstream);
  const modified = services.filter((service) => service.vendored?.modified);
  const otherCollections = services.filter(
    (service) =>
      service.vendored && service.vendored.collection !== "dashboard-icons",
  );
  return { upstream, modified, otherCollections };
}

function renderInventory(manifest) {
  const { upstream, services } = manifest;
  const { modified, otherCollections } = counts(services);
  const dashboardIcons = services.length - otherCollections.length;
  const rows = services.map((service) => {
    const license = service.vendored?.license ?? upstream.license;
    const url = service.vendored?.url ?? sourceUrl(upstream, service.source);
    return `| \`${service.id}.svg\` | [${sourceFile(service)}](${url}) | ${license} |`;
  });
  const modifiedText = modified
    .map((service) => `${service.name}: ${service.vendored.modified}`)
    .join(" ");
  return `# Bundled service icons

<!-- Generated by scripts/sync-service-icons.mjs from frontend/src/service-catalog.json. Do not edit. -->

The ${services.length} SVGs in \`frontend/public/service-icons/\` identify services in the local catalog. They are vendored from the pinned sources below and checked by \`scripts/sync-service-icons.mjs\` and the frontend test suite: no scripts, event handlers, external references, embedded documents, animation or DTDs (embedded content is limited to base64 raster images), and at most ${MAX_SVG_BYTES / 1024} KB each. ${modifiedText} All other SVGs are unchanged. They are loaded as independent image documents; SVG IDs and styles therefore remain isolated. No icon CDN, external font, script, tracking asset or runtime download is used.

${dashboardIcons} icons are from [Dashboard Icons by Homarr Labs and contributors](https://github.com/${upstream.repository}/blob/${upstream.commit}), distributed under [Apache License 2.0](https://github.com/${upstream.repository}/blob/${upstream.commit}/LICENSE). The complete license is included as \`frontend/public/service-icons/LICENSE.txt\`. The upstream distribution has no root NOTICE file. Icons listed with an older commit were vendored earlier and are kept as they were.

The Linkwarden SVG is from [selfh.st Icons by selfh.st and contributors](https://github.com/selfhst/icons/blob/b2378abb1a0c64149bb7621815b849d89602de23/svg/linkwarden.svg), distributed under [Creative Commons Attribution 4.0 International](https://github.com/selfhst/icons/blob/b2378abb1a0c64149bb7621815b849d89602de23/LICENSE). Its complete license and warranty disclaimer are included as \`frontend/public/service-icons/LICENSE-selfhst.txt\`. No changes were made to this artwork.

Product names, logos and trademarks belong to their respective owners. These icons identify the corresponding services and do not imply endorsement. Collection licenses do not grant trademark rights.

The runtime distribution includes a copy of these credits in \`/service-icons/NOTICE.txt\`, alongside both licenses.

To add a service, edit \`frontend/src/service-catalog.json\` and run \`node scripts/sync-service-icons.mjs\` from the repository root.

| Local file | Source SVG | License |
| --- | --- | --- |
${rows.join("\n")}
`;
}

function renderNotice(manifest) {
  const { upstream, services } = manifest;
  const { modified, otherCollections } = counts(services);
  const dashboardIcons = services.length - otherCollections.length;
  const unchanged = dashboardIcons - modified.length;
  const modifiedText = modified
    .map(
      (service) =>
        `${service.name} artwork modified for HomeGrid: ${service.vendored.modified.charAt(0).toLowerCase()}${service.vendored.modified.slice(1)}`,
    )
    .join("\n");
  return `Service icons

${dashboardIcons} SVGs: Dashboard Icons, Homarr Labs and contributors.
Source: https://github.com/${upstream.repository}/blob/${upstream.commit}
${modified.map((service) => `${service.name} source: ${service.vendored.url}`).join("\n")}
License: Apache-2.0; see LICENSE.txt.
${modifiedText}
The other ${unchanged} SVGs from this collection are unchanged.

Linkwarden SVG: selfh.st Icons, selfh.st and contributors.
Source: https://github.com/selfhst/icons/blob/b2378abb1a0c64149bb7621815b849d89602de23/svg/linkwarden.svg
License: Creative Commons Attribution 4.0 International; see LICENSE-selfhst.txt.
The Linkwarden artwork is unchanged.

Product names, logos and trademarks belong to their respective owners. Used for
service identification only; no endorsement is implied. Collection licenses
do not grant trademark rights.

Full per-file source inventory: docs/third-party-icons.md in the source distribution.
`;
}

async function main() {
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  validateManifest(manifest);
  const { upstream, services } = manifest;
  const report = [];
  const outputs = new Map();

  if (offline) {
    for (const service of services) {
      const file = join(paths.icons, `${service.id}.svg`);
      if (!existsSync(file)) fail(`${service.id}: ${file} is missing`);
      // The chosen upstream file is recorded in the inventory, which is the
      // only place a fallback variant would be visible offline.
      service.source = service.upstream;
    }
    const inventory = existsSync(paths.inventory)
      ? readFileSync(paths.inventory, "utf8")
      : "";
    for (const service of services) {
      const match = inventory.match(
        new RegExp(`\\| \`${service.id}\\.svg\` \\| \\[([^\\]]+)\\]`),
      );
      if (match && service.upstream) service.source = match[1];
    }
  } else {
    const tree = await fetchUpstreamTree(upstream);
    const downloads = await mapLimit(
      services.filter((service) => service.upstream),
      DOWNLOAD_CONCURRENCY,
      async (service) => [
        service,
        await downloadService(service, upstream, tree, report),
      ],
    );
    const missing = [];
    for (const [service, download] of downloads) {
      if (!download) {
        missing.push(service.id);
        continue;
      }
      service.source = download.file;
      outputs.set(join(paths.icons, `${service.id}.svg`), download.buffer);
    }
    for (const line of report) console.warn(`skipped ${line}`);
    if (missing.length)
      fail(
        `no acceptable SVG for ${missing.join(", ")}; remove these entries or add fallbacks`,
      );
  }

  let total = 0;
  for (const service of services) {
    const file = join(paths.icons, `${service.id}.svg`);
    const buffer = outputs.get(file) ?? readFileSync(file);
    const problems = svgProblems(buffer.toString("utf8"), buffer.length);
    if (problems.length)
      fail(`${service.id}.svg fails the artwork gate: ${problems.join("; ")}`);
    total += buffer.length;
  }
  const expected = new Set(services.map((service) => `${service.id}.svg`));
  const stray = readdirSync(paths.icons).filter(
    (name) => name.endsWith(".svg") && !expected.has(name),
  );
  if (stray.length)
    console.warn(`not in the manifest (left untouched): ${stray.join(", ")}`);

  outputs.set(paths.typescript, renderTypeScript(services));
  outputs.set(paths.go, renderGo(services));
  outputs.set(paths.inventory, renderInventory(manifest));
  outputs.set(paths.notice, renderNotice(manifest));

  const stale = [];
  for (const [file, content] of outputs) {
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (existsSync(file) && readFileSync(file).equals(next)) continue;
    stale.push(file);
    if (!check) writeFileSync(file, next);
  }
  if (check && stale.length)
    fail(`out of date, run the sync: ${stale.join(", ")}`);
  console.log(
    `${services.length} service icons, ${(total / 1024).toFixed(1)} KB total; ${
      check ? "up to date" : `${stale.length} file(s) written`
    }`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => fail(error.message));
