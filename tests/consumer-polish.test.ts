import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { priceLabel } from "../src/passport/pricing.ts";
import {
  ResultMetrics,
  WhyEvidence,
} from "../app/components/intelligence-evidence.tsx";
import { normalizeEntity } from "../src/qloo/normalizer.ts";
import type { Card } from "../src/passport/model.ts";
import { debugEvent, debugRequest } from "../src/agent/debug.ts";
test("consumer prices have readable labels and never imply a currency amount", () => {
  assert.equal(priceLabel(1), "Budget-friendly");
  assert.equal(priceLabel(2), "Moderate");
  assert.equal(priceLabel(3), "Premium");
  assert.equal(priceLabel(4), "Luxury");
  for (const invalid of [0, 5, 1.5, "$", undefined, NaN])
    assert.equal(priceLabel(invalid), undefined);
  const card: Card = {
    id: "protocol",
    name: "Protocol",
    types: ["urn:entity:place"],
    detail: "",
    section: "Eat",
    intelligence: normalizeEntity({
      entity_id: "protocol",
      name: "Protocol",
      properties: { price_level: 2, business_rating: 4.5 },
      query: { affinity: 0.8 },
    }),
  };
  const html =
    renderToStaticMarkup(createElement(ResultMetrics, { card })) +
    renderToStaticMarkup(createElement(WhyEvidence, { card }));
  assert.doesNotMatch(html, /Price category|Relative price category/);
  assert.doesNotMatch(html, /Budget-friendly|Luxury|Premium/);
  assert.match(html, /4\.5/);
  assert.doesNotMatch(
    html,
    /\$ price level|raw score|query\.|filter\.|Taste affinity|Technical details|population/i,
  );
});
test("safe info and error logs work without debug mode and honor error-only filtering", async () => {
  const debug = process.env.AGENT_DEBUG,
    level = process.env.LOG_LEVEL,
    info = console.info,
    error = console.error,
    lines: string[] = [];
  process.env.AGENT_DEBUG = "0";
  delete process.env.LOG_LEVEL;
  console.info = console.error = (line: string) => {
    lines.push(line);
  };
  try {
    await debugRequest("account.plans", async () => {
      debugEvent("service.invoked", { service: "supabase-storage" });
      return Response.json({ secret: "never-log-body" });
    });
    await debugRequest("account", async () =>
      Response.json({ error: "never-log-auth-error" }, { status: 503 }),
    );
    const parsed = lines.map((l) => JSON.parse(l));
    assert.ok(
      parsed.some((l) => l.level === "info" && l.event === "service.invoked"),
    );
    assert.ok(parsed.some((l) => l.level === "error" && l.status === 503));
    assert.ok(parsed.every((l) => l.requestTrace));
    assert.ok(!lines.join("").includes("never-log"));
    const n = lines.length;
    process.env.LOG_LEVEL = "error";
    debugEvent("qloo.request", { endpoint: "search" });
    assert.equal(lines.length, n);
    debugEvent("qloo.failed");
    assert.equal(lines.length, n + 1);
  } finally {
    console.info = info;
    console.error = error;
    if (debug === undefined) delete process.env.AGENT_DEBUG;
    else process.env.AGENT_DEBUG = debug;
    if (level === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = level;
  }
});
