import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const base = process.env.HOMEGRID_TEST_URL || "http://localhost:8096";
const created = [];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0,
  savedSettings;
async function check(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
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
async function addDialog() {
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  return page.getByRole("dialog");
}
async function save(d, name) {
  await d.getByRole("button", { name: "Add application", exact: true }).click();
  await expect(d).not.toBeVisible();
  const app = (await api("/apps")).find((a) => a.name === name);
  assert.ok(app, `saved ${name}`);
  created.push(app.id);
  return app;
}
try {
  await page.goto(base);
  await page.getByLabel("Username", { exact: true }).fill("testadmin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("HomeGrid-browser-test-2026!");
  const setup = page.getByRole("button", {
    name: "Create your HomeGrid",
    exact: true,
  });
  await (
    (await setup.isVisible())
      ? setup
      : page.getByRole("button", { name: "Sign in", exact: true })
  ).click();
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
  savedSettings = await api("/settings");
  let media, manual;
  await check(
    "searchable templates prefill editable fields without invented URLs",
    async () => {
      const d = await addDialog();
      await expect(
        d.getByRole("button", { name: "Add application", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await d
        .getByRole("button", { name: "Choose a service", exact: true })
        .click();
      await d
        .getByLabel("Search service templates", { exact: true })
        .fill("jellyfin");
      await d
        .getByRole("button", { name: "Use Jellyfin template", exact: true })
        .click();
      await expect(
        d.getByLabel("Application name", { exact: true }),
      ).toHaveValue("Jellyfin");
      await expect(
        d.getByLabel("Application URL", { exact: true }),
      ).toHaveValue("");
      await expect(
        d.getByRole("button", { name: "Add application", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        d.getByLabel("Description", { exact: false }),
      ).not.toHaveValue("");
      await d
        .getByLabel("Application name", { exact: true })
        .fill("Jellyfin Lab");
      await d
        .getByLabel("Application URL", { exact: true })
        .fill("https://jellyfin.example.test");
      await d
        .getByRole("button", { name: "Use blue icon color", exact: true })
        .click();
      media = await save(d, "Jellyfin Lab");
      assert.equal(media.icon_color, "blue");
    },
  );
  await check(
    "template changes retain the owner URL and cancel does not create an app",
    async () => {
      const count = (await api("/apps")).length;
      const d = await addDialog();
      await d
        .getByLabel("Application URL", { exact: true })
        .fill("https://private.example.test:8443");
      await d
        .getByRole("button", { name: "Choose a service", exact: true })
        .click();
      await d
        .getByLabel("Search service templates", { exact: true })
        .fill("jellyfin");
      await d
        .getByRole("button", { name: "Use Jellyfin template", exact: true })
        .click();
      await expect(
        d.getByLabel("Application URL", { exact: true }),
      ).toHaveValue("https://private.example.test:8443");
      await d.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal((await api("/apps")).length, count);
    },
  );
  await check(
    "manual URL suggestion never overwrites an edited name",
    async () => {
      const d = await addDialog();
      await d
        .getByLabel("Application URL", { exact: true })
        .fill("https://router.home.example:8443");
      await d.getByLabel("Description", { exact: false }).click();
      await expect(
        d.getByLabel("Application name", { exact: true }),
      ).not.toHaveValue("");
      await d
        .getByLabel("Application name", { exact: true })
        .fill("Router control");
      await d
        .getByLabel("Application URL", { exact: true })
        .fill("https://switch.home.example:8443");
      await d.getByLabel("Description", { exact: false }).click();
      await expect(
        d.getByLabel("Application name", { exact: true }),
      ).toHaveValue("Router control");
      await d.getByLabel("Search icons").fill("photo");
      await expect(
        d.getByRole("button", { name: "Use camera icon", exact: true }),
      ).toBeVisible();
      await d
        .getByRole("button", { name: "Use camera icon", exact: true })
        .click();
      await d
        .getByRole("button", { name: "Use cyan icon color", exact: true })
        .click();
      manual = await save(d, "Router control");
      assert.equal(manual.icon, "builtin:camera");
      assert.equal(manual.icon_color, "cyan");
    },
  );
  await check(
    "extended icons and tint survive editing a favorite",
    async () => {
      await page
        .getByRole("button", {
          name: "Add Jellyfin Lab to favorites",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Edit Jellyfin Lab", exact: true })
        .click();
      const d = page.getByRole("dialog");
      await d.getByLabel("Search icons").fill("");
      assert.ok(
        (await d.getByRole("button", { name: /^Use .+ icon$/ }).count()) >= 44,
      );
      await d
        .getByRole("button", { name: "Use violet icon color", exact: true })
        .click();
      await d
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(d).not.toBeVisible();
      await page.reload();
      media = (await api("/apps")).find((a) => a.id === media.id);
      assert.equal(media.favorite, true);
      assert.equal(media.icon_color, "violet");
    },
  );
  await check(
    "duplicate is a populated create draft and cancellation makes no writes",
    async () => {
      const before = await api("/apps");
      await page
        .getByRole("button", { name: "Duplicate Jellyfin Lab", exact: true })
        .click();
      const d = page.getByRole("dialog");
      assert.ok(
        (
          await d.getByLabel("Application name", { exact: true }).inputValue()
        ).includes("Jellyfin Lab"),
      );
      await expect(
        d.getByLabel("Application URL", { exact: true }),
      ).toHaveValue(media.url);
      await expect(
        d.getByRole("button", { name: "Use violet icon color", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await d.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.deepEqual(await api("/apps"), before);
    },
  );
  await check(
    "saving a duplicate preserves category, icon, tint, favorite and opening behavior",
    async () => {
      await page
        .getByRole("button", { name: "Duplicate Jellyfin Lab", exact: true })
        .click();
      const d = page.getByRole("dialog");
      await d
        .getByLabel("Application name", { exact: true })
        .fill("Jellyfin secondary");
      const copy = await save(d, "Jellyfin secondary");
      assert.notEqual(copy.id, media.id);
      for (const key of [
        "category_id",
        "icon",
        "icon_color",
        "favorite",
        "open_in_new_tab",
        "url",
        "description",
      ])
        assert.equal(copy[key], media[key], key);
    },
  );
  await check(
    "configuration exports include per-application icon colors",
    async () => {
      const backup = await api("/export");
      assert.equal(
        backup.apps.find((a) => a.id === media.id).icon_color,
        "violet",
      );
      assert.equal(
        backup.apps.find((a) => a.id === manual.id).icon_color,
        "cyan",
      );
    },
  );
  await check(
    "mobile organization controls fit 320px and retain touch targets",
    async () => {
      await page.setViewportSize({ width: 320, height: 844 });
      const organize = page.getByRole("button", {
        name: "Organize",
        exact: true,
      });
      if (await organize.count()) await organize.click();
      await expect(page.locator(".dashboard")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      for (const card of await page.getByTestId("application-card").all()) {
        const box = await card.boundingBox();
        for (const button of await card.locator(".card-actions button").all()) {
          const b = await button.boundingBox();
          assert.ok(b.width >= 44 && b.height >= 44, "44px touch target");
          assert.ok(
            b.x >= box.x - 1 && b.x + b.width <= box.x + box.width + 1,
            "actions fit card width",
          );
          assert.ok(
            b.y >= box.y && b.y + b.height <= box.y + box.height + 1,
            "actions fit card height",
          );
        }
      }
      await page
        .getByRole("button", { name: "Done organizing", exact: true })
        .click();
      const d = await addDialog();
      await d
        .getByRole("button", { name: "Choose a service", exact: true })
        .click();
      await expect(
        d.getByRole("button", { name: "Add application", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      const box = await d.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 320);
      await d.getByRole("button", { name: "Cancel", exact: true }).click();
    },
  );
  await check(
    "keyboard focus remains unobscured by the application action bar",
    async () => {
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const dialog = await addDialog();
        await expect(
          dialog.getByLabel("Application name", { exact: true }),
        ).toBeFocused();
        const color = dialog.getByRole("button", {
          name: "Use cyan icon color",
          exact: true,
        });
        await color.focus();
        await expect(color).toBeFocused();
        const unobscured = (locator) =>
          locator.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return element === hit || element.contains(hit);
          });
        await expect.poll(() => unobscured(color)).toBe(true);
        await page.keyboard.press("Tab");
        const opening = dialog.getByLabel("Open in a new tab", { exact: true });
        await expect(opening).toBeFocused();
        await expect.poll(() => unobscured(opening)).toBe(true);
        await expect(
          dialog.getByRole("button", { name: "Add application", exact: true }),
        ).toBeInViewport({ ratio: 1 });
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
      }
    },
  );
  assert.deepEqual(errors, []);
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../test-results/quick-add.json", import.meta.url),
    JSON.stringify({ checks, errors, passed: true }, null, 2),
  );
  console.log(`${checks} quick-add workflows passed.`);
} catch (e) {
  await page
    .screenshot({
      path: "test-results/quick-add-failure.png",
      fullPage: true,
      animations: "disabled",
    })
    .catch(() => {});
  throw e;
} finally {
  for (const id of created) await api("/apps/" + id, "DELETE").catch(() => {});
  if (savedSettings)
    await api("/settings", "PATCH", savedSettings).catch(() => {});
  await browser.close();
}
