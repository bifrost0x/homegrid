import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const base = process.env.HOMEGRID_TEST_URL || "http://localhost:8096";
assert.equal(
  new URL(base).port,
  "8096",
  "Use the disposable verification installation",
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const output = new URL("../test-results/", import.meta.url);
await mkdir(output, { recursive: true });
const results = [],
  scans = [],
  errors = [],
  created = [];
page.on("pageerror", (e) => errors.push(e.message));
async function api(path, method = "GET", data) {
  return page.evaluate(
    async ({ path, method, data }) => {
      const session = await (await fetch("/api/auth/session")).json();
      const response = await fetch("/api" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf_token,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.status === 204 ? undefined : response.json();
    },
    { path, method, data },
  );
}
async function check(name, action) {
  await action();
  results.push(name);
  console.log("PASS " + name);
}
async function scan(name) {
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  scans.push({ name, violations: report.violations });
  console.log(`AXE ${name}: ${report.violations.length}`);
}
async function reload(settings) {
  await api("/settings", "PATCH", settings);
  await page.reload();
  await expect(page.locator(".dashboard")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-design",
    settings.design,
  );
}
let original;
try {
  await page.goto(base);
  await page.getByLabel("Username", { exact: true }).fill("testadmin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("HomeGrid-browser-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".dashboard")).toBeVisible();
  original = await api("/settings");
  const designNames = [
    "HomeGrid",
    "Porcelain",
    "Dune",
    "Terracotta",
    "Rosewood",
    "Lavender",
    "Forest",
    "Lagoon",
    "Arctic",
    "Midnight",
    "Aurora",
    "Ember",
  ];
  await check(
    "twelve designs preview without writes; cancel restores saved appearance",
    async () => {
      await page.getByRole("button", { name: "Open settings" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator(".design-option")).toHaveCount(12);
      for (const name of designNames) {
        await dialog
          .getByRole("button", { name: `Use ${name} design`, exact: true })
          .click();
        await expect(
          dialog.locator(".appearance-preview").first(),
        ).toHaveAttribute("data-design", name.toLowerCase());
      }
      assert.deepEqual(await api("/settings"), original);
      await scan("Design gallery desktop");
      await page.screenshot({
        path: new URL("themes-gallery-desktop.png", output).pathname.replace(
          /^\/([A-Z]:)/,
          "$1",
        ),
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: "Discard and close", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-design",
        original.design,
      );
    },
  );
  await check(
    "design, wallpaper, custom color and layout save together and survive reload/export",
    async () => {
      await page.getByRole("button", { name: "Open settings" }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "Use Aurora design", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Use Arctic wallpaper", exact: true })
        .click();
      await dialog
        .getByLabel("Custom accent color", { exact: true })
        .fill("#ffffff");
      await dialog.getByRole("tab", { name: "Layout", exact: true }).click();
      await dialog
        .getByRole("combobox", { name: "Dashboard width", exact: true })
        .selectOption("full");
      await dialog
        .getByRole("combobox", { name: "Groups per row", exact: true })
        .selectOption("3");
      await dialog
        .getByRole("combobox", { name: "Applications per row", exact: true })
        .selectOption("6");
      await dialog
        .getByRole("combobox", { name: "Application style", exact: true })
        .selectOption("tiles");
      await scan("Layout settings desktop");
      await dialog
        .getByRole("button", { name: "Save layout", exact: true })
        .click();
      await expect(dialog.getByRole("status")).toContainText("saved");
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await page.reload();
      await expect(page.locator(".dashboard")).toHaveAttribute(
        "data-groups",
        "3",
      );
      const saved = await api("/settings");
      assert.equal(saved.design, "aurora");
      assert.equal(saved.wallpaper, "arctic");
      assert.equal(saved.custom_accent, "#ffffff");
      assert.equal(saved.columns, "6");
      assert.deepEqual((await api("/export")).settings, saved);
    },
  );
  await check(
    "three groups share a desktop row and collapse safely at 320px",
    async () => {
      const group = await api("/categories", "POST", {
        name: "Theme layout test",
        collapsed: false,
      });
      created.push(["categories", group.id]);
      const secondGroup = await api("/categories", "POST", {
        name: "Theme media test",
        collapsed: false,
      });
      created.push(["categories", secondGroup.id]);
      const secondApp = await api("/apps", "POST", {
        name: "Media layout test",
        url: "https://media-layout.test",
        category_id: secondGroup.id,
        icon: "builtin:film",
      });
      created.push(["apps", secondApp.id]);
      for (let i = 0; i < 6; i++) {
        const app = await api("/apps", "POST", {
          name: `Layout test ${i}`,
          url: `https://layout-${i}.test`,
          category_id: group.id,
          icon: "builtin:server",
        });
        created.push(["apps", app.id]);
      }
      await page.reload();
      await expect(page.locator(".category-section")).toHaveCount(
        new Set((await api("/apps")).map((app) => app.category_id)).size,
      );
      const boxes = await page
        .locator(".category-section")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            x: node.getBoundingClientRect().x,
            y: node.getBoundingClientRect().y,
          })),
        );
      assert.ok(boxes.length >= 3);
      assert.ok(Math.abs(boxes[0].y - boxes[2].y) < 2);
      assert.ok(boxes[2].x > boxes[0].x);
      await page.screenshot({
        path: new URL("themes-aurora-desktop.png", output).pathname.replace(
          /^\/([A-Z]:)/,
          "$1",
        ),
        fullPage: true,
      });
      await page.setViewportSize({ width: 320, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const mobile = await page
        .locator(".category-section")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().x),
        );
      assert.ok(mobile.every((x) => Math.abs(x - mobile[0]) < 2));
      await scan("Custom white accent mobile dashboard");
      await page.getByRole("button", { name: "Open settings" }).click();
      await scan("Design gallery mobile");
      assert.ok(
        await page
          .getByRole("dialog")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      );
      await page
        .getByRole("button", { name: "Use Forest design", exact: true })
        .click();
      await page.getByRole("tab", { name: "Layout", exact: true }).click();
      await scan("Layout settings mobile");
      await page
        .getByRole("button", { name: "Save layout", exact: true })
        .click();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.screenshot({
        path: new URL("themes-forest-mobile.png", output).pathname.replace(
          /^\/([A-Z]:)/,
          "$1",
        ),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1600, height: 1000 });
    },
  );
  await check(
    "every design renders in both modes with accessible surfaces and local wallpaper",
    async () => {
      for (const name of designNames) {
        const id = name.toLowerCase();
        const response = await context.request.get(
          `${base}/backgrounds/${id}.webp`,
        );
        assert.equal(response.status(), 200);
        assert.match(response.headers()["content-type"], /image\/webp/);
        for (const theme of ["light", "dark"]) {
          await reload({
            ...original,
            design: id,
            wallpaper: id,
            theme,
            background: "",
            custom_accent: "",
            background_strength: "balanced",
          });
          await scan(`${name} ${theme}`);
          if (
            ["dune", "lagoon", "ember", "midnight"].includes(id) &&
            theme === (id === "dune" || id === "lagoon" ? "light" : "dark")
          )
            await page.screenshot({
              path: new URL(
                `themes-${id}-desktop.png`,
                output,
              ).pathname.replace(/^\/([A-Z]:)/, "$1"),
              fullPage: true,
            });
        }
      }
    },
  );
  await check("list presentation uses one application column", async () => {
    await reload({ ...original, card_style: "list", columns: "6" });
    const rows = await page
      .locator(".app-grid")
      .evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/)
              .length,
        ),
      );
    assert.ok(rows.length > 0 && rows.every((n) => n === 1));
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(
    scans.filter((result) => result.violations.length),
    [],
    "Accessibility findings",
  );
} catch (error) {
  await page
    .screenshot({
      path: new URL("themes-failure.png", output).pathname.replace(
        /^\/([A-Z]:)/,
        "$1",
      ),
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(
    new URL("themes-layout.json", output),
    JSON.stringify({ passed: results, scans, errors }, null, 2),
  );
  for (const [kind, id] of created.filter(([kind]) => kind === "apps"))
    await api(`/${kind}/${id}`, "DELETE").catch(() => {});
  for (const [kind, id] of created.filter(([kind]) => kind === "categories"))
    await api(`/${kind}/${id}`, "DELETE").catch(() => {});
  if (original) await api("/settings", "PATCH", original).catch(() => {});
  await browser.close();
}
