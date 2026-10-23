/** Tests the built server without spending Qloo/Gemini quota or requiring keys. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const external = process.env.PASSPORT_SMOKE_URL;
const base = new URL(external || "http://127.0.0.1:4100");
assert.ok(["http:", "https:"].includes(base.protocol));
assert.ok(!base.username && !base.password && !base.search && !base.hash);
assert.equal(base.pathname, "/", "Use the application's origin, without a path");
let child;
let exited;
try {
  if (!external) {
    child = spawn(process.execPath, ["--use-env-proxy", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1"], {
      env: { ...process.env, NODE_ENV: "production", PORT: base.port, APP_ORIGIN: base.origin },
      // No environment, request bodies or raw server errors enter CI output.
      stdio: "ignore",
    });
    exited = once(child, "exit");
    child.on("error", () => {});
  }
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) break;
    try {
      const response = await fetch(new URL("/api/health", base), { signal: AbortSignal.timeout(2000), redirect: "error" });
      if (response.status === 200) {
        assert.deepEqual(await response.json(), { status: "ok" });
        assert.match(response.headers.get("cache-control") || "", /no-store/);
        ready = true;
        break;
      }
    } catch { /* Wait for startup; a final failure stays nonzero. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Production health check failed");
  const root = await fetch(base, { signal: AbortSignal.timeout(10000), redirect: "error" });
  assert.equal(root.status, 200);
  assert.equal(root.headers.get("x-content-type-options"), "nosniff");
  assert.equal(root.headers.get("x-frame-options"), "DENY");
  assert.equal(root.headers.get("referrer-policy"), "no-referrer");
  assert.match(root.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.match(await root.text(), /TastePassport/);
  const blocked = await fetch(new URL("/api/agent/interpret", base), {
    method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" },
    body: "{}", signal: AbortSignal.timeout(10000), redirect: "error",
  });
  assert.equal(blocked.status, 403);
  // Invalid same-origin input must reach validation, without invoking a provider.
  const invalid = await fetch(new URL("/api/agent/interpret", base), {
    method: "POST", headers: { Origin: base.origin, "Content-Type": "application/json" },
    body: "{}", signal: AbortSignal.timeout(10000), redirect: "error",
  });
  assert.equal(invalid.status, 400);
  const missing = await fetch(new URL("/deployment-smoke-missing-page", base), { signal: AbortSignal.timeout(10000), redirect: "error" });
  assert.equal(missing.status, 404);
  console.log("Production smoke PASS: health, rendered home, security headers, origin checks, input validation and 404; no provider calls.");
} catch {
  console.error("Production smoke FAILED: app startup, readiness or page response did not match expectations.");
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && !child.killed) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
}
