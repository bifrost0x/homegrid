import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const base = process.env.HOMEGRID_TEST_URL || "http://localhost:8096";
const original = "HomeGrid-browser-test-2026!";
const replacement = "HomeGrid-refined-password-2026!";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}
async function login(p, password = original) {
  await p.goto(base);
  await p.getByLabel("Username", { exact: true }).fill("testadmin");
  await p.getByLabel("Password", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(p.getByRole("button", { name: "Open settings" })).toBeVisible();
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
async function account() {
  await page.getByRole("button", { name: "Open settings" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("tab", { name: "Account", exact: true }).click();
  return d;
}
try {
  await login(page);
  await check("focused launching and explicit organization mode", async () => {
    const organize = page.getByRole("button", {
      name: "Organize",
      exact: true,
    });
    await expect(organize).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Drag category / }),
    ).toHaveCount(0);
    await organize.click();
    await expect(
      page.getByRole("button", { name: "Done organizing", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Drag category / }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Done organizing", exact: true })
      .click();
  });
  const apps = await api("/apps");
  assert.ok(
    apps.length >= 2,
    "run browser.mjs or baseline fixture setup first",
  );
  const first = apps[0];
  if (first.favorite) {
    await api("/apps/" + first.id, "PATCH", { ...first, favorite: false });
    await page.reload();
  }
  await check(
    "favorite toggle, quick launch and reload persistence",
    async () => {
      await page
        .getByRole("button", {
          name: `Add ${first.name} to favorites`,
          exact: true,
        })
        .click();
      const favorites = page.getByRole("region", {
        name: "Favorites",
        exact: true,
      });
      await expect(favorites).toBeVisible();
      await expect(
        favorites.getByRole("link", { name: new RegExp(first.name) }),
      ).toBeVisible();
      await page.reload();
      await expect(
        favorites.getByRole("link", { name: new RegExp(first.name) }),
      ).toBeVisible();
      assert.equal(
        (await api("/apps")).find((a) => a.id === first.id).favorite,
        true,
      );
    },
  );
  await check(
    "editing preserves the favorite and backups include it",
    async () => {
      await page
        .getByRole("button", {
          name: `More actions for ${first.name}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("menuitem", { name: `Edit ${first.name}`, exact: true })
        .click();
      const d = page.getByRole("dialog");
      await d.getByRole("button", { name: "Save changes" }).click();
      await expect(d).not.toBeVisible();
      const backup = await api("/export");
      assert.equal(backup.apps.find((a) => a.id === first.id).favorite, true);
    },
  );
  await check("search matches independent words across fields", async () => {
    await page.keyboard.press("Control+k");
    const search = page.getByRole("combobox", { name: "Search applications" });
    await search.fill(
      first.name.split(" ")[0] + " " + (first.description.split(" ")[0] || ""),
    );
    await expect(
      page.getByRole("option").filter({ hasText: first.name }),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
  });
  await check(
    "favorites can be removed without deleting an application",
    async () => {
      await page
        .getByRole("button", {
          name: `Remove ${first.name} from favorites`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("region", { name: "Favorites", exact: true }),
      ).toHaveCount(0);
      assert.equal((await api("/apps")).length, apps.length);
    },
  );
  await check(
    "settings tabs expose focused sections with keyboard navigation",
    async () => {
      await page.getByRole("button", { name: "Open settings" }).click();
      const d = page.getByRole("dialog");
      const appearance = d.getByRole("tab", {
        name: "Appearance",
        exact: true,
      });
      await expect(appearance).toHaveAttribute("aria-selected", "true");
      await appearance.focus();
      await page.keyboard.press("End");
      await expect(
        d.getByRole("tab", { name: "Account", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        d.getByLabel("Current password", { exact: true }),
      ).toBeVisible();
      await expect(
        d.getByRole("button", { name: "Save appearance" }),
      ).toHaveCount(0);
      await d.getByRole("button", { name: "Done", exact: true }).click();
    },
  );
  await check(
    "appearance preview reflects local drafts without saving",
    async () => {
      const saved = await api("/settings");
      await page.getByRole("button", { name: "Open settings" }).click();
      const dialog = page.getByRole("dialog");
      const preview = dialog.getByRole("region", {
        name: "Appearance preview",
        exact: true,
      });
      await expect(preview).toBeVisible();
      await dialog.getByLabel("Dashboard title").fill("A local preview");
      await dialog
        .getByRole("combobox", { name: "Theme", exact: true })
        .selectOption(saved.theme === "dark" ? "light" : "dark");
      await dialog
        .getByRole("button", { name: "Use blue accent", exact: true })
        .click();
      await expect(
        preview.getByText("A local preview", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Use blue accent", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      assert.deepEqual(await api("/settings"), saved);
      await dialog
        .getByRole("button", { name: "Discard and close", exact: true })
        .click();
      assert.deepEqual(await api("/settings"), saved);
    },
  );
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await login(otherPage);
  await check("password validation retains the current session", async () => {
    const d = await account();
    await d.getByLabel("Current password", { exact: true }).fill("wrong");
    await d.getByLabel("New password", { exact: true }).fill(replacement);
    await d
      .getByLabel("Confirm new password", { exact: true })
      .fill(replacement + "mismatch");
    await d
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(d.getByRole("alert")).toBeVisible();
    await d
      .getByLabel("Confirm new password", { exact: true })
      .fill(replacement);
    await d
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(d.getByRole("alert")).toContainText(
      /current password|incorrect/i,
    );
    assert.equal((await context.request.get(base + "/api/apps")).status(), 200);
  });
  await check(
    "changing password rotates this session and invalidates other sessions",
    async () => {
      const d = page.getByRole("dialog");
      await d.getByLabel("Current password", { exact: true }).fill(original);
      await d
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await expect(d.getByRole("status")).toContainText(
        /password.*(changed|updated)/i,
      );
      assert.equal(
        (await context.request.get(base + "/api/apps")).status(),
        200,
      );
      assert.equal((await other.request.get(base + "/api/apps")).status(), 401);
      await d.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.getByLabel("Username", { exact: true }).fill("testadmin");
      await page.getByLabel("Password", { exact: true }).fill(original);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(
        /Invalid username or password/i,
      );
      await page.getByLabel("Password", { exact: true }).fill(replacement);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Open settings" }),
      ).toBeVisible();
    },
  );
  await other.close();
  // Restore disposable fixture credentials for the common persistence/security suites.
  const d = await account();
  await d.getByLabel("Current password", { exact: true }).fill(replacement);
  await d.getByLabel("New password", { exact: true }).fill(original);
  await d.getByLabel("Confirm new password", { exact: true }).fill(original);
  await d.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(d.getByRole("status")).toContainText(
    /password.*(changed|updated)/i,
  );
  await d.getByRole("button", { name: "Done", exact: true }).click();
  await check(
    "mobile controls and settings remain within the viewport",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const d = await account();
      const box = await d.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 390);
      await d.getByRole("button", { name: "Done", exact: true }).click();
    },
  );
  assert.deepEqual(errors, []);
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../test-results/refinement.json", import.meta.url),
    JSON.stringify({ checks, passed: true, errors }, null, 2),
  );
  console.log(`${checks} refinement workflows passed.`);
} catch (e) {
  await page
    .screenshot({
      path: "test-results/refinement-failure.png",
      fullPage: true,
      animations: "disabled",
    })
    .catch(() => {});
  throw e;
} finally {
  await browser.close();
}
