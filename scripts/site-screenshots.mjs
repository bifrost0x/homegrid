// Captures the product screenshots used by README.md and the project website,
// plus two animated WebPs for the README: a montage of presets and appearance
// options, and a short interaction tour. Both are encoded with ffmpeg, which
// must be on PATH and built with libwebp.
//
// Run against a disposable, empty HomeGrid instance; the script creates the
// administrator and fills the dashboard with fictional example services:
//
//   docker build -q -t homegrid:site .
//   docker run -d --name homegrid-site --read-only --cap-drop ALL \
//     --tmpfs /tmp:size=16m --tmpfs /data:uid=65532,gid=65532,mode=0700 \
//     -p 127.0.0.1:8098:8080 homegrid:site
//   node scripts/site-screenshots.mjs
//   docker rm -f homegrid-site
//
// HOMEGRID_SCREENSHOT_URL overrides the target (default http://127.0.0.1:8098).
// The administrator password is random and never printed, so the instance
// cannot be reused; recreate the container to capture again.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// Presets come from the frontend source so the montage follows its changes.
import { applyPreset, extraAccents } from "../frontend/src/themes.ts";

const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");

const base = process.env.HOMEGRID_SCREENSHOT_URL || "http://127.0.0.1:8098";
const siteAssets = new URL("../site/assets/", import.meta.url);
// The tour is only shown in the README, so it stays out of the website build.
const docsAssets = new URL("../docs/assets/", import.meta.url);
const path = (url) => fileURLToPath(url);

const categories = [
  {
    name: "Media",
    apps: [
      [
        "Jellyfin",
        "https://jellyfin.home.arpa",
        "Films, series and home videos",
        "jellyfin",
        true,
      ],
      [
        "Immich",
        "https://photos.home.arpa",
        "Family photo library",
        "immich",
        true,
      ],
      [
        "Audiobookshelf",
        "https://books.home.arpa",
        "Audiobooks and podcasts",
        "audiobookshelf",
      ],
      ["Sonarr", "https://sonarr.home.arpa", "Series collection", "sonarr"],
    ],
  },
  {
    name: "Files & documents",
    apps: [
      [
        "Nextcloud",
        "https://cloud.home.arpa",
        "Files, calendars and contacts",
        "nextcloud",
        true,
      ],
      [
        "Paperless-ngx",
        "https://docs.home.arpa",
        "Scanned letters and receipts",
        "paperlessngx",
      ],
      [
        "Vaultwarden",
        "https://vault.home.arpa",
        "Shared family passwords",
        "vaultwarden",
      ],
      [
        "Syncthing",
        "https://sync.home.arpa",
        "Device synchronization",
        "syncthing",
      ],
    ],
  },
  {
    name: "Home",
    apps: [
      [
        "Home Assistant",
        "https://ha.home.arpa",
        "Lights, heating and sensors",
        "homeassistant",
        true,
      ],
      [
        "Mealie",
        "https://recipes.home.arpa",
        "Recipes and meal plans",
        "mealie",
      ],
      ["FreshRSS", "https://news.home.arpa", "Feeds worth reading", "freshrss"],
    ],
  },
  {
    name: "Infrastructure",
    apps: [
      [
        "Proxmox",
        "https://pve.home.arpa:8006",
        "Virtual machines and containers",
        "proxmox",
      ],
      [
        "TrueNAS",
        "https://nas.home.arpa",
        "Storage pools and snapshots",
        "truenas",
      ],
      [
        "Portainer",
        "https://portainer.home.arpa",
        "Docker stacks",
        "portainer",
      ],
      [
        "AdGuard Home",
        "https://dns.home.arpa",
        "Network-wide DNS filtering",
        "adguardhome",
      ],
      [
        "Nginx Proxy Manager",
        "https://proxy.home.arpa",
        "Reverse proxy and certificates",
        "nginxproxymanager",
      ],
    ],
  },
  {
    name: "Monitoring",
    apps: [
      [
        "Grafana",
        "https://grafana.home.arpa",
        "Dashboards and metrics",
        "grafana",
      ],
      [
        "Uptime Kuma",
        "https://status.home.arpa",
        "Service availability",
        "uptimekuma",
      ],
      [
        "Prometheus",
        "https://metrics.home.arpa",
        "Metrics collection",
        "prometheus",
      ],
    ],
  },
];

// Mirrors the HomeGrid preset (alpine lake photo, sage accent).
const appearance = {
  design: "homegrid",
  wallpaper: "homegrid",
  theme: "light",
  accent: "sage",
  background_strength: "balanced",
  content_width: "wide",
  card_style: "cards",
  group_columns: "2",
  columns: "auto",
  show_descriptions: true,
};

// Fail before seeding the instance rather than after the screenshots.
try {
  execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" });
} catch {
  throw new Error("ffmpeg is required to encode the product tour.");
}

