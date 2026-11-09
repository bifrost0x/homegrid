import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const base = new URL(process.env.HOMEGRID_TEST_URL || "http://localhost:8096");
if (!["localhost", "127.0.0.1"].includes(base.hostname) || base.port !== "8096")
  throw new Error("Use a fresh disposable installation on local port 8096.");
const browser = await chromium.launch();
const password = randomBytes(24).toString("hex");
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base.href);
  // Wait until the app has stored its own pre-authentication cookie, so the
  // session read below receives the same CSRF token instead of racing it.
  await expect(
    page.getByRole("heading", { name: "A home for your homelab." }),
  ).toBeVisible();
  const session = await context.request.get(
    new URL("/api/auth/session", base).href,
  );
  const state = await session.json();
  if (!state.setup_required)
    throw new Error("This test requires a fresh disposable data directory.");
  const setup = await context.request.post(
    new URL("/api/auth/setup", base).href,
    {
      headers: { Origin: base.origin, "X-CSRF-Token": state.csrf_token },
      data: { username: "a", password },
    },
  );
  expect(setup.status(), await setup.text()).toBe(201);
  // A fresh browser context verifies an actual sign-in, independent of setup's session.
  const loginContext = await browser.newContext();
  const login = await loginContext.newPage();
  await login.goto(base.href);
  await login.getByLabel("Username", { exact: true }).pressSequentially("a");
  await login
    .getByLabel("Password", { exact: true })
    .pressSequentially(password);
  const response = login.waitForResponse(
    (r) => r.url() === new URL("/api/auth/login", base).href,
    { timeout: 5000 },
  );
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(
    login.getByRole("button", {
      name: "Add your first application",
      exact: true,
    }),
  ).toBeVisible();
  console.log(
    "PASS: API-created one-character username can sign in through the browser.",
  );
} finally {
  await browser.close();
}
