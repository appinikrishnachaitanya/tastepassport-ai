import test from "node:test";
import assert from "node:assert/strict";
import {
  validatedSection,
  validateDiscoveries,
} from "../src/agent/validation.ts";
import { relaxationSteps } from "../src/agent/session.ts";
import { sendAgentTurn } from "../src/agent/browser.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
import { diversifyCards } from "../src/passport/model.ts";
import type { Card } from "../src/passport/model.ts";
import type { Entity } from "../src/qloo/types.ts";
const id = "11111111-1111-4111-8111-111111111111";
function venue(names: string[], description = ""): Entity {
  return {
    entity_id: id,
    name: "Protocol venue",
    type: "urn:entity:place",
    tags: names.map((name) => ({
      id: `urn:tag:genre:place:${name.replaceAll(" ", "_")}`,
      type: "urn:tag:genre:place",
      name,
    })),
    properties: {
      short_description: description,
      geocode: { city: "Toronto" },
    },
  };
}
test("culture rejects dining conflicts, tiffin descriptions and unknown genres without venue-specific rules", () => {
  for (const e of [
    venue(["Cultural"]),
    venue(["Museum", "Restaurant"]),
    venue(["Gallery"], "Indian tiffin service"),
    venue(["Food delivery"]),
    venue([]),
  ])
    assert.notEqual(validatedSection(e), "Culture");
  for (const e of [
    venue(["Museum", "Tourist attraction"]),
    venue(["Art gallery"]),
    venue(["Theatre"]),
  ])
    assert.equal(validatedSection(e), "Culture");
  assert.equal(validatedSection(venue(["Coffee shop"])), "Coffee");
  assert.equal(
    validateDiscoveries(
      { results: { entities: [venue(["Restaurant", "Museum"])] } },
      "Toronto",
      "Culture",
      [],
      [],
    ).length,
    0,
  );
});
test("sparse search never silently relaxes explicit budget or other requirements", () => {
  assert.deepEqual(relaxationSteps(["expensive", "crowded", "touristy"]), [
    ["expensive", "crowded", "touristy"],
  ]);
});

test("coffee shortlists cap repeated chain branches without fabricating alternatives", () => {
  const cards = [
    "Starbucks Union Square",
    "Starbucks Midtown",
    "Starbucks SoHo",
    "Starbucks Chelsea",
    "Kaffe 1668",
  ].map((name, index): Card => ({
    id: `coffee-${index}`,
    name,
    types: ["urn:entity:place"],
    detail: "",
    section: "Coffee",
  }));
  const shortlist = diversifyCards(cards, "Coffee");
  assert.deepEqual(shortlist.map((card) => card.name), [
    "Starbucks Union Square",
    "Starbucks Midtown",
    "Kaffe 1668",
  ]);
});

test("independent coffee refinement applies once and preserves other chapters", async () => {
  const state = normalizeSession({
    id: "coffee-session",
    revision: 0,
    expires: Date.now() + 90_000,
    city: "New York City",
    selected: [],
    tags: [],
    constraints: [],
    categoryConstraints: {},
    cards: [
      {
        id: "eat",
        name: "Dinner",
        types: ["urn:entity:place"],
        detail: "",
        section: "Eat",
      },
      {
        id: "old-coffee",
        name: "Starbucks",
        types: ["urn:entity:place"],
        detail: "",
        section: "Coffee",
      },
    ],
    previous: [],
    feedback: [],
    notices: [],
  });
  const deps = {
    tools: async () => [],
    workflow: async (
      _transport: string,
      _tool: string,
      args: { query: string },
    ) => ({
      status: "ok",
      results: [
        {
          id: args.query.includes("independent")
            ? "urn:tag:nearby_attraction:qloo:independent_coffee_shops"
            : args.query === "Starbucks" ? "urn:tag:nearby_attraction:qloo:starbucks"
            : "urn:tag:business:place:chain",
          name: args.query.includes("independent")
            ? "Independent Coffee Shops"
            : args.query === "Starbucks" ? "Starbucks"
            : "Chain",
          type: "urn:tag:nearby_attraction",
        },
      ],
    }),
    discover: async (_state: unknown, section: string) =>
      section === "Coffee"
        ? [
            {
              id: "local-coffee",
              name: "Local Coffee",
              types: ["urn:entity:place"],
              detail: "",
              section: "Coffee",
            },
          ]
        : [],
  } as any;
  const first = await runTurn(
    state,
    {
      message:
        "Find independent coffee shops instead of Starbucks or other big chains",
    },
    deps,
  );
  assert.ok(first.state.pending);
  const result = await runTurn(
    first.state,
    { tagChoice: "urn:tag:nearby_attraction:qloo:independent_coffee_shops" },
    deps,
  );
  assert.deepEqual(result.changed, ["Coffee"]);
  assert.equal(result.state.pending, undefined);
  assert.ok(result.state.cards.some((card) => card.id === "eat"));
  assert.ok(result.state.cards.some((card) => card.id === "local-coffee"));
});
test("refinement rejects malformed or stale result streams and supports cancellation", async () => {
  const original = globalThis.fetch;
  try {
    for (const payload of [
      "garbage",
      JSON.stringify({
        type: "result",
        reply: {
          changed: [],
          state: { id: "session", revision: 0, cards: [] },
        },
      }),
    ]) {
      globalThis.fetch = async () => new Response(payload + "\n");
      await assert.rejects(
        sendAgentTurn(
          { sessionId: "session", revision: 0, tags: [], constraints: [] },
          { message: "museums" },
          () => {},
        ),
      );
    }
    globalThis.fetch = async (_url, options) => {
      options?.signal?.throwIfAborted();
      return new Response("");
    };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      sendAgentTurn(
        { sessionId: "session", revision: 0, tags: [], constraints: [] },
        { message: "museums" },
        () => {},
        controller.signal,
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("cancelled server work releases the lock and cannot commit over a newer revision", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
 import assert from 'node:assert/strict';
 import {createSession,inSession,getSession} from './src/agent/store.ts';
 const state=createSession({city:'Toronto',selected:[],cards:[],notices:[],explanation:''});
 let finish;const cancelled=new AbortController();
 const job=inSession(state.id,0,async original=>{await new Promise(r=>finish=r);return {state:{...original,notices:['late']},value:'late'}},cancelled.signal);
 cancelled.abort();await assert.rejects(job);
 await inSession(state.id,0,async original=>({state:{...original,notices:['latest']},value:'latest'}));
 finish();await new Promise(r=>setTimeout(r,10));
 assert.equal(getSession(state.id).revision,1);assert.deepEqual(getSession(state.id).notices,['latest']);
 await assert.rejects(inSession(state.id,0,async original=>({state:original,value:null})));
 `,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
});