// Mirrors the Aurora preset for the dark-mode screenshot.
const darkAppearance = {
  design: "aurora",
  wallpaper: "aurora",
  theme: "dark",
  accent: "violet",
};

// Scenes of the appearance montage. Each starts from a preset; `settings`
// refines it and `panel` shows a settings section instead of the dashboard,
// either a tab or a heading in the Appearance tab.
const accent = (name) => extraAccents.find((a) => a.name === name).hex;
const montageScenes = [
  { caption: "HomeGrid", preset: "homegrid" },
  { caption: "Aurora · dark", preset: "aurora" },
  { caption: "Porcelain", preset: "porcelain" },
  { caption: "Midnight · dark", preset: "midnight" },
  { caption: "Lagoon", preset: "lagoon" },
  { caption: "Rosewood · dark", preset: "rosewood" },
  { caption: "Nebula · generated gradient", preset: "nebula" },
  { caption: "Sunrise · generated gradient", preset: "sunrise" },
  { caption: "Paper · no background", preset: "paper" },
  {
    caption: "Twenty presets, previewed live",
    preset: "homegrid",
    panel: { heading: "Presets" },
  },
  {
    caption: "Palettes, accents and custom colors",
    preset: "lavender",
    panel: { heading: "Colors" },
  },
  {
    caption: "Photos, gradients or your own image",
    preset: "lagoon",
    panel: { heading: "Background" },
  },
  {
    caption: "Width, columns and card style",
    preset: "arctic",
    panel: { tab: "Layout" },
  },
  {
    caption: "Tiles",
    preset: "dune",
    settings: { card_style: "tiles" },
  },
  {
    caption: "List · three columns",
    preset: "arctic",
    settings: { card_style: "list", group_columns: "3" },
  },
  {
    caption: "Compact · without descriptions",
    preset: "forest",
    settings: {
      density: "compact",
      show_descriptions: false,
      group_columns: "3",
    },
  },
  {
    caption: "Custom accent",
    preset: "ember",
    settings: { custom_accent: accent("Orange") },
  },
  {
    caption: "Square corners",
    preset: "graphite",
    settings: { radius: "square" },
  },
];

const browser = await chromium.launch({ headless: true });
const videoDir = await mkdtemp(join(tmpdir(), "homegrid-tour-"));
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  // Keep the capture offline: block anything that is not the local instance.
  await context.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  const page = await context.newPage();
  await page.goto(base);

  const api = (apiPath, method = "GET", data) =>
    page.evaluate(
      async ({ apiPath, method, data }) => {
        const s = await (await fetch("/api/auth/session")).json();
        const r = await fetch("/api" + apiPath, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": s.csrf_token,
          },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
        if (!r.ok)
          throw new Error(
            `${method} ${apiPath}: ${r.status} ${await r.text()}`,
          );
        return r.status === 204 ? null : r.json();
      },
      { apiPath, method, data },
    );

  const session = await api("/auth/session");
  if (!session.setup_required) {
    throw new Error(
      "The target instance is already set up; use a fresh container.",
    );
  }
  await api("/auth/setup", "POST", {
    username: "admin",
    password: randomBytes(24).toString("base64url"),
  });

  let order = 0;
  for (const [index, group] of categories.entries()) {
    const category =
      index === 0
        ? await api("/categories/1", "PATCH", {
            id: 1,
            name: group.name,
            sort_order: 0,
            collapsed: false,
          })
        : await api("/categories", "POST", {
            name: group.name,
            sort_order: index,
            collapsed: false,
          });
    for (const [
      name,
      url,
      description,
      service,
      favorite = false,
    ] of group.apps) {
      await api("/apps", "POST", {
        name,
        url,
        description,
        icon: "service:" + service,
        icon_color: "auto",
        category_id: category.id,
        sort_order: order++,
        open_in_new_tab: true,
        favorite,
      });
    }
  }
  const baseline = { ...(await api("/settings")), ...appearance };
  await api("/settings", "PATCH", baseline);

  await mkdir(siteAssets, { recursive: true });

  // Encodes a PNG buffer as WebP with the browser's own encoder, so the
  // script needs no image tooling beyond Playwright.
  const encoder = await context.newPage();
  async function toWebp(png, quality = 0.82) {
    const dataUrl = await encoder.evaluate(
      async ({ src, quality }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        return canvas.toDataURL("image/webp", quality);
      },
      { src: "data:image/png;base64," + png.toString("base64"), quality },
    );
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  }
  // The README shows the same WebP files as the website.
  async function save(png, name) {
    const webp = await toWebp(png);
    await writeFile(path(new URL(name + ".webp", siteAssets)), webp);
    console.log(`${name}: ${Math.round(webp.length / 1024)} KB webp`);
  }

  async function ready(target) {
    await target.goto(base);
    await expect(
      target.getByRole("button", { name: "Open settings" }),
    ).toBeVisible();
    await expect(target.locator(".dashboard-loading")).toBeHidden();
    // The seeded appearance change offers an undo toast; hide it for the capture.
    const dismiss = target.getByRole("button", {
      name: "Dismiss notification",
    });
    if (await dismiss.isVisible()) await dismiss.click();
    await expect(target.locator(".feedback")).toBeHidden();
    await target.evaluate(() => document.fonts.ready);
    await target.waitForTimeout(400);
  }

  // Desktop dashboard.
  await ready(page);
  await save(await page.screenshot(), "dashboard-desktop");

  // Add-application dialog recognizing a service from its address.
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Application URL", { exact: true })
    .fill("https://gitea.home.arpa");
  await dialog.getByLabel("Application URL", { exact: true }).blur();
  await expect(dialog.getByRole("status")).toContainText("Recognized Gitea");
  await expect(
    dialog.getByLabel("Application name", { exact: true }),
  ).toHaveValue("Gitea");
  await dialog.getByLabel("Application name", { exact: true }).blur();
  await page.waitForTimeout(300);
  await save(await dialog.screenshot(), "add-application");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Appearance settings.
  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog");
  await expect(settings.locator(".preset-grid .design-option")).toHaveCount(20);
  await page.waitForTimeout(400);
  await save(await page.screenshot(), "appearance");
  await page.keyboard.press("Escape");

  // Mobile dashboard.
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
    reducedMotion: "reduce",
    storageState: await context.storageState(),
  });
  await mobile.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  const phone = await mobile.newPage();
  await ready(phone);
  await save(await phone.screenshot(), "dashboard-mobile");
  await mobile.close();

  await recordTour(await context.storageState(), ready);
  await recordMontage(page, api, baseline, ready);

  // Dark mode, last, because it changes the saved appearance.
  await api("/settings", "PATCH", { ...baseline, ...darkAppearance });
  await ready(page);
  await save(await page.screenshot(), "dashboard-dark");
} finally {
  await browser.close();
  await rm(videoDir, { recursive: true, force: true });
}

