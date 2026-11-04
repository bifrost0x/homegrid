import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const base = process.env.HOMEGRID_TEST_URL || "http://localhost:8096";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  colorScheme: "light",
  acceptDownloads: true,
});
await context.route("https://atlas.example.test/**", (route) =>
  route.fulfill({
    body: "Atlas browser test target",
    contentType: "text/plain",
  }),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const output = new URL("../test-results/", import.meta.url);
await mkdir(output, { recursive: true });
let checks = 0;
let welcomeAppId;
async function check(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}
async function login(target = page) {
  await target.getByLabel("Username", { exact: true }).fill("testadmin");
  await target
    .getByLabel("Password", { exact: true })
    .fill("HomeGrid-browser-test-2026!");
  await target.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    target.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
  const organize = target.getByRole("button", {
    name: "Organize",
    exact: true,
  });
  if (await organize.count()) await organize.click();
}
async function api(path, method = "GET", data) {
  return page.evaluate(
    async ({ path, method, data }) => {
      const s = await (await fetch("/api/auth/session")).json();
      const r = await fetch("/api" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": s.csrf_token,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.status === 204 ? null : r.json();
    },
    { path, method, data },
  );
}
async function add(name, url, category = "General", description = "") {
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Application name", { exact: true }).fill(name);
  await dialog.getByLabel("Application URL", { exact: true }).fill(url);
  await dialog.getByLabel("Description", { exact: false }).fill(description);
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption({ label: category });
  await dialog.getByRole("button", { name: "Use server icon" }).click();
  await dialog
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(name) }),
  ).toBeVisible();
}
async function settings(tab = "Appearance") {
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  const target = dialog.getByRole("tab", { name: tab, exact: true });
  if (await target.count()) await target.click();
  return dialog;
}
try {
  await page.goto(base);
  if (process.argv.includes("--persistence")) {
    await login();
    await check("storage survives container restart", async () => {
      await expect(
        page.getByRole("heading", { name: "The test homelab", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Atlas Storage/ }),
      ).toBeVisible();
      const apps = await api("/apps");
      assert.equal(
        apps.find((a) => a.name === "Atlas Storage").description,
        "Files and backups",
      );
      assert.equal((await api("/settings")).theme, "dark");
    });
  } else {
    await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
    if (
      await page
        .getByRole("button", { name: "Create your HomeGrid" })
        .isVisible()
    ) {
      await check("first-run administrator setup", async () => {
        await expect(
          page.getByRole("heading", { name: "A home for your homelab." }),
        ).toBeVisible();
        await page.getByLabel("Username", { exact: true }).fill("testadmin");
        await page
          .getByLabel("Password", { exact: true })
          .fill("HomeGrid-browser-test-2026!");
        await page
          .getByRole("button", { name: "Create your HomeGrid" })
          .click();
        await expect(
          page.getByRole("button", { name: "Open settings" }),
        ).toBeVisible();
      });
    } else {
      await login();
    }
    // Only the disposable verification installation uses these credentials.
    for (const app of await api("/apps"))
      await api("/apps/" + app.id, "DELETE");
    for (const cat of await api("/categories"))
      if (cat.id !== 1) await api("/categories/" + cat.id, "DELETE");
    await api("/categories/1", "PATCH", { name: "General", collapsed: false });
    await api("/settings", "PATCH", {
      title: "Your services, together.",
      theme: "light",
      accent: "sage",
      density: "comfortable",
      radius: "rounded",
      background: "",
      blur: false,
      show_descriptions: true,
    });
    await page.reload();
    await check("logout and login", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await login();
    });
    await check("create category", async () => {
      if (
        await page
          .getByRole("button", {
            name: "Add your first application",
            exact: true,
          })
          .isVisible()
      ) {
        await page
          .getByRole("button", {
            name: "Add your first application",
            exact: true,
          })
          .click();
        await page
          .getByLabel("Application name", { exact: true })
          .fill("Welcome workflow");
        await page
          .getByLabel("Application URL", { exact: true })
          .fill("https://welcome.example.test");
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Add application", exact: true })
          .click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        welcomeAppId = (await api("/apps")).find(
          (app) => app.name === "Welcome workflow",
        ).id;
        await page
          .getByRole("button", { name: "Organize", exact: true })
          .click();
      }
      await page
        .getByRole("button", { name: "New category", exact: true })
        .click();
      await page.getByLabel("Category name").fill("Media");
      await page
        .getByRole("button", { name: "Create category", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Media", exact: true }),
      ).toBeVisible();
    });
    await check("add applications and validation", async () => {
      await page
        .getByRole("button", { name: "Add application", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Add application", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("name");
      await page.getByRole("button", { name: "Close dialog" }).click();
      await add(
        "Atlas",
        "https://atlas.example.test",
        "Media",
        "Files and backups",
      );
      await add(
        "Echo Music",
        "https://music.example.test",
        "Media",
        "A listening room",
      );
      if (welcomeAppId) {
        await api("/apps/" + welcomeAppId, "DELETE");
        await page.reload();
        await page
          .getByRole("button", { name: "Organize", exact: true })
          .click();
      }
    });
    await check("accessible reorder persists", async () => {
      await page
        .getByRole("button", { name: "Move Echo Music up", exact: true })
        .click();
      await expect
        .poll(async () => (await api("/apps")).map((a) => a.name))
        .toEqual(["Echo Music", "Atlas"]);
    });
    await check("pointer drag reorder persists", async () => {
      const from = page.getByRole("button", {
        name: "Drag Echo Music",
        exact: true,
      });
      const to = page.getByRole("button", { name: "Drag Atlas", exact: true });
      await from.hover();
      const a = await from.boundingBox(),
        b = await to.boundingBox();
      assert.ok(a && b);
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, {
        steps: 5,
      });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
        steps: 20,
      });
      await page.mouse.up();
      await expect
        .poll(async () => (await api("/apps")).map((a) => a.name))
        .toEqual(["Atlas", "Echo Music"]);
    });
    await check("edit and move application", async () => {
      await page
        .getByRole("button", { name: "Edit Atlas", exact: true })
        .click();
      const d = page.getByRole("dialog");
      await d
        .getByLabel("Application name", { exact: true })
        .fill("Atlas Storage");
      await d
        .getByRole("combobox", { name: "Category", exact: true })
        .selectOption({ label: "General" });
      await d.getByRole("button", { name: "Save changes" }).click();
      await expect(
        page
          .getByRole("region", { name: "General", exact: true })
          .getByRole("link", { name: /Atlas Storage/ }),
      ).toBeVisible();
    });
    await check("rename, collapse and reorder category", async () => {
      await page
        .getByRole("button", { name: "Edit category Media", exact: true })
        .click();
      await page.getByLabel("Category name").fill("Entertainment");
      await page.getByRole("button", { name: "Save category" }).click();
      await page
        .getByRole("button", {
          name: "Move category Entertainment up",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await api("/categories"))[0].name)
        .toBe("Entertainment");
      const region = page.getByRole("region", {
        name: "Entertainment",
        exact: true,
      });
      await region.getByRole("button", { name: /^Entertainment/ }).click();
      await expect(region.getByRole("link")).toHaveCount(0);
      await region.getByRole("button", { name: /^Entertainment/ }).click();
      await expect(
        region.getByRole("link", { name: /Echo Music/ }),
      ).toBeVisible();
    });
    await check("keyboard category drag persists", async () => {
      await expect(page.locator(".dashboard")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      const handle = page.getByRole("button", {
        name: "Drag category Entertainment",
        exact: true,
      });
      await handle.focus();
      await page.keyboard.press("Space");
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.keyboard.press("ArrowDown");
      await expect(
        page.locator('[role="status"][id^="DndLiveRegion"]'),
      ).toContainText("was moved over droppable area category-1");
      await page.keyboard.press("Space");
      await expect
        .poll(async () => (await api("/categories")).map((c) => c.name))
        .toEqual(["General", "Entertainment"]);
    });
    await check("command palette keyboard navigation and launch", async () => {
      await page.keyboard.press("Control+k");
      const input = page.getByRole("combobox", { name: "Search applications" });
      await input.fill("backups");
      await expect(page.getByRole("option")).toHaveCount(1);
      await expect(page.getByRole("option")).toContainText("Atlas Storage");
      await input.fill("Entertainment");
      await expect(page.getByRole("option")).toContainText("Echo Music");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox").fill("Atlas Storage");
      const popup = context.waitForEvent("page");
      await page.keyboard.press("Enter");
      const launched = await popup;
      await launched.waitForLoadState("domcontentloaded").catch(() => {});
      assert.ok(launched.url().includes("atlas.example.test"));
      await launched.close();
    });
    await check("delete application", async () => {
      await page
        .getByRole("button", { name: "Delete Echo Music", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Delete application", exact: true })
        .click();
      await expect(page.getByRole("link", { name: /Echo Music/ })).toHaveCount(
        0,
      );
    });
    await check("category deletion preserves applications", async () => {
      await add(
        "Category survivor",
        "https://survivor.example.test",
        "Entertainment",
      );
      await page
        .getByRole("button", {
          name: "Delete category Entertainment",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Delete category", exact: true })
        .click();
      await expect(
        page
          .getByRole("region", { name: "General", exact: true })
          .getByRole("link", { name: /Category survivor/ }),
      ).toBeVisible();
    });
    await check("uploaded icon content and searchable picker", async () => {
      await page
        .getByRole("button", { name: "Edit Atlas Storage", exact: true })
        .click();
      const d = page.getByRole("dialog");
      await d.getByLabel("Search icons").fill("database");
      await expect(
        d.getByRole("button", { name: "Use database icon" }),
      ).toBeVisible();
      await d.locator("input[type=file]").setInputFiles({
        name: "icon.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          await page.evaluate(() => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 32;
            const context = canvas.getContext("2d");
            context.fillStyle = "#49654c";
            context.fillRect(0, 0, 32, 32);
            return canvas.toDataURL("image/png").split(",")[1];
          }),
          "base64",
        ),
      });
      await expect(d.getByText("Custom image", { exact: true })).toBeVisible();
      await d.getByRole("button", { name: "Save changes" }).click();
      await expect(
        page.getByRole("link", { name: /Atlas Storage/ }).locator("img"),
      ).toBeVisible();
    });
    await check(
      "cross-tab session changes preserve edits and allow retry",
      async () => {
        await page
          .getByRole("button", { name: "Edit Atlas Storage", exact: true })
          .click();
        const d = page.getByRole("dialog");
        await d
          .getByLabel("Description", { exact: false })
          .fill("Files and backups");
        const other = await context.newPage();
        await other.goto(base);
        await other.getByRole("button", { name: "Sign out" }).click();
        await login(other);
        await other.close();
        await d.getByRole("button", { name: "Save changes" }).click();
        await expect(d.getByRole("alert")).toContainText("session changed");
        await expect(d.getByLabel("Description", { exact: false })).toHaveValue(
          "Files and backups",
        );
        await d.getByRole("button", { name: "Save changes" }).click();
        await expect(d).not.toBeVisible();
      },
    );
    await check(
      "background, blur and description controls persist",
      async () => {
        const d = await settings();
        const buffer = Buffer.from(
          await page.evaluate(() => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 16;
            canvas.getContext("2d").fillRect(0, 0, 16, 16);
            return canvas.toDataURL("image/png").split(",")[1];
          }),
          "base64",
        );
        await d.locator("input[type=file]").first().setInputFiles({
          name: "background.png",
          mimeType: "image/png",
          buffer,
        });
        await expect(
          d.getByAltText("Current dashboard background"),
        ).toBeVisible();
        await d.getByLabel("Subtle background blur").check();
        await d.getByLabel("Show application descriptions").uncheck();
        await d.getByRole("button", { name: "Save appearance" }).click();
        await expect(d.getByRole("status")).toContainText("saved");
        await d.getByRole("button", { name: "Done", exact: true }).click();
        await page.reload();
        await expect(page.locator(".custom-background")).toBeVisible();
        assert.equal((await api("/settings")).blur, true);
        await expect(
          page.getByText("Files and backups", { exact: true }),
        ).toHaveCount(0);
        const reset = await settings();
        await reset
          .getByRole("button", { name: "Remove", exact: true })
          .click();
        await reset.getByLabel("Subtle background blur").uncheck();
        await reset.getByLabel("Show application descriptions").check();
        await reset.getByRole("button", { name: "Save appearance" }).click();
        await expect(reset.getByRole("status")).toContainText("saved");
        await reset.getByRole("button", { name: "Done", exact: true }).click();
      },
    );
    await check("appearance persists after reload", async () => {
      const d = await settings();
      await d.getByLabel("Dashboard title").fill("The test homelab");
      await d
        .getByRole("combobox", { name: "Theme", exact: true })
        .selectOption("dark");
      await d
        .getByRole("button", { name: "Use blue accent", exact: true })
        .click();
      await d
        .getByRole("combobox", { name: "Card layout", exact: true })
        .selectOption("compact");
      await d
        .getByRole("combobox", { name: "Card corners", exact: true })
        .selectOption("square");
      await d.getByRole("button", { name: "Save appearance" }).click();
      await expect(d.getByRole("status")).toContainText("saved");
      await d.getByRole("button", { name: "Done", exact: true }).click();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "The test homelab", exact: true }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    });
    let backup;
    await check("export versioned configuration", async () => {
      const d = await settings("Backup");
      const download = page.waitForEvent("download");
      await d.getByRole("button", { name: "Export configuration" }).click();
      const file = await download;
      await file.saveAs(
        new URL("browser-export.json", output).pathname.replace(
          /^\/([A-Za-z]:)/,
          "$1",
        ),
      );
      backup = await api("/export");
      assert.equal(backup.version, 1);
      assert.equal(backup.apps.length, 2);
      await d.getByRole("button", { name: "Done", exact: true }).click();
    });
    await check(
      "import preview, duplicate detection and confirmed replace",
      async () => {
        const d = await settings("Backup");
        await d
          .locator("input[type=file]")
          .last()
          .setInputFiles({
            name: "backup.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(backup)),
          });
        await expect(
          d.getByText("Import preview", { exact: true }),
        ).toBeVisible();
        await expect(d.getByText(/2 duplicate URLs/)).toBeVisible();
        await d
          .getByRole("combobox", { name: "Import mode", exact: true })
          .selectOption("replace");
        await expect(
          d.getByRole("button", { name: "Apply import" }),
        ).toBeDisabled();
        await d
          .getByLabel("I understand my current configuration will be replaced.")
          .check();
        await d.getByRole("button", { name: "Apply import" }).click();
        await expect(d.getByRole("status")).toContainText("Imported");
        await d.getByRole("button", { name: "Done", exact: true }).click();
        assert.equal((await api("/apps")).length, 2);
      },
    );
    await check("mobile layout and dialog fit", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: new URL("mobile.png", output).pathname.replace(
          /^\/([A-Za-z]:)/,
          "$1",
        ),
        fullPage: true,
        animations: "disabled",
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
      await page
        .getByRole("button", { name: "Add application", exact: true })
        .click();
      const d = page.getByRole("dialog");
      await expect(d).toBeVisible();
      const box = await d.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 390);
      await d.getByRole("button", { name: "Close dialog" }).click();
      await page.setViewportSize({ width: 1920, height: 1080 });
    });
    await page.screenshot({
      path: new URL("desktop-dark.png", output).pathname.replace(
        /^\/([A-Za-z]:)/,
        "$1",
      ),
      fullPage: true,
      animations: "disabled",
    });
  }
  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log(`${checks} browser workflows passed.`);
  await writeFile(
    new URL(
      process.argv.includes("--persistence")
        ? "persistence.json"
        : "browser.json",
      output,
    ),
    JSON.stringify({ checks, errors, passed: true }, null, 2),
  );
} catch (e) {
  await page
    .screenshot({
      path: new URL("failure.png", output).pathname.replace(
        /^\/([A-Za-z]:)/,
        "$1",
      ),
      fullPage: true,
    })
    .catch(() => {});
  throw e;
} finally {
  await browser.close();
}
