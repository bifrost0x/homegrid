import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const base = process.env.HOMEGRID_TEST_URL || "http://localhost:8096";
let category;
async function api(path, method = "GET", data) {
  return page.evaluate(
    async ({ path, method, data }) => {
      const session = await (await fetch("/api/auth/session")).json();
      const r = await fetch("/api" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf_token,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.status === 204 ? null : r.json();
    },
    { path, method, data },
  );
}
try {
  await page.goto(base);
  await page.getByLabel("Username", { exact: true }).fill("testadmin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("HomeGrid-browser-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
  category = await api("/categories", "POST", {
    name: "Search scale fixtures",
  });
  // Test fixtures exist only in the disposable verification project.
  for (let i = 0; i < 120; i++)
    await api("/apps", "POST", {
      name: `Search fixture ${String(i).padStart(3, "0")}`,
      url: `https://fixture-${i}.example.test`,
      description: `Scale verification entry ${i}`,
      icon: "builtin:server",
      category_id: category.id,
      open_in_new_tab: true,
    });
  await page.reload();
  await expect(page.getByTestId("application-card")).toHaveCount(122);
  await page.keyboard.press("Control+k");
  const start = performance.now();
  await page.getByRole("combobox").fill("Search fixture 119");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("Search fixture 119");
  const elapsedMs = Math.round(performance.now() - start);
  assert.ok(
    elapsedMs < 2000,
    "search should remain responsive with 122 applications",
  );
  const result = {
    applications: 122,
    searchAutomationElapsedMs: elapsedMs,
    thresholdMs: 2000,
    passed: true,
  };
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../test-results/search-scale.json", import.meta.url),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (category) {
    for (const app of await api("/apps"))
      if (app.category_id === category.id)
        await api("/apps/" + app.id, "DELETE");
    await api("/categories/" + category.id, "DELETE");
  }
  await browser.close();
}