// Records a short walk through search, quick add and appearance presets, and
// encodes it as an animated WebP. Playwright videos show no mouse pointer, so
// the page draws one that follows the synthetic mouse.
async function recordTour(storageState, ready) {
  const size = { width: 1280, height: 800 };
  const tour = await browser.newContext({
    viewport: size,
    colorScheme: "light",
    storageState,
    recordVideo: { dir: videoDir, size },
  });
  await tour.route(
    (url) => !url.href.startsWith(base),
    (route) => route.abort(),
  );
  await tour.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const dot = document.createElement("div");
      dot.setAttribute("aria-hidden", "true");
      dot.style.cssText =
        "position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;" +
        "border-radius:50%;background:rgba(20,24,22,.55);border:2px solid #fff;" +
        "box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;" +
        "transform:translate(-40px,-40px);transition:scale .12s";
      document.body.append(dot);
      addEventListener(
        "mousemove",
        (e) =>
          (dot.style.transform = `translate(${e.clientX}px,${e.clientY}px)`),
        true,
      );
      addEventListener("mousedown", () => (dot.style.scale = "0.7"), true);
      addEventListener("mouseup", () => (dot.style.scale = "1"), true);
    });
  });
  const started = Date.now();
  const tab = await tour.newPage();
  await ready(tab);
  const pause = (ms) => tab.waitForTimeout(ms);
  async function pointAt(locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("Tour target is not visible.");
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 18,
    });
    await pause(180);
  }
  async function clickOn(locator) {
    await pointAt(locator);
    await tab.mouse.down();
    await pause(90);
    await tab.mouse.up();
  }

  await tab.mouse.move(900, 700);
  const offset = (Date.now() - started) / 1000;
  await pause(1400);

  // Search with the keyboard shortcut.
  await pointAt(tab.locator(".dashboard-search"));
  await tab.keyboard.press("Control+k");
  const search = tab.getByLabel("Search applications");
  await expect(search).toBeFocused();
  await pause(400);
  await search.pressSequentially("graf", { delay: 160 });
  await expect(tab.getByRole("option", { name: /Grafana/ })).toBeVisible();
  await pause(1300);
  await tab.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await pause(400);

  // Quick add recognizes a service from its address.
  await clickOn(
    tab.getByRole("button", { name: "Add application", exact: true }),
  );
  const dialog = tab.getByRole("dialog");
  const url = dialog.getByLabel("Application URL", { exact: true });
  await clickOn(url);
  await url.pressSequentially("https://gitea.home.arpa", { delay: 55 });
  await url.blur();
  await expect(dialog.getByRole("status")).toContainText("Recognized Gitea");
  await pause(1800);
  await tab.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await pause(400);

  // Presets preview live and are only applied on save.
  await clickOn(tab.getByRole("button", { name: "Open settings" }));
  const settings = tab.getByRole("dialog");
  const presets = settings.locator(".preset-grid .design-option");
  await expect(presets).toHaveCount(20);
  await pause(700);
  for (const name of ["Aurora", "Lagoon", "Midnight"]) {
    await clickOn(presets.filter({ hasText: name }));
    await pause(1200);
  }
  await clickOn(settings.getByRole("button", { name: "Cancel changes" }));
  await pause(500);
  await tab.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await pause(1200);

  const video = tab.video();
  await tour.close();
  const webm = await video.path();
  await mkdir(docsAssets, { recursive: true });
  const tourFile = path(new URL("product-tour.webp", docsAssets));
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      offset.toFixed(2),
      "-i",
      webm,
      "-vf",
      "fps=15",
      "-c:v",
      "libwebp_anim",
      "-quality",
      "78",
      "-compression_level",
      "6",
      "-loop",
      "0",
      tourFile,
    ],
    { stdio: "inherit" },
  );
  console.log(
    `product-tour: ${Math.round((await stat(tourFile)).size / 1024)} KB webp`,
  );
}

