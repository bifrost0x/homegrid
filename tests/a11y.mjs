import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const base = process.env.HOMEGRID_TEST_URL || "http://localhost:8096";
const results = [];
async function scan(name) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  results.push({ name, violations: result.violations });
  console.log(`${name}: ${result.violations.length} violations`);
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
let saved;
try {
  await page.goto(base);
  await scan("Sign-in");
  await page.getByLabel("Username", { exact: true }).fill("testadmin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("HomeGrid-browser-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
  saved = await api("/settings");
  for (const theme of ["light", "dark"]) {
    await api("/settings", "PATCH", { ...saved, theme });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Open settings" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await scan(`Dashboard ${theme}`);
    await page.getByRole("button", { name: "Organize", exact: true }).click();
    await scan(`Organize ${theme}`);
    await page
      .getByRole("button", { name: "Done organizing", exact: true })
      .click();
    await page.getByRole("button", { name: "Open settings" }).click();
    const d = page.getByRole("dialog");
    for (const tab of ["Appearance", "Backup", "Account"]) {
      await d.getByRole("tab", { name: tab, exact: true }).click();
      await scan(`${tab} ${theme}`);
    }
    await d.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "Add application", exact: true })
      .click();
    await scan(`Application form ${theme}`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Choose a service", exact: true })
      .click();
    await scan(`Service templates ${theme}`);
    await page
      .getByRole("dialog")
      .getByLabel("Search service templates", { exact: true })
      .fill("jellyfin");
    await page
      .getByRole("button", { name: "Use Jellyfin template", exact: true })
      .click();
    await scan(`Configured service ${theme}`);
    await page.getByRole("button", { name: "Close dialog" }).click();
    const sample = (await api("/apps"))[0];
    assert.ok(
      sample,
      "run browser.mjs to create the disposable application fixtures first",
    );
    await page
      .getByRole("button", { name: `Duplicate ${sample.name}`, exact: true })
      .click();
    await scan(`Duplicate application ${theme}`);
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.keyboard.press("Control+k");
    await scan(`Command palette ${theme}`);
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await scan("Mobile dashboard");
  await page.getByRole("button", { name: "Open settings" }).click();
  await scan("Mobile appearance");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  await scan("Mobile application form");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Choose a service", exact: true })
    .click();
  await scan("Mobile service templates");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../test-results/accessibility.json", import.meta.url),
    JSON.stringify(results, null, 2),
  );
  const violations = results.flatMap((r) =>
    r.violations.map((v) => ({
      surface: r.name,
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  );
  if (violations.length) console.log(JSON.stringify(violations, null, 2));
  assert.equal(
    violations.length,
    0,
    "automated WCAG checks must pass; see test-results/accessibility.json",
  );
  console.log(
    `${results.length} accessibility surfaces passed (automated checks only).`,
  );
} finally {
  if (saved) await api("/settings", "PATCH", saved).catch(() => {});
  await browser.close();
}
