import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const base = process.env.HOMEGRID_TEST_URL || "http://localhost:8096";
assert.equal(
  new URL(base).port,
  "8096",
  "Use the disposable verification installation",
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1100 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let settings,
  originalCategories,
  groups = [],
  created = [];
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
      return response.status === 204 ? null : response.json();
    },
    { path, method, data },
  );
}
async function organize() {
  const button = page.getByRole("button", { name: "Organize", exact: true });
  if (await button.count()) await button.click();
}
async function reload() {
  await page.reload();
  await expect(page.locator(".dashboard")).toBeVisible();
  await organize();
}
async function drag(app, target, fraction = 0.5, verticalFraction = 0.5) {
  const handle = page.getByRole("button", {
    name: "Drag " + app.name,
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox(),
    to = await target.boundingBox();
  assert.ok(from && to);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 12,
    from.y + from.height / 2,
    { steps: 4 },
  );
  await page.mouse.move(
    to.x + to.width * fraction,
    to.y + to.height * verticalFraction,
    {
      steps: 25,
    },
  );
  await page.mouse.up();
}
async function expectCategory(id, categoryId) {
  await expect
    .poll(
      async () =>
        (await api("/apps")).find((app) => app.id === id)?.category_id,
    )
    .toBe(categoryId);
}
async function undo() {
  const records = await api("/undo");
  assert.ok(records[0]?.token);
  await api("/undo", "POST", { token: records[0].token });
  await reload();
}
try {
  await page.goto(base);
  await page.getByLabel("Username", { exact: true }).fill("testadmin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("HomeGrid-browser-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".dashboard")).toBeVisible();
  settings = await api("/settings");
  originalCategories = await api("/categories");
  for (const name of ["Move source", "Move destination", "Move collapsed"])
    groups.push(await api("/categories", "POST", { name }));
  groups[2] = await api("/categories/" + groups[2].id, "PATCH", {
    ...groups[2],
    collapsed: true,
  });
  await api("/categories/reorder", "PUT", {
    ids: [...groups, ...originalCategories].map((group) => group.id),
  });
  await api("/settings", "PATCH", {
    ...settings,
    group_columns: "2",
    columns: "2",
    content_width: "wide",
  });
  for (const [name, category] of [
    ["Move Atlas", groups[0]],
    ["Move Beacon", groups[1]],
    ["Move Cedar", groups[1]],
  ]) {
    created.push(
      await api("/apps", "POST", {
        name,
        url: "https://move.example.test",
        category_id: category.id,
        icon: "builtin:server",
        open_in_new_tab: true,
      }),
    );
  }
  await reload();
  const [atlas, beacon, cedar] = created;
  let popup = false;
  context.on("page", () => {
    popup = true;
  });
  const region = (name) => page.getByRole("region", { name, exact: true });
  const card = (name) =>
    page
      .getByTestId("application-card")
      .filter({ has: page.getByText(name, { exact: true }) });
  await drag(atlas, card(beacon.name), 0.25);
  await expectCategory(atlas.id, groups[1].id);
  assert.deepEqual(
    (await api("/apps"))
      .filter((app) => app.category_id === groups[1].id)
      .map((app) => app.name),
    [atlas.name, beacon.name, cedar.name],
  );
  await reload();
  await expect(withinRegion(groups[1].name, atlas.name)).toBeVisible();
  await undo();
  await expectCategory(atlas.id, groups[0].id);
  console.log(
    "PASS pointer cross-category placement, reload persistence and atomic undo",
  );
  await drag(atlas, card(cedar.name), 0.95);
  await expectCategory(atlas.id, groups[1].id);
  assert.deepEqual(
    (await api("/apps"))
      .filter((app) => app.category_id === groups[1].id)
      .map((app) => app.name),
    [beacon.name, cedar.name, atlas.name],
  );
  await undo();
  await expectCategory(atlas.id, groups[0].id);
  console.log("PASS pointer drop after a card and atomic undo");
  const wideSettings = await api("/settings");
  await page.setViewportSize({ width: 1320, height: 1100 });
  await api("/settings", "PATCH", {
    ...wideSettings,
    columns: "3",
    card_style: "cards",
  });
  await reload();
  const narrowTarget = await card(beacon.name).boundingBox();
  assert.ok(
    narrowTarget && narrowTarget.width >= 190 && narrowTarget.width <= 210,
    "Exercise narrow cards near the minimum grid track size",
  );
  for (const [fraction, expected] of [
    [0.45, [atlas.name, beacon.name, cedar.name]],
    [0.55, [beacon.name, atlas.name, cedar.name]],
  ]) {
    await drag(atlas, card(beacon.name), fraction);
    await expectCategory(atlas.id, groups[1].id);
    assert.deepEqual(
      (await api("/apps"))
        .filter((app) => app.category_id === groups[1].id)
        .map((app) => app.name),
      expected,
    );
    await undo();
    await expectCategory(atlas.id, groups[0].id);
  }
  console.log(
    "PASS narrow-card drops at 45% and 55% follow the pointer midpoint and undo",
  );
  await api("/settings", "PATCH", { ...wideSettings, card_style: "list" });
  await reload();
  for (const [x, y, expected] of [
    [0.95, 0.45, [atlas.name, beacon.name, cedar.name]],
    [0.05, 0.55, [beacon.name, atlas.name, cedar.name]],
  ]) {
    await drag(atlas, card(beacon.name), x, y);
    await expectCategory(atlas.id, groups[1].id);
    assert.deepEqual(
      (await api("/apps"))
        .filter((app) => app.category_id === groups[1].id)
        .map((app) => app.name),
      expected,
    );
    await undo();
  }
  console.log(
    "PASS single-column list drops follow the vertical pointer midpoint and undo",
  );
  await api("/settings", "PATCH", wideSettings);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await reload();
  await drag(atlas, region(groups[2].name).locator(".category-heading"));
  await expectCategory(atlas.id, groups[2].id);
  await undo();
  await expectCategory(atlas.id, groups[0].id);
  console.log("PASS pointer drop into collapsed empty category and undo");
  const keyboardHandle = page.getByRole("button", {
    name: "Drag " + atlas.name,
    exact: true,
  });
  await keyboardHandle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".app-drag-preview")).toBeVisible();
  // Allow the keyboard sensor activation and initial layout measurement to finish.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.keyboard.press("ArrowDown");
  await expect(region(groups[2].name)).toHaveClass(/drop-active/);
  await page.keyboard.press("Space");
  await expectCategory(atlas.id, groups[2].id);
  await undo();
  await expectCategory(atlas.id, groups[0].id);
  console.log(
    "PASS keyboard drag into collapsed empty category and atomic undo",
  );
  await page
    .getByRole("combobox", { name: "Move " + atlas.name + " to category" })
    .selectOption(String(groups[1].id));
  await expectCategory(atlas.id, groups[1].id);
  assert.deepEqual(
    (await api("/apps"))
      .filter((app) => app.category_id === groups[1].id)
      .map((app) => app.name),
    [beacon.name, cedar.name, atlas.name],
  );
  await undo();
  console.log("PASS accessible category selection appends and can be undone");
  const mobile = await browser.newContext({
    storageState: await context.storageState(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  try {
    const touchPage = await mobile.newPage();
    touchPage.on("pageerror", (error) => errors.push(error.message));
    await touchPage.goto(base);
    await expect(touchPage.locator(".dashboard")).toBeVisible();
    assert.ok(await touchPage.evaluate(() => navigator.maxTouchPoints > 0));
    await touchPage
      .getByRole("button", { name: "Organize", exact: true })
      .tap();
    const selector = touchPage.getByRole("combobox", {
      name: "Move " + atlas.name + " to category",
    });
    await selector.tap();
    await selector.selectOption(String(groups[2].id));
    await expectCategory(atlas.id, groups[2].id);
    await expect(
      touchPage
        .getByRole("region", { name: groups[2].name, exact: true })
        .locator(".category-toggle"),
    ).toBeFocused();
    assert.equal(touchPage.url(), base + "/");
    assert.equal(
      mobile.pages().length,
      1,
      "Touch move must never launch the service",
    );
    await undo();
    await expectCategory(atlas.id, groups[0].id);
    console.log(
      "PASS mobile touch category selection into collapsed group, focus and undo",
    );
  } finally {
    await mobile.close();
  }
  await drag(atlas, region(groups[0].name).locator(".category-heading"));
  await expectCategory(atlas.id, groups[0].id);
  assert.equal(popup, false, "Organizing must never open a service");
  assert.deepEqual(errors, []);
  console.log("PASS no accidental navigation or browser errors");
  function withinRegion(groupName, appName) {
    return region(groupName).getByText(appName, { exact: true });
  }
} finally {
  for (const app of created)
    await api("/apps/" + app.id, "DELETE").catch(() => {});
  for (const group of groups)
    await api("/categories/" + group.id, "DELETE").catch(() => {});
  if (originalCategories)
    await api("/categories/reorder", "PUT", {
      ids: originalCategories.map((group) => group.id),
    }).catch(() => {});
  if (settings) await api("/settings", "PATCH", settings).catch(() => {});
  await browser.close();
}
