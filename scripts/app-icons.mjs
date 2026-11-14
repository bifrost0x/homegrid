// Renders the installable web app icons in frontend/public/icons/ from the
// HomeGrid logo. The PNGs are committed; rerun after changing the logo:
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
const icons = [
  { name: "icon-192.png", size: 192, scale: 0.78 },
  { name: "icon-512.png", size: 512, scale: 0.78 },
  { name: "maskable-512.png", size: 512, scale: 0.56 },
  { name: "apple-touch-icon.png", size: 180, scale: 0.7 },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const { name, size, scale } of icons) {
    const edge = Math.round(size * scale);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${background};display:grid;place-items:center}svg{width:${edge}px;height:${edge}px;display:block}</style>${logo}`,
    );
    const png = await page.screenshot({ type: "png", omitBackground: false });
    await writeFile(new URL(name, output), png);
    console.log(`wrote ${fileURLToPath(new URL(name, output))}`);
  }
} finally {
  await browser.close();
}
