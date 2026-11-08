#!/usr/bin/env node
// Keeps every place that carries the HomeGrid version in step and verifies a
// release before it is published. Node built-ins only.
//
//   node scripts/release.mjs consistency      all version sources agree
//   node scripts/release.mjs set 0.2.0        update every version source
//   node scripts/release.mjs check v0.2.0     a tag is ready to be released
//   node scripts/release.mjs notes v0.2.0     print the release notes body
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const write = (path, text) => writeFileSync(join(root, path), text);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.error("release: " + message);
  process.exit(1);
}

/** Every file that states the version, with a reader and a writer. */
const sources = [
  {
    file: "frontend/package.json",
    get: (text) => [JSON.parse(text).version],
    set: (text, v) => text.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`),
  },
  {
    file: "frontend/package-lock.json",
    get: (text) => {
      const lock = JSON.parse(text);
      return [lock.version, lock.packages?.[""]?.version];
    },
    set: (text, v) => {
      const lock = JSON.parse(text);
      lock.version = v;
      lock.packages[""].version = v;
      return JSON.stringify(lock, null, 2) + "\n";
    },
  },
  {
    file: "cmd/homegrid/main.go",
    get: (text) => [text.match(/^var version = "([^"]+)"$/m)?.[1]],
    set: (text, v) => text.replace(/^(var version = ")[^"]+(")$/m, `$1${v}$2`),
  },
  {
    file: "Dockerfile",
    get: (text) => [...text.matchAll(/^ARG VERSION=(\S+)$/gm)].map((m) => m[1]),
    set: (text, v) => text.replace(/^(ARG VERSION=)\S+$/gm, `$1${v}`),
  },
];

function versions() {
  const found = [];
  for (const source of sources) {
    const values = source.get(read(source.file));
    if (!values.length || values.some((v) => !v))
      fail(`${source.file}: version not found`);
    for (const value of values) found.push({ file: source.file, value });
  }
  return found;
}

function consistent() {
  const found = versions();
  const distinct = [...new Set(found.map((f) => f.value))];
  if (distinct.length !== 1)
    fail(
      "version sources disagree: " +
        found.map((f) => `${f.file}=${f.value}`).join(", "),
    );
  if (!SEMVER.test(distinct[0])) fail(`"${distinct[0]}" is not semver`);
  return distinct[0];
}

function versionFromTag(tag) {
  const match = /^v(.+)$/.exec(tag ?? "");
  if (!match || !SEMVER.test(match[1]))
    fail(`expected a tag like v1.2.3, got "${tag ?? ""}"`);
  return match[1];
}

function changelogSection(version) {
  const lines = read("CHANGELOG.md").split("\n");
  const start = lines.findIndex((line) => line.startsWith("## " + version));
  if (start < 0) fail(`CHANGELOG.md has no "## ${version}" section`);
  const heading = lines[start].slice(3 + version.length).trim();
  if (heading && !/^- \d{4}-\d{2}-\d{2}$/.test(heading))
    fail(
      `CHANGELOG.md heading for ${version} must be "## ${version} - YYYY-MM-DD", found "${lines[start]}"`,
    );
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

function notesFile(version) {
  const path = `docs/release-notes-${version}.md`;
  if (!existsSync(join(root, path))) fail(`${path} is missing`);
  const text = read(path);
  if (/prepared release notes|has not been published/i.test(text))
    fail(`${path} still describes an unpublished release`);
  return text.replace(/^# .*\n+/, "").trim();
}

const [command, argument] = process.argv.slice(2);
switch (command) {
  case "consistency":
    console.log(consistent());
    break;
  case "set": {
    if (!SEMVER.test(argument ?? "")) fail("usage: set <semver>");
    for (const source of sources)
      write(source.file, source.set(read(source.file), argument));
    console.log(`version set to ${consistent()}`);
    break;
  }
  case "check": {
    const version = versionFromTag(argument);
    const current = consistent();
    if (current !== version)
      fail(`tag ${argument} does not match source version ${current}`);
    changelogSection(version);
    notesFile(version);
    console.log(`${argument} is ready`);
    break;
  }
  case "notes": {
    const version = versionFromTag(argument);
    changelogSection(version);
    process.stdout.write(notesFile(version) + "\n");
    break;
  }
  default:
    fail("usage: consistency | set <semver> | check <tag> | notes <tag>");
}
