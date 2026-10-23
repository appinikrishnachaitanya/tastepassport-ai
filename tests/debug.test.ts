import test from "node:test";
import assert from "node:assert/strict";
import { debugEvent, debugRequest } from "../src/agent/debug.ts";
import { paced, fetchWithRetry } from "../src/qloo/transport.ts";

test("backend traces isolate concurrent requests and redact arbitrary metadata, bodies and errors", async () => {
  const previous = process.env.AGENT_DEBUG;
  const original = console.info;
  const originalError = console.error;
  const lines: string[] = [];
  process.env.AGENT_DEBUG = "1";
  console.info = console.error = (line: string) => {
    lines.push(line);
  };
  try {
    await Promise.all([
      debugRequest("passport", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        debugEvent("passport.completed", { count: 7 });
        return Response.json({ private: "do-not-log-user" });
      }),
      debugRequest("agent.resolve", async () => {
        debugEvent("resolution.completed", { count: 3 });
        return Response.json({ token: "do-not-log-token" });
      }),
    ]);
    await assert.rejects(
      debugRequest("agent.turn", async () => {
        throw Error("do-not-log-error-secret");
      }),
    );
    debugEvent("qloo.result", {
      city: "do-not-log-city",
      section: "do-not-log-section",
      tool: "do-not-log-key",
      trace: "do-not-log-token",
      count: -1,
      sections: ["Eat", "do-not-log-person"],
    });
    const logs = lines.map((line) => JSON.parse(line));
    const starts = logs.filter((log) => log.event === "api.started");
    assert.equal(new Set(starts.map((log) => log.requestTrace)).size, 3);
    const trace = (route: string) =>
      starts.find((log) => log.route === route).requestTrace;
    assert.equal(
      logs.find((log) => log.event === "passport.completed").requestTrace,
      trace("passport"),
    );
    assert.equal(
      logs.find((log) => log.event === "resolution.completed").requestTrace,
      trace("agent.resolve"),
    );
    assert.equal(
      logs.find((log) => log.event === "api.failed").requestTrace,
      trace("agent.turn"),
    );
    assert.ok(!lines.join(" ").includes("do-not-log"));
    assert.deepEqual(logs.at(-1).sections, ["Eat"]);
    const before = lines.length;
    process.env.AGENT_DEBUG = "0";
    debugEvent("qloo.cache_hit");
    assert.equal(lines.length, before);
  } finally {
    console.info = original;
    console.error = originalError;
    if (previous === undefined) delete process.env.AGENT_DEBUG;
    else process.env.AGENT_DEBUG = previous;
  }
});

test("debug logs distinguish cached work and bounded 429 retries without exposing cache keys", async () => {
  const previous = process.env.AGENT_DEBUG;
  const original = console.info;
  const originalError = console.error;
  const lines: string[] = [];
  process.env.AGENT_DEBUG = "1";
  console.info = console.error = (line: string) => {
    lines.push(line);
  };
  try {
    const key = "do-not-log-cache-key-" + crypto.randomUUID();
    let calls = 0;
    await paced(key, async () => {
      calls++;
      return 5;
    });
    assert.equal(
      await paced(key, async () => {
        calls++;
        return 9;
      }),
      5,
    );
    assert.equal(calls, 1);
    assert.ok(
      lines
        .map((line) => JSON.parse(line))
        .some((log) => log.event === "qloo.cache_hit"),
    );
    let requests = 0;
    const response = await fetchWithRetry(
      new URL("https://example.com"),
      {},
      async () =>
        ++requests === 1
          ? new Response(null, { status: 429, headers: { "retry-after": "1" } })
          : new Response(null, { status: 200 }),
      async () => {},
    );
    assert.equal(response.status, 200);
    const retry = lines
      .map((line) => JSON.parse(line))
      .find((log) => log.event === "qloo.retry");
    assert.equal(retry.attempt, 1);
    assert.equal(retry.delayMs, 1000);
    assert.ok(!lines.join(" ").includes("do-not-log-cache-key"));
  } finally {
    console.info = original;
    console.error = originalError;
    if (previous === undefined) delete process.env.AGENT_DEBUG;
    else process.env.AGENT_DEBUG = previous;
  }
});
