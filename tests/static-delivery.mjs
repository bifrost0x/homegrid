import http from "node:http";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.HOMEGRID_TEST_URL || "http://localhost:8096");
function request(path, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const r = http.request(
      new URL(path, base),
      { method, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    r.on("error", reject);
    r.end();
  });
}
const html = await request("/", { "Accept-Encoding": "gzip" });
assert.equal(html.status, 200);
assert.equal(
  html.headers["content-encoding"],
  undefined,
  "HTML is not compressed",
);
const text = html.body.toString();
const paths = [
  ...new Set(
    [...text.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map(
      (match) => match[1],
    ),
  ),
];
assert.ok(
  paths.some((p) => p.endsWith(".js")) && paths.some((p) => p.endsWith(".css")),
  "embedded scripts and styles present",
);
const results = [];
for (const path of paths) {
  const plain = await request(path, { "Accept-Encoding": "identity" });
  const gzip = await request(path, { "Accept-Encoding": "gzip" });
  assert.equal(plain.status, 200);
  assert.equal(gzip.status, 200);
  assert.equal(gzip.headers["content-encoding"], "gzip", path);
  assert.deepEqual(gunzipSync(gzip.body), plain.body);
  assert.ok(gzip.body.length < plain.body.length);
  assert.ok(
    String(gzip.headers.vary).toLowerCase().includes("accept-encoding"),
  );
  assert.equal(gzip.headers["x-content-type-options"], "nosniff");
  assert.match(
    gzip.headers["content-type"],
    path.endsWith(".css") ? /text\/css/ : /javascript/,
  );
  const declined = await request(path, {
    "Accept-Encoding": "gzip;q=0, *;q=1",
  });
  assert.equal(declined.headers["content-encoding"], undefined);
  assert.deepEqual(declined.body, plain.body);
  const head = await request(path, { "Accept-Encoding": "gzip" }, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers["content-encoding"], "gzip");
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers["content-length"]), gzip.body.length);
  const range = await request(path, {
    "Accept-Encoding": "gzip",
    Range: "bytes=0-15",
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers["content-encoding"], undefined);
  assert.deepEqual(range.body, plain.body.subarray(0, 16));
  results.push({
    path,
    identityBytes: plain.body.length,
    gzipBytes: gzip.body.length,
    reductionPercent: Math.round(
      100 * (1 - gzip.body.length / plain.body.length),
    ),
  });
}
for (const path of [
  "/api/health",
  "/api/auth/session",
  "/api/apps",
  "/api/export",
]) {
  const response = await request(path, { "Accept-Encoding": "gzip" });
  assert.equal(
    response.headers["content-encoding"],
    undefined,
    `no API compression ${path}`,
  );
}
await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../test-results/static-delivery.json", import.meta.url),
  JSON.stringify({ passed: true, assets: results }, null, 2),
);
console.log(JSON.stringify({ passed: true, assets: results }, null, 2));
