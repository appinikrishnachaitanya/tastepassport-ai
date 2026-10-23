import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  buildQuery,
  validatePreferences,
  validateInsightParams,
  preferencesFromText,
  patchPreferences,
} from "../src/qloo/query-plan.ts";
import { normalizeEntity } from "../src/qloo/normalizer.ts";
import { normalizeTrend, trendStatus, trending } from "../src/qloo/trending.ts";
import { normalizeCompare, compareProfiles } from "../src/qloo/compare.ts";
import { findTags, tagTypes, entityDetails } from "../src/qloo/lookups.ts";
import { insights } from "../src/qloo/client.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession, resetConversation } from "../src/agent/session.ts";
import { evidenceFacts } from "../src/qloo/explanation.ts";
import { verifyResult } from "../src/qloo/verify-result.ts";
const a = "00000000-0000-4000-8000-000000000011",
  b = "00000000-0000-4000-8000-000000000012";
const tag = "urn:tag:genre:place:restaurant",
  other = "urn:tag:cuisine:restaurant:indian";

test("intelligence API rejects stale sessions, forged partner matches and production raw inspection", () => {
  const out = execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
import assert from 'node:assert/strict';
import {POST} from './app/api/agent/intelligence/route.ts';
import {createSession,getSession} from './src/agent/store.ts';
import {seal} from './src/passport/service.ts';
process.env.NODE_ENV='production';process.env.QLOO_API_KEY='api-protocol-secret';
const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
const selected=ids.map((id,i)=>({id,name:'Protocol '+i,types:['urn:entity:artist'],detail:''}));
const state=createSession({city:'Toronto',selected,cards:[],notices:[],explanation:'Protocol'});
const post=b=>POST(new Request('http://localhost/api/agent/intelligence',{method:'POST',headers:{Origin:'http://localhost'},body:JSON.stringify({sessionId:state.id,revision:state.revision,...b})}));
assert.equal((await post({action:'details',revision:99})).status,409);
assert.equal((await post({action:'details',entityId:'unowned'})).status,400);
assert.equal((await post({action:'debug'})).status,404);
const token=seal([{query:'Protocol',candidates:[selected[1]]}]);
assert.equal((await post({action:'together',token,ids:[ids[2]],section:'Eat'})).status,400);
let count=0;globalThis.fetch=async()=>{count++;return Response.json({results:{tags:[],a:[],b:[]}})};
const result=await post({action:'together',token,ids:[ids[1]],section:'Eat'});assert.equal(result.status,200);assert.deepEqual((await result.json()).cards,[]);assert.equal(count,1);assert.equal(getSession(state.id).revision,0);
console.log('Intelligence trust boundary PASS');
`,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30000 },
  );
  assert.match(out, /Intelligence trust boundary PASS/);
});

test("entity-aware plans separate film ratings from place/business ratings and report unsupported controls", () => {
  const place = buildQuery({
    outputType: "place",
    interests: { entities: [a], tags: [] },
    preferences: {
      ratingMin: 4,
      businessRatingMin: 4.5,
      priceMax: 2,
      qualityBias: "high",
      contentBasedBias: 0.5,
      resyRatingMin: 4,
      requiredProperties: ["image"],
    },
  });
  assert.equal(place.params["filter.properties.business_rating.min"], "4.5");
  assert.equal(place.params["filter.price_level.max"], "2");
  assert.equal(place.params["bias.content_based"], undefined);
  assert.ok(place.diagnostics.dropped.some(item=>item.parameter === "bias.content_based"));
  assert.equal(place.params["filter.exists"], "properties.image");
  for (const name of [
    "filter.rating.min",
    "filter.external.resy.rating.min",
  ]) {
    assert.equal(place.params[name], undefined);
    assert.ok(place.diagnostics.dropped.some((d) => d.parameter === name));
  }
  const movie = buildQuery({
    outputType: "movie",
    interests: { entities: [a], tags: [] },
    preferences: { ratingMin: 4, priceMax: 2, qualityBias: "high" },
  });
  assert.equal(movie.params["filter.rating.min"], "4");
  assert.equal(movie.params["filter.price_level.max"], undefined);
  assert.equal(movie.params["bias.quality"], undefined);
});
test("plans reject arbitrary IDs, bad ranges, reversed bounds, unknown model properties and invalid weights", () => {
  assert.throws(() =>
    buildQuery({
      outputType: "place",
      interests: { entities: ["Interstellar"], tags: [] },
    }),
  );
  assert.throws(() =>
    buildQuery({
      outputType: "place",
      interests: { entities: [], tags: ["Indian food"] },
    }),
  );
  for (const p of [
    { priceMax: 8 },
    { popularityMin: -1 },
    { businessRatingMin: 8 },
    { priceMin: 4, priceMax: 1 },
    { apiKey: "secret" },
    { locationQuery: "https://other.example" },
  ])
    assert.throws(() => validatePreferences(p));
  assert.throws(() =>
    validateInsightParams({
      "filter.type": "urn:entity:place",
      "filter.popularity.max": "2",
    }),
  );
  assert.throws(() =>
    validateInsightParams({
      "filter.type": "urn:entity:place",
      "bias.quality": "invented",
    }),
  );
});
test("central mapping preserves union/intersection, geography, exclusions and external evidence filters", () => {
  for (const operator of ["union", "intersection"] as const) {
    const { params } = buildQuery({
      outputType: "place",
      interests: { entities: [a], tags: [other] },
      preferences: {
        includeTags: [tag, other],
        excludeTags: [other],
        excludeEntities: [b],
        tagOperator: operator,
        locationQuery: "Manhattan",
        radius: 3000,
        excludeLocation: "Times Square",
        tripAdvisorRatingMin: 4,
        tripAdvisorReviewCountMin: 50,
        requiredExternalSources: ["michelin"],
        diversifyBy: "properties.geocode.metro",
        diversifyTake: 3,
      },
    });
    assert.equal(params["operator.filter.tags"], operator);
    assert.equal(params["filter.exclude.tags"], other);
    assert.equal(params["filter.exclude.location.query"], "Times Square");
    assert.equal(params["filter.external.tripadvisor.rating.count.min"], "50");
    assert.equal(params["filter.external.exists"], "michelin");
    assert.equal(params["diversify.by"], "properties.geocode.metro");
  }
});
test("discovery presets ask Qloo to rank and filter rather than fabricate result metrics", () => {
  const plan = (goal: "trending" | "hidden-gems" | "safe-bets") =>
    buildQuery({
      outputType: "place",
      interests: { entities: [a], tags: [] },
      preferences: { goal },
    }).params;
  assert.equal(plan("trending")["bias.trends"], "high");
  assert.equal(plan("hidden-gems")["filter.popularity.max"], "0.75");
  assert.equal(plan("safe-bets")["filter.properties.business_rating.min"], "4");
  assert.equal(
    preferencesFromText("Highly rated hidden gems under $$").priceMax,
    2,
  );
  assert.equal(preferencesFromText("premium dinner").priceMin, 3);
  assert.equal(preferencesFromText("mid-range dinner").priceMax, 3);
});
test("normalization keeps affinity, returned contribution and distinct ratings without manufacturing missing fields", () => {
  const m = normalizeEntity({
    name: "Protocol place",
    entity_id: a,
    type: "urn:entity:place",
    properties: {
      business_rating: 4.7,
      price_level: 2,
      rating: 3,
      image: { url: "https://example.test/image.jpg" },
    },
    popularity: 0.82,
    query: {
      affinity: 0.6,
      explainability: {
        "signal.interests.entities": [
          { entity_id: b, score: 0.43 },
          { entity_id: a, score: "invented" },
        ],
      },
    },
  });
  assert.equal(m.taste.affinity, 0.6);
  assert.deepEqual(m.taste.contributingSignals, [
    { id: b, contribution: 0.43 },
  ]);
  assert.equal(m.quality.qlooRating, 3);
  assert.equal(m.quality.businessRating, 4.7);
  assert.equal(m.quality.qualityScore, undefined);
  assert.equal(m.quality.popularity, 0.82);
  assert.equal(m.externalProof.resyRating, undefined);
  const empty = normalizeEntity({ name: "Protocol", entity_id: a });
  assert.deepEqual(empty.taste.contributingSignals, []);
  assert.equal(empty.quality.businessRating, undefined);
});
test("successful HTTP envelopes cannot certify unsupported or observably violated filters", () => {
  assert.equal(
    verifyResult(
      { entity_id: a, name: "Protocol", properties: { price_level: 4 } },
      { "filter.price_level.max": "2" },
    ).eligible,
    false,
  );
  const missing = verifyResult(
    { entity_id: a, name: "Protocol" },
    {
      "filter.properties.business_rating.min": "4",
      "filter.location.query": "Manhattan",
    },
  );
  assert.equal(missing.eligible, false);
  assert.ok(
    missing.unverified.includes("filter.properties.business_rating.min"),
  );
  assert.ok(missing.unverified.includes("filter.location.query"));
});
test("trends preserve raw observations and avoid interpreting undocumented velocity direction", () => {
  const result = normalizeTrend(
    {
      results: {
        trending: [
          {
            date: "2026-10-02",
            population_percentile: 90,
            population_rank: 3,
            population_rank_velocity: -5,
            population_percent_delta: 2,
          },
          { date: "2020-01-01", population_percent_delta: -1 },
        ],
      },
    },
    a,
    "2026-10-01",
    "2026-10-03",
  );
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].velocity, -5);
  assert.equal(result.status, "rising");
  assert.equal(trendStatus({ date: "2026-10-02", velocity: 99 }), undefined);
  assert.equal(
    trendStatus({ date: "2026-10-02", populationPercentDelta: -2 }),
    "cooling",
  );
  assert.equal(
    normalizeTrend({ results: { trending: [] } }, a, "2026-10-01", "2026-10-03")
      .status,
    undefined,
  );
});
test("Compare uses returned shared tags and does not invent overlap or relationship percentages", () => {
  const c = normalizeCompare({
    results: {
      tags: [{ tag_id: other, name: "Protocol common", query: { score: 0.7 } }],
      a: [{ tag_id: tag, name: "Protocol separate" }],
      b: [],
    },
  });
  assert.equal(c.shared[0].score, 0.7);
  assert.equal(c.aOnly.length, 1);
  assert.equal(c.bOnly.length, 0);
  assert.throws(() => normalizeCompare({ results: [] }));
});
test("follow-ups patch the current chapter query while preserving other chapters and hard settings", async () => {
  assert.deepEqual(
    patchPreferences(
      { priceMin: 4, locationQuery: "Toronto" },
      { priceMax: 2 },
    ),
    { priceMax: 2, locationQuery: "Toronto" },
  );
  const state = normalizeSession({
    id: "session",
    revision: 0,
    expires: Date.now() + 10000,
    city: "Toronto",
    selected: [],
    tags: [],
    constraints: [],
    categoryConstraints: {},
    cards: [],
    previous: [],
    feedback: [],
    notices: [],
    queryPreferences: {
      Eat: { priceMax: 2, locationQuery: "Toronto" },
      Coffee: { priceMax: 1 },
    },
  });
  const deps = {
    tools: async () => [],
    workflow: async () => ({ status: "empty" }),
    discover: async () => [],
  };
  const r = await runTurn(state, { message: "What's trending for me?" }, deps);
  assert.equal(r.state.queryPreferences?.Eat?.priceMax, 2);
  assert.equal(r.state.queryPreferences?.Eat?.locationQuery, "Toronto");
  assert.equal(r.state.queryPreferences?.Eat?.goal, undefined);
  assert.equal(r.state.failedSearches?.Eat?.queryPreferences?.goal, "trending");
  assert.deepEqual(r.state.queryPreferences?.Coffee, { priceMax: 1 });
  assert.deepEqual(resetConversation(r.state).queryPreferences, {});
});
test("an exclusion confirmation applies a negative tag rather than adding a positive cuisine filter", async () => {
  const state = normalizeSession({
    id: "session",
    revision: 0,
    expires: Date.now() + 10000,
    city: "Toronto",
    selected: [],
    tags: [],
    constraints: [],
    categoryConstraints: {},
    cards: [],
    previous: [],
    feedback: [],
    notices: [],
    pending: {
      query: "seafood",
      candidates: [
        { id: other, name: "Protocol seafood", types: ["urn:tag"], detail: "" },
      ],
      sections: ["Eat"],
      constraints: [],
      exclude: true,
    },
  });
  const r = await runTurn(
    state,
    { tagChoice: other },
    {
      tools: async () => [],
      workflow: async () => ({ status: "empty" }),
      discover: async () => [],
    },
  );
  assert.equal(r.state.queryPreferences?.Eat?.excludeTags, undefined);
  assert.deepEqual(r.state.failedSearches?.Eat?.queryPreferences?.excludeTags, [other]);
  assert.ok(!r.state.categoryTags?.Eat?.includes(other));
});
test("explanation facts only use returned evidence and never convert affinity into taste probability", () => {
  const facts = evidenceFacts({
    id: a,
    name: "Protocol",
    types: ["urn:entity:place"],
    detail: "",
    section: "Eat",
    intelligence: normalizeEntity({
      entity_id: a,
      name: "Protocol",
      query: { affinity: 0.96 },
    }),
  });
  assert.ok(!facts.join(" ").includes("96%"));
  assert.ok(facts.join(" ").includes("confirmed interests"));
});
test("HTTP integration maps lookup, insights, compare and trend endpoints; unsupported fields never reach fetch", async () => {
  const original = globalThis.fetch,
    key = process.env.QLOO_API_KEY;
  process.env.QLOO_API_KEY = "intelligence-protocol-only";
  const calls: URL[] = [];
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    calls.push(u);
    assert.equal(
      (init?.headers as Record<string, string>)["X-Api-Key"],
      "intelligence-protocol-only",
    );
    if (u.pathname === "/v2/tags")
      return Response.json({
        results: {
          tags: [
            {
              id: tag,
              name: "Protocol restaurant",
              type: "urn:tag:genre:place",
            },
          ],
        },
      });
    if (u.pathname === "/v2/tags/types")
      return Response.json({
        results: { tag_types: [{ type: "urn:tag:genre:place" }] },
      });
    if (u.pathname === "/entities")
      return Response.json({ results: [{ entity_id: a, name: "Protocol" }] });
    if (u.pathname === "/v2/analysis/compare")
      return Response.json({
        results: { tags: [{ tag_id: other, name: "Protocol common" }] },
      });
    if (u.pathname === "/v2/trending")
      return Response.json({ results: { trending: [] } });
    return Response.json({
      results: {
        entities: [
          { entity_id: a, name: "Protocol", type: "urn:entity:place", properties:{business_rating:4.6} },
        ],
      },
    });
  };
  try {
    assert.equal((await findTags("Protocol")).length, 1);
    assert.equal((await tagTypes()).length, 1);
    assert.equal((await entityDetails([a])).length, 1);
    const r = await insights({
      "filter.type": "urn:entity:place",
      "signal.interests.entities": a,
      "filter.rating.min": "4",
      "filter.properties.business_rating.min": "4.5",
      "bias.content_based": ".5",
    });
    assert.equal(r.entities.length, 1);
    const u = calls.at(-1)!;
    assert.equal(u.searchParams.has("filter.rating.min"), false);
    assert.equal(
      u.searchParams.get("filter.properties.business_rating.min"),
      "4.5",
    );
    assert.equal(u.searchParams.get("feature.explainability"), "true");
    assert.equal((await compareProfiles([a], [b])).shared.length, 1);
    assert.equal((await trending(a, "urn:entity:place")).points.length, 0);
    assert.ok(calls.at(-1)?.searchParams.has("filter.start_date"));
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.QLOO_API_KEY;
    else process.env.QLOO_API_KEY = key;
  }
});
