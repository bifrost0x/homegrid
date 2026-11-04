import assert from "node:assert/strict";

const base = process.env.HOMEGRID_TEST_URL || "http://localhost:8096";
const cookies = new Map();
let csrf = "";
let checks = 0;
async function request(method, path, data, expected, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      "X-CSRF-Token": csrf,
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    redirect: "manual",
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    const i = pair.indexOf("=");
    cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${await response.clone().text()}`,
  );
  checks++;
  return response;
}
await request("GET", "/api/health", undefined, 200);
for (const path of [
  "/api/apps",
  "/api/categories",
  "/api/settings",
  "/api/export",
])
  await request("GET", path, undefined, 401);
let session = await (
  await request("GET", "/api/auth/session", undefined, 200)
).json();
csrf = session.csrf_token;
const credentials = {
  username: "testadmin",
  password: "HomeGrid-browser-test-2026!",
};
await request("POST", "/api/auth/login", credentials, 403, {
  "X-CSRF-Token": "",
});
await request("POST", "/api/auth/login", credentials, 403, {
  Origin: "https://untrusted.example",
});
const login = await request("POST", "/api/auth/login", credentials, 200);
assert.ok(
  login.headers
    .getSetCookie()
    .some((c) => /httponly/i.test(c) && /samesite=(strict|lax)/i.test(c)),
  "session cookie must be HttpOnly and SameSite",
);
session = await login.json();
csrf = session.csrf_token;
const before = await (await request("GET", "/api/apps", undefined, 200)).json();
for (const url of [
  "javascript:alert(1)",
  "file:///etc/passwd",
  "data:text/html,evil",
  "https://user:secret@example.com",
]) {
  await request(
    "POST",
    "/api/apps",
    { name: "Unsafe", url, category_id: 1 },
    400,
  );
}
await request(
  "POST",
  "/api/apps",
  {
    name: "Bad icon",
    url: "https://example.com",
    category_id: 1,
    icon: "https://untrusted.example/icon.svg",
  },
  400,
);
await request("POST", "/api/categories", { name: "CSRF test" }, 403, {
  "X-CSRF-Token": "wrong",
});
await request("POST", "/api/categories", { name: "Origin test" }, 403, {
  Origin: "https://untrusted.example",
});
await request(
  "POST",
  "/api/categories",
  { name: "Invalid", unknown: true },
  400,
);
await request("PUT", "/api/apps/reorder", { ids: [] }, 400);
if (before.length > 1)
  await request(
    "PUT",
    "/api/apps/reorder",
    { ids: Array(before.length).fill(before[0].id) },
    400,
  );
await request(
  "POST",
  "/api/import/apply",
  {
    data: { apps: [{ name: "Unsafe", url: "javascript:x" }] },
    mode: "replace",
    confirm: true,
  },
  400,
);
await request(
  "POST",
  "/api/import/apply",
  { data: { apps: [] }, mode: "replace", confirm: false },
  400,
);
const after = await (await request("GET", "/api/apps", undefined, 200)).json();
assert.deepEqual(after, before, "invalid mutations must preserve all apps");
const backup = await (
  await request("GET", "/api/export", undefined, 200)
).json();
assert.equal(backup.version, 1);
assert.ok(
  !JSON.stringify(backup).match(
    /password_hash|token_hash|csrf_token|HomeGrid-browser-test/,
  ),
);
const form = new FormData();
form.set(
  "file",
  new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], {
    type: "image/svg+xml",
  }),
  "icon.png",
);
const upload = await fetch(base + "/api/uploads", {
  method: "POST",
  body: form,
  headers: {
    Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    "X-CSRF-Token": csrf,
  },
});
assert.equal(upload.status, 400, "executable image content rejected");
checks++;
const html = await request("GET", "/", undefined, 200);
assert.equal(html.headers.get("x-content-type-options"), "nosniff");
assert.ok(html.headers.get("content-security-policy")?.includes("'self'"));
await request("POST", "/api/auth/logout", undefined, 204);
await request("GET", "/api/apps", undefined, 401);
console.log(
  `${checks} production HTTP checks passed; cookies, authorization, CSRF, validation, atomicity, headers and upload rejection verified.`,
);