// Renders the dashboard once per scene and joins the frames into an animated
// WebP with short crossfades. The last transition returns to the first scene,
// so the loop has no visible cut. Leaves the instance on the last scene.
async function recordMontage(page, api, baseline, ready) {
  // Seconds each scene is on screen, its fade into the next included.
  const hold = 1.5;
  // Fade frames cost most of the file size; a short fade keeps it small.
  const fade = 0.2;
  const fps = 15;
  await page.setViewportSize({ width: 1280, height: 800 });
  const frames = [];
  for (const [index, scene] of montageScenes.entries()) {
    await api("/settings", "PATCH", {
      ...applyPreset(baseline, scene.preset),
      ...scene.settings,
    });
    await ready(page);
    // Park the pointer on the empty band below the top bar so no card shows
    // its hover state.
    await page.mouse.move(640, 128);
    if (scene.panel) {
      await page.getByRole("button", { name: "Open settings" }).click();
      const settings = page.getByRole("dialog");
      if (scene.panel.tab) {
        await settings.getByRole("tab", { name: scene.panel.tab }).click();
      } else {
        await settings
          .getByRole("heading", { name: scene.panel.heading, exact: true })
          .evaluate((heading) => heading.scrollIntoView({ block: "start" }));
      }
      await page.mouse.move(640, 6);
      await page.waitForTimeout(400);
    }
    await page.evaluate((text) => {
      const label = document.createElement("div");
      label.textContent = text;
      label.style.cssText =
        "position:fixed;left:50%;top:26px;transform:translateX(-50%);" +
        "padding:10px 20px;border-radius:999px;font-weight:600;font-size:17px;" +
        "line-height:1.2;font-family:inherit;color:#fff;" +
        "background:rgba(17,20,19,.78);border:1px solid rgba(255,255,255,.22);" +
        "backdrop-filter:blur(10px);box-shadow:0 6px 24px rgba(0,0,0,.3);" +
        "letter-spacing:.01em;z-index:2147483647;white-space:nowrap";
      document.body.append(label);
    }, scene.caption);
    const frame = join(videoDir, `scene-${String(index).padStart(2, "0")}.png`);
    await page.screenshot({ path: frame });
    frames.push(frame);
    if (scene.panel) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  const sequence = [...frames, frames[0]];
  const inputs = sequence.flatMap((frame, i) => [
    "-loop",
    "1",
    "-framerate",
    String(fps),
    "-t",
    // The closing copy of the first scene only needs to cover its fade-in.
    String(i === sequence.length - 1 ? fade : hold + fade),
    "-i",
    frame,
  ]);
  let filter = "";
  let previous = "[0:v]";
  for (let i = 1; i < sequence.length; i++) {
    const output = i === sequence.length - 1 ? "[out]" : `[v${i}]`;
    filter += `${previous}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${(i * hold).toFixed(2)}${output};`;
    previous = output;
  }
  const montage = path(new URL("themes-montage.webp", docsAssets));
  await mkdir(docsAssets, { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...inputs,
      "-filter_complex",
      filter.slice(0, -1),
      "-map",
      "[out]",
      "-c:v",
      "libwebp_anim",
      "-quality",
      "80",
      "-compression_level",
      "6",
      "-loop",
      "0",
      montage,
    ],
    { stdio: "inherit" },
  );
  console.log(
    `themes-montage: ${Math.round((await stat(montage)).size / 1024)} KB webp`,
  );
}
