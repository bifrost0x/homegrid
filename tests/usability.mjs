import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const base = "http://localhost:8096";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const output = new URL("../test-results/", import.meta.url);
await mkdir(output, { recursive: true });
const checks = [],
  scans = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function api(path, method = "GET", data) {
  return page.evaluate(
    async ({ path, method, data }) => {
      const session = await (await fetch("/api/auth/session")).json();
      const result = await fetch("/api" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf_token,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      if (!result.ok) throw new Error(await result.text());
      return result.status === 204 ? null : result.json();
    },
    { path, method, data },
  );
}
async function check(name, action) {
  await action();
  checks.push(name);
  console.log("PASS " + name);
}
async function scan(name) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  scans.push({ name, violations: result.violations });
  console.log(`AXE ${name}: ${result.violations.length}`);
}
async function picture(name) {
  await page.screenshot({
    path: fileURLToPath(new URL(`usability-${name}.png`, output)),
    fullPage: true,
  });
}
async function actionsVisible() {
  for (const button of await page
    .getByRole("group", { name: "Settings actions" })
    .getByRole("button")
    .all()) {
    await expect(button).toBeInViewport({ ratio: 1 });
    assert.ok(
      await button.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    );
  }
}
let original, releaseSave;
try {
  await page.goto(base);
  await page.getByLabel("Username", { exact: true }).fill("testadmin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("HomeGrid-browser-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".dashboard")).toBeVisible();
  original = await api("/settings");
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
    [320, 568],
  ])
    await check(
      `settings remain usable at ${width}×${height} without obscured actions or focus`,
      async () => {
        await page.setViewportSize({ width, height });
        await page.getByRole("button", { name: "Open settings" }).click();
        const dialog = page.getByRole("dialog");
        await actionsVisible();
        await dialog
          .getByRole("button", { name: "Use Porcelain design", exact: true })
          .click();
        await expect(
          dialog.getByText("Unsaved changes", { exact: true }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", {
            name: "Discard and close",
            exact: true,
          }),
        ).toBeVisible();
        await actionsVisible();
        await scan(`Appearance ${width}×${height}`);
        await picture(`settings-${width}`);
        await dialog.getByLabel("Show application descriptions").focus();
        await page.keyboard.press("Tab");
        await expect(
          dialog.getByRole("button", { name: "Save appearance", exact: true }),
        ).toBeFocused();
        await actionsVisible();
        await dialog
          .getByRole("button", { name: "Cancel changes", exact: true })
          .click();
        assert.deepEqual(await api("/settings"), original);
        await dialog.getByRole("tab", { name: "Layout", exact: true }).click();
        await dialog
          .getByRole("combobox", { name: "Groups per row", exact: true })
          .selectOption(original.group_columns === "2" ? "1" : "2");
        await actionsVisible();
        await scan(`Layout ${width}×${height}`);
        await dialog
          .getByRole("button", { name: "Discard and close", exact: true })
          .click();
        assert.deepEqual(await api("/settings"), original);
      },
    );
  await check(
    "a delayed save cannot lose the draft through closing or further editing",
    async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.route("**/api/settings", async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        await new Promise((resolve) => {
          releaseSave = resolve;
        });
        await route.continue();
      });
      await page.getByRole("button", { name: "Open settings" }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Dashboard title")
        .fill("A saved walkthrough title");
      await dialog
        .getByRole("button", { name: "Save appearance", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: "Saving…", exact: true }),
      ).toBeDisabled();
      await expect(dialog.getByLabel("Dashboard title")).toBeDisabled();
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      releaseSave();
      releaseSave = undefined;
      await expect(dialog.getByRole("status")).toContainText("saved");
      await expect(
        dialog.getByText("Unsaved changes", { exact: true }),
      ).toHaveCount(0);
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      assert.equal((await api("/settings")).title, "A saved walkthrough title");
      await page.unroute("**/api/settings");
      await api("/settings", "PATCH", original);
      await page.reload();
    },
  );
  await check(
    "failed application loads show recovery instead of first-run actions",
    async () => {
      const apps = await api("/apps");
      let fail = true;
      await page.route("**/api/apps", (route) =>
        fail && route.request().method() === "GET"
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: "unavailable",
                  message: "Services temporarily unavailable. Try again.",
                },
              }),
            })
          : route.continue(),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Retry loading", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Welcome to HomeGrid" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Load example applications" }),
      ).toHaveCount(0);
      await scan("Recoverable mobile load error");
      await picture("load-error-mobile");
      fail = false;
      await page
        .getByRole("button", { name: "Retry loading", exact: true })
        .click();
      await expect(page.getByTestId("application-card")).toHaveCount(
        apps.length,
      );
      await expect(
        page.getByRole("button", { name: "Retry loading" }),
      ).toHaveCount(0);
      assert.deepEqual(await api("/apps"), apps);
      await page.unroute("**/api/apps");
    },
  );
  await check(
    "touch users can favorite, edit and reorder without accidental navigation",
    async () => {
      const apps = await api("/apps");
      const app = apps[0];
      const mobile = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: "reduce",
        storageState: await context.storageState(),
      });
      const touch = await mobile.newPage();
      try {
        await touch.goto(base);
        const card = touch
          .getByTestId("application-card")
          .filter({
            has: touch.locator(".app-copy strong", { hasText: app.name }),
          });
        await card.locator(".favorite-toggle").tap();
        await expect(card.locator(".favorite-toggle")).toHaveAttribute(
          "aria-pressed",
          String(!app.favorite),
        );
        await card
          .getByRole("button", {
            name: `More actions for ${app.name}`,
            exact: true,
          })
          .tap();
        await touch
          .getByRole("menuitem", { name: `Edit ${app.name}`, exact: true })
          .tap();
        await touch
          .getByLabel("Description", { exact: false })
          .fill("Edited using touch controls");
        await touch
          .getByRole("button", { name: "Save changes", exact: true })
          .tap();
        await expect(card).toContainText("Edited using touch controls");
        await touch
          .getByRole("button", { name: "Organize", exact: true })
          .tap();
        const order = (await api("/apps")).map((value) => value.id);
        const move = touch.getByRole("button", {
          name: `Move ${app.name} down`,
          exact: true,
        });
        if (await move.isEnabled()) {
          await move.tap();
          await expect
            .poll(async () => (await api("/apps")).map((value) => value.id))
            .not.toEqual(order);
          await touch.getByRole("button", { name: "Undo", exact: true }).tap();
          await expect
            .poll(async () => (await api("/apps")).map((value) => value.id))
            .toEqual(order);
        }
        const report = await new AxeBuilder({ page: touch })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        scans.push({
          name: "Emulated touch organization",
          violations: report.violations,
        });
        await touch.screenshot({
          path: fileURLToPath(new URL("usability-touch-mobile.png", output)),
          fullPage: true,
        });
        assert.equal(mobile.pages().length, 1);
      } finally {
        await mobile.close();
        await api(`/apps/${app.id}`, "PATCH", app);
      }
    },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    scans.filter((scan) => scan.violations.length),
    [],
  );
} catch (error) {
  await picture("failure").catch(() => {});
  throw error;
} finally {
  releaseSave?.();
  await page.unroute("**/api/settings").catch(() => {});
  await page.unroute("**/api/apps").catch(() => {});
  if (original) await api("/settings", "PATCH", original).catch(() => {});
  await writeFile(
    new URL("usability.json", output),
    JSON.stringify({ checks, scans, errors }, null, 2),
  );
  await browser.close();
}
