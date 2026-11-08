import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";

const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const base = "https://127.0.0.1:8443";
const browser = await chromium.launch();
// Only the loopback TLS fixture uses its generated self-signed certificate.
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const password = randomBytes(24).toString("hex");
try {
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "A home for your homelab." }),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("proxy-owner");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create your HomeGrid" }).click();
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Account menu for / }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome home." }),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("proxy-owner");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
  const result = await page.evaluate(async () => {
    const session = await (await fetch("/api/auth/session")).json();
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf_token,
      },
      body: JSON.stringify({ name: "TLS browser category" }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  const session = await (
    await context.request.get(base + "/api/auth/session")
  ).json();
  for (const [headers, code] of [
    [
      {
        Origin: "https://foreign.example",
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": session.csrf_token,
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "foreign.example",
      },
      "origin",
    ],
    [
      {
        Origin: base,
        "Sec-Fetch-Site": "cross-site",
        "X-CSRF-Token": session.csrf_token,
      },
      "origin",
    ],
    [
      {
        Origin: base,
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": "invalid",
      },
      "csrf",
    ],
  ]) {
    const response = await context.request.post(base + "/api/categories", {
      headers,
      data: { name: "Must not be created" },
    });
    assert.equal(response.status(), 403);
    assert.equal((await response.json()).error.code, code);
  }
  const categories = await (
    await context.request.get(base + "/api/categories")
  ).json();
  assert.equal(
    categories.filter((category) => category.name === "Must not be created")
      .length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS HTTPS proxy browser setup, logout, sign-in and protected writes without proxy trust configuration",
  );
  console.log(
    "PASS foreign origins, spoofed forwarding headers, cross-site requests and invalid CSRF remain blocked",
  );
} finally {
  await browser.close();
}
