import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const base = process.env.HOMEGRID_TEST_URL || "http://localhost:8096";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname) &&
    new URL(base).port === "8096",
  "Disposable local installation only",
);
const output = new URL("../test-results/", import.meta.url);
await mkdir(output, { recursive: true });
const resume = process.argv.includes("--resume");
const state = resume
  ? JSON.parse(await readFile(new URL("quality-state.json", output), "utf8"))
  : {};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
  ...(resume ? { storageState: state.browser } : {}),
});
const page = await context.newPage();
const requests = [],
  errors = [],
  results = [],
  scans = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(base).origin) return route.continue();
  requests.push(url.href);
  return route.abort();
});
async function raw(path, method = "GET", data) {
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
      return {
        status: response.status,
        undo: response.headers.get("X-HomeGrid-Undo"),
        data: response.status === 204 ? undefined : await response.json(),
      };
    },
    { path, method, data },
  );
}
async function api(path, method = "GET", data) {
  const result = await raw(path, method, data);
  assert.ok(
    result.status >= 200 && result.status < 300,
    JSON.stringify(result),
  );
  return result.data;
}
async function check(name, action) {
  await action();
  results.push(name);
  console.log("PASS " + name);
}
async function scan(name) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  scans.push({ name, violations: result.violations });
  console.log(`AXE ${name}: ${result.violations.length}`);
}
async function screenshot(name) {
  await page.screenshot({
    path: fileURLToPath(new URL(name + ".png", output)),
    fullPage: true,
  });
}
async function addService(name, url, first = false) {
  await page
    .getByRole("button", {
      name: first ? "Add your first application" : "Add application",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Choose a service", exact: true })
    .click();
  await dialog
    .getByLabel("Search service templates", { exact: true })
    .fill(name);
  await dialog
    .getByRole("button", { name: `Use ${name} template`, exact: true })
    .click();
  await expect(
    dialog.getByLabel("Application URL", { exact: true }),
  ).toHaveValue("");
  await dialog.getByLabel("Application URL", { exact: true }).fill(url);
  await dialog
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
try {
  await page.goto(base);
  if (!resume) {
    await page.getByLabel("Username", { exact: true }).fill("testadmin");
    await page
      .getByLabel("Password", { exact: true })
      .fill("HomeGrid-browser-test-2026!");
    const setup = page.getByRole("button", {
      name: "Create your HomeGrid",
      exact: true,
    });
    if (await setup.isVisible()) await setup.click();
    else
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".dashboard")).toBeVisible();
    for (const app of await api("/apps"))
      await api(`/apps/${app.id}`, "DELETE");
    await page.reload();
    await check(
      "first-run welcome has exactly two clear paths on desktop and mobile",
      async () => {
        const welcome = page.getByRole("region", {
          name: "Welcome to HomeGrid",
        });
        await expect(welcome).toBeVisible();
        await expect(welcome.getByRole("button")).toHaveCount(2);
        await expect(page.locator(".toolbar")).toBeHidden();
        await scan("Welcome desktop");
        await screenshot("quality-welcome-desktop");
        await page.setViewportSize({ width: 320, height: 844 });
        await scan("Welcome mobile");
        await screenshot("quality-welcome-mobile");
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.setViewportSize({ width: 1440, height: 1000 });
      },
    );
    await check(
      "optional examples never navigate to placeholders and configure with only a URL",
      async () => {
        await page
          .getByRole("button", {
            name: "Load example applications",
            exact: true,
          })
          .click();
        await expect(page.getByTestId("application-card")).toHaveCount(4);
        assert.equal((await raw("/examples", "POST")).status, 409);
        assert.equal((await api("/apps")).length, 4);
        assert.equal(
          await page.locator('a[href*="example.homegrid.invalid"]').count(),
          0,
        );
        const configure = page
          .getByTestId("application-card")
          .filter({ hasText: "Nextcloud" })
          .locator("button.app-link");
        await configure.click({ button: "middle" });
        assert.equal(context.pages().length, 1);
        await page.keyboard.press("Escape");
        await configure.click();
        const dialog = page.getByRole("dialog");
        await expect(
          dialog.getByLabel("Application URL", { exact: true }),
        ).toHaveValue("");
        await dialog
          .getByLabel("Application URL", { exact: true })
          .fill("https://nextcloud.home.invalid");
        await dialog
          .getByRole("button", { name: "Save changes", exact: true })
          .click();
        await expect(dialog).not.toBeVisible();
        await scan("Configured examples");
        await screenshot("quality-examples-desktop");
        for (const app of await api("/apps"))
          await api(`/apps/${app.id}`, "DELETE");
        await page.reload();
      },
    );
    await check(
      "URL-only local catalog add prefills icons, details and categories",
      async () => {
        await addService("Jellyfin", "https://jellyfin.home.invalid", true);
        await addService("Plex", "https://plex.home.invalid");
        await addService("Nextcloud", "https://nextcloud.home.invalid");
        const apps = await api("/apps"),
          categories = await api("/categories");
        assert.equal(apps.length, 3);
        assert.ok(apps.every((app) => app.icon.startsWith("service:")));
        assert.equal(
          categories.find(
            (c) => c.id === apps.find((a) => a.name === "Jellyfin").category_id,
          ).name,
          "Media",
        );
        const card = page
          .getByTestId("application-card")
          .filter({ hasText: "Jellyfin" });
        await expect(
          card.locator('img[src="/service-icons/jellyfin.svg"]'),
        ).toBeVisible();
        await card
          .getByRole("button", {
            name: "More actions for Jellyfin",
            exact: true,
          })
          .click();
        await page
          .getByRole("menuitem", { name: "Edit Jellyfin", exact: true })
          .click();
        await page
          .getByLabel("Description", { exact: false })
          .fill("Our media collection");
        await page
          .getByRole("button", { name: "Save changes", exact: true })
          .click();
        await expect(card).toContainText("Our media collection");
        await scan("Catalog dashboard");
        await screenshot("quality-dashboard-desktop");
        await page.setViewportSize({ width: 320, height: 844 });
        await scan("Catalog dashboard mobile");
        await screenshot("quality-dashboard-mobile");
        await page.setViewportSize({ width: 1440, height: 1000 });
      },
    );
    await check(
      "failed local service art renders a vector fallback without a broken image",
      async () => {
        await context.route("**/service-icons/jellyfin.svg", (route) =>
          route.abort(),
        );
        await page.reload();
        const icon = page
          .getByTestId("application-card")
          .filter({ hasText: "Jellyfin" })
          .locator(".app-icon");
        await expect(icon.locator("svg")).toBeVisible();
        await expect(icon.locator("img")).toHaveCount(0);
        await context.unroute("**/service-icons/jellyfin.svg");
        await page.reload();
      },
    );
    await check(
      "appearance preview Save, Cancel and persisted Undo restore correct states",
      async () => {
        const original = await api("/settings");
        await page.getByRole("button", { name: "Open settings" }).click();
        const dialog = page.getByRole("dialog");
        await dialog
          .getByRole("button", { name: "Apply Forest preset", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "Save appearance", exact: true })
          .click();
        await expect(dialog.getByRole("status")).toContainText("saved");
        await dialog
          .getByRole("button", { name: "Apply Dune preset", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "Cancel changes", exact: true })
          .click();
        await expect(
          dialog.locator(".appearance-preview").first(),
        ).toHaveAttribute("data-design", "forest");
        assert.equal((await api("/settings")).design, "forest");
        await scan("Appearance cancel");
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await expect.poll(() => api("/settings")).toEqual(original);
      },
    );
    await check(
      "dashboard reorder and layout changes can each be undone",
      async () => {
        const before = await api("/apps");
        await page
          .getByRole("button", { name: "Organize", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Move Plex up", exact: true })
          .click();
        await expect
          .poll(async () => (await api("/apps")).map((a) => a.id))
          .not.toEqual(before.map((a) => a.id));
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await expect
          .poll(async () => (await api("/apps")).map((a) => a.id))
          .toEqual(before.map((a) => a.id));
        const settings = await api("/settings");
        await page.getByRole("button", { name: "Open settings" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("tab", { name: "Layout", exact: true }).click();
        await dialog
          .getByRole("combobox", { name: "Dashboard width", exact: true })
          .selectOption("wide");
        await dialog
          .getByRole("combobox", { name: "Groups per row", exact: true })
          .selectOption("2");
        await dialog
          .getByRole("button", { name: "Save layout", exact: true })
          .click();
        await expect(dialog.getByRole("status")).toContainText("saved");
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await expect.poll(() => api("/settings")).toEqual(settings);
      },
    );
    await check(
      "deletion undo remains available after page reload, ready for container restart",
      async () => {
        state.apps = await api("/apps");
        state.deleted = state.apps.find((app) => app.name === "Plex");
        await page
          .getByRole("button", { name: "More actions for Plex", exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "Delete Plex", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Delete application", exact: true })
          .click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await page.reload();
        await expect(
          page.getByRole("button", { name: "Undo", exact: true }),
        ).toBeVisible();
        state.token = (await api("/undo"))[0].token;
        state.browser = await context.storageState();
        await writeFile(
          new URL("quality-state.json", output),
          JSON.stringify(state),
        );
        await scan("Persisted deletion undo");
      },
    );
  } else {
    await check(
      "deletion undo survives container recreation and restores exact application identity",
      async () => {
        await expect(
          page.getByRole("button", { name: "Undo", exact: true }),
        ).toBeVisible();
        assert.equal((await api("/undo"))[0].token, state.token);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await expect.poll(() => api("/apps")).toEqual(state.apps);
        await page.reload();
        assert.deepEqual(await api("/apps"), state.apps);
        assert.equal(
          (await raw("/undo", "POST", { token: state.token })).status,
          409,
        );
      },
    );
    await check(
      "conflicting undo rejects restoration and preserves the later persisted state",
      async () => {
        const original = await api("/settings");
        const first = await raw("/settings", "PATCH", {
          ...original,
          title: "First edit",
        });
        const later = { ...original, title: "Later edit" };
        await api("/settings", "PATCH", later);
        assert.equal(
          (await raw("/undo", "POST", { token: first.undo })).status,
          409,
        );
        assert.deepEqual(await api("/settings"), later);
        await api("/settings", "PATCH", original);
        await page.reload();
        await scan("Restored dashboard");
        await screenshot("quality-restored-desktop");
      },
    );
  }
  assert.deepEqual(
    requests,
    [],
    "Catalog/examples must not contact remote services",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    scans.filter((scan) => scan.violations.length),
    [],
  );
} catch (error) {
  await screenshot("quality-failure").catch(() => {});
  throw error;
} finally {
  await writeFile(
    new URL(
      resume ? "product-quality-resume.json" : "product-quality.json",
      output,
    ),
    JSON.stringify({ passed: results, scans, requests, errors }, null, 2),
  );
  await browser.close();
}
