// Captures the product screenshots used by README.md and the project website.
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
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");

const base = process.env.HOMEGRID_SCREENSHOT_URL || "http://127.0.0.1:8098";
const siteAssets = new URL("../site/assets/", import.meta.url);
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

const browser = await chromium.launch({ headless: true });
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
  const current = await api("/settings");
  await api("/settings", "PATCH", { ...current, ...appearance });

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
} finally {
  await browser.close();
}
