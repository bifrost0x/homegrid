// Renders the installable web app icons in frontend/public/icons/ and the
// favicon fallback frontend/public/favicon.ico from the HomeGrid
// logo. The files are committed; rerun after changing the logo:
//
//   node scripts/app-icons.mjs
//
// Uses the Playwright Chromium installed for the frontend tests.
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");

const logo = await readFile(
  new URL("../frontend/public/favicon.svg", import.meta.url),
  "utf8",
);
const output = new URL("../frontend/public/icons/", import.meta.url);
// Matches the light page color in frontend/src/styles.css.
const background = "#f5f4ef";

// scale is the logo's share of the icon edge. Maskable icons keep the logo
// inside the 80% safe zone that launchers may crop to a circle.
// Favicon sizes keep the SVG favicon's transparent background and full size;
// they are only embedded in favicon.ico.
const icons = [
  { name: "icon-192.png", size: 192, scale: 0.78 },
  { name: "icon-512.png", size: 512, scale: 0.78 },
  { name: "maskable-512.png", size: 512, scale: 0.56 },
  { name: "apple-touch-icon.png", size: 180, scale: 0.7 },
  { name: "favicon-16.png", size: 16, scale: 1, transparent: true },
  { name: "favicon-32.png", size: 32, scale: 1, transparent: true },
  { name: "favicon-48.png", size: 48, scale: 1, transparent: true },
];

// An ICO file whose entries are PNG images, supported by every current browser
// and by clients that only request /favicon.ico.
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const favicons = [];
  for (const { name, size, scale, transparent = false } of icons) {
    const edge = Math.round(size * scale);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${transparent ? "transparent" : background};display:grid;place-items:center}svg{width:${edge}px;height:${edge}px;display:block}</style>${logo}`,
    );
    const png = await page.screenshot({
      type: "png",
      omitBackground: transparent,
    });
    if (transparent) {
      favicons.push({ size, png });
      continue;
    }
    await writeFile(new URL(name, output), png);
    console.log(`wrote ${fileURLToPath(new URL(name, output))}`);
  }
  const favicon = new URL("../frontend/public/favicon.ico", import.meta.url);
  await writeFile(favicon, ico(favicons));
  console.log(`wrote ${fileURLToPath(favicon)}`);
} finally {
  await browser.close();
}
