import test from "node:test";
import assert from "node:assert/strict";
import {
  interpret,
  culturalText,
  validateIntent,
  onboardingTastes,
  isConcept,
} from "../src/agent/intent.ts";
import { TurnGuard } from "../src/agent/guard.ts";
import { normalizeSession } from "../src/agent/session.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import { validateDiscoveries, tagCandidates } from "../src/agent/validation.ts";
import type { AgentState, ModelProvider } from "../src/agent/types.ts";
import type { AgentDependencies } from "../src/agent/orchestrator.ts";
// Isolated protocol fixtures, never available to production runtime.
const id = "00000000-0000-0000-0000-000000000001",
  replacement = "00000000-0000-0000-0000-000000000002";
function state(): AgentState {
  return {
    id: "session-test",
    revision: 0,
    expires: Date.now() + 10000,
    city: "New York City",
    selected: [
      { id, name: "Protocol artist", types: ["urn:entity:artist"], detail: "" },
    ],
    tags: [],
    constraints: [],
    categoryConstraints: {},
    cards: [
      {
        id,
        name: "Protocol dining",
        types: ["urn:entity:place"],
        detail: "",
        section: "Eat",
      },
      {
        id: "music-id",
        name: "Protocol music",
        types: ["urn:entity:artist"],
        detail: "",
        section: "Music",
      },
    ],
    previous: [],
    feedback: [],
    notices: [],
  };
}
function dependencies(): AgentDependencies {
  return {
    tools: async () => [
      { name: "qloo_find_tags", inputSchema: {} },
      { name: "qloo_rank", inputSchema: {} },
    ],
    workflow: async () => ({
      status: "ok",
      results: [
        {
          id: "urn:tag:category:place:indian_restaurant",
          name: "Indian restaurant",
          type: "urn:tag:category:place",
        },
      ],
    }),
    discover: async (_s, section) => [
      {
        id: replacement,
        name: "Protocol replacement",
        types: ["urn:entity:place"],
        detail: "",
        section,
      },
    ],
  };
}
const model: ModelProvider = {
  interpret: async () => interpret("Tonight I want Indian food"),
  choose: async () => [
    { name: "qloo_find_tags", arguments: { query: "Indian cuisine" } },
  ],
};
test("onboarding separates destination, seeds and negative constraints", () => {
  const i = interpret(
    "I'm moving from Bengaluru to New York. I love A.R. Rahman, Interstellar, biryani, specialty coffee and quiet bookstores. I don't like touristy places.",
  );
  assert.equal(i.destination, "New York City");
  assert.equal(i.seeds.length, 5);
  assert.equal(i.seeds[4], "quiet bookstores");
  assert.ok(i.constraints.includes("touristy"));
  assert.ok(!i.seeds.some((s) => s.includes("don't")));
});
test("cheaper is a category-scoped relative price refinement that retains exclusions", async () => {
  const s=state();
  s.queryPreferences={Eat:{priceMax:4,businessRatingMin:4,excludeTags:["urn:tag:business:place:chain"]}};
  const reply=await runTurn(s,{message:"cheaper"},dependencies());
  assert.deepEqual(reply.changed,["Eat"]);
  assert.equal(reply.state.queryPreferences?.Eat?.priceMax,3);
  assert.equal(reply.state.queryPreferences?.Eat?.businessRatingMin,4);
  assert.deepEqual(reply.state.queryPreferences?.Eat?.excludeTags,["urn:tag:business:place:chain"]);
  assert.deepEqual(reply.state.cards.filter(c=>c.section==="Music"),s.cards.filter(c=>c.section==="Music"));
  const deps=dependencies();
  deps.provider={interpret:async()=>interpret("hi"),choose:async()=>[]};
  const modelReply=await runTurn(s,{message:"cheaper"},deps);
  assert.deepEqual(modelReply.changed,["Eat"]);
  assert.equal(modelReply.state.queryPreferences?.Eat?.priceMax,3);
});
test("no chains executes as a refinement and refuses unverified exclusions", async () => {
  const s=state();const deps=dependencies();
  deps.workflow=async(_mode,_name,args)=>({status:"ok",results:[{id:args.query==="Starbucks"?"urn:tag:nearby_attraction:qloo:starbucks":"urn:tag:business:place:chain",name:args.query==="Starbucks"?"Starbucks":"Chain"}]});
  const reply=await runTurn(s,{message:"no chains"},deps);
  assert.deepEqual(reply.changed,["Eat"]);
  assert.ok(reply.state.queryPreferences?.Eat?.excludeTags?.includes("urn:tag:business:place:chain"));
  deps.workflow=async()=>({status:"ok",results:[]});
  const failed=await runTurn(s,{message:"no chains"},deps);
  assert.deepEqual(failed.changed,[]);
  assert.deepEqual(failed.state.cards,s.cards);
  assert.match(failed.message,/couldn't verify/);
});
test("fallback recognizes dinner, cinema and nightlife without treating party as a concert", () => {
  const intent = interpret("bro, i want to go movie and then party and dinner bro, help me please");
  assert.equal(intent.kind, "refine");
  assert.deepEqual(intent.sections, ["Eat", "Culture"]);
  assert.deepEqual(intent.activityGenres, ["cinema", "nightclub"]);
});
test("fallback preserves chicken biryani specificity", () => {
  const intent = interpret("bro, i want to eat chicken biryani bro");
  assert.deepEqual(intent.concepts, ["chicken biryani"]);
  assert.deepEqual(intent.sections, ["Eat"]);
});
test("specialty coffee never becomes a dining dish requirement", () => {
  const s = state();
  s.tags = [
    { id: "urn:tag:specialty_dish:place:specialty_coffee", name: "Specialty Coffee", types: ["urn:tag"], detail: "" },
    { id: "urn:tag:genre:place:restaurant:indian", name: "Indian", types: ["urn:tag"], detail: "" },
  ];
  const normalized = normalizeSession(s);
  assert.deepEqual(normalized.categoryTags.Eat, ["urn:tag:genre:place:restaurant:indian"]);
  assert.deepEqual(normalized.categoryTags.Coffee, ["urn:tag:specialty_dish:place:specialty_coffee"]);
});
test("exact explicit dish applies once without another confirmation", async () => {
  const deps = dependencies();
  deps.workflow = async () => ({ status: "ok", results: [{
    id: "urn:tag:specialty_dish:place:chicken_biryani",
    name: "Chicken Biryani", type: "urn:tag:specialty_dish:place",
  }] });
  let applied = false;
  deps.discover = async (s, section) => {
    applied = Boolean(s.categoryTags?.Eat?.includes("urn:tag:specialty_dish:place:chicken_biryani"));
    return [{ id: replacement, name: "Returned restaurant", types: ["urn:entity:place"], section, detail: "", evidence:{source:"Qloo",operation:"/v2/insights/",queryId:"fixture",recordedAt:"2026-10-21",destination:s.city,locality:"physical-city",mode:"familiar",pool:"direct",inputs:[],params:{},result:{id:replacement,type:"urn:entity:place",tags:[{id:"urn:tag:specialty_dish:place:chicken_biryani",name:"Chicken biryani"}]}} }];
  };
  const reply = await runTurn(state(), { message: "find chicken biryani" }, deps);
  assert.equal(applied, true);
  assert.equal(reply.state.pending, undefined);
  assert.deepEqual(reply.changed, ["Eat"]);
});
test("repeated pending request retains choices without another model or tool call", async () => {
  const s = state();
  s.pending = {
    query: "chicken biryani",
    request: "find chicken biryani",
    candidates: [{ id: "urn:tag:specialty_dish:place:chicken_biryani", name: "Chicken biryani", types: ["urn:tag"], detail: "" }],
    sections: ["Eat"], constraints: [],
  };
  const deps = dependencies();
  deps.workflow = async () => { throw Error("must not call tools"); };
  const reply = await runTurn(s, { message: "find chicken biryani" }, deps);
  assert.deepEqual(reply.state.pending?.candidates, s.pending.candidates);
  assert.deepEqual(reply.changed, []);
  assert.match(reply.message, /don't need to send/);
});
test("model interpretation cannot smuggle fabricated recommendation data into state", () => {
  const i = validateIntent({
    ...interpret("Give me quieter cafés"),
    cards: [{ name: "Fake recommendation" }],
    reasoning: "private text",
  });
  assert.ok(!("cards" in i));
  assert.ok(!("reasoning" in i));
  assert.throws(() => culturalText("email me at sample@example.com"));
  assert.throws(() => culturalText("my name is User Name"));
});
test("cultural input rejects configured provider and service credentials", () => {
  for (const name of ["QLOO_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "AGENT_MODEL_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const previous = process.env[name];
    process.env[name] = "security-regression-test-secret";
    try {
      assert.throws(() => culturalText("security-regression-test-secret"), /Credentials/);
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
});
test("Not My Vibe changes only the rejected category, records feedback and excludes rejected ID", async () => {
  const s = state(),
    d = dependencies();
  let observed: string[] = [];
  d.discover = async (_s, section, _c, excluded) => {
    observed = excluded;
    return [
      {
        id: replacement,
        name: "Protocol replacement",
        types: ["urn:entity:place"],
        detail: "",
        section,
      },
    ];
  };
  const r = await runTurn(
    s,
    { feedback: { id, accepted: false, reason: "Too touristy" } },
    d,
  );
  assert.deepEqual(r.changed, ["Eat"]);
  assert.deepEqual(
    r.state.cards.filter((c) => c.section === "Music"),
    s.cards.filter((c) => c.section === "Music"),
  );
  assert.equal(r.state.feedback[0].reason, "Too touristy");
  assert.ok(observed.includes(id));
  assert.equal(r.state.cards.find((c) => c.section === "Eat")?.id, replacement);
  assert.equal(s.feedback.length, 0);
  assert.equal(r.state.city, "New York City");
});
test("acceptance records an anchor without making Qloo calls", async () => {
  const d = dependencies();
  d.discover = async () => {
    throw Error("Must not execute");
  };
  const r = await runTurn(state(), { feedback: { id, accepted: true } }, d);
  assert.equal(r.state.feedback[0].accepted, true);
  assert.deepEqual(r.changed, []);
});
test("unambiguous Indian restaurant cuisine resolves without extra clicks", async () => {
  const d = dependencies();
  d.provider = model;
  let transport = "";
  d.workflow = async (mode) => {
    transport = mode;
    return {
      status: "ok",
      results: [
        {
          id: "urn:tag:category:place:indian_restaurant",
          name: "Indian restaurant",
        },
      ],
    };
  };
  const r = await runTurn(
    state(),
    { message: "Tonight I want Indian food" },
    d,
  );
  assert.equal(transport, "mcp");
  assert.equal(r.mode, "model-mcp");
  assert.equal(r.state.pending, undefined);
  assert.deepEqual(r.changed, ["Eat"]);
  assert.ok(r.state.categoryTags?.Eat?.includes("urn:tag:category:place:indian_restaurant"));
  assert.equal(r.state.cards.find(c=>c.section==="Music")?.name,"Protocol music");
});
test("duplicate cuisine taxonomy labels resolve to the place tag without duplicate choices",async()=>{
  const d=dependencies();
  d.workflow=async()=>({status:"ok",results:[
    {id:"urn:tag:cuisine:qloo:indian",name:"Indian Cuisine"},
    {id:"urn:tag:cuisine:place:indian",name:"Indian Cuisine"},
  ]});
  const r=await runTurn(state(),{message:"Show me Indian restaurants"},d);
  assert.equal(r.state.pending,undefined);
  assert.deepEqual(r.changed,["Eat"]);
  assert.ok(r.state.categoryTags?.Eat?.includes("urn:tag:cuisine:place:indian"));
});
test("confirmed concept is a real tag filter and updates only its requested section", async () => {
  const s = state();
  s.pending = {
    query: "Indian cuisine",
    candidates: [
      {
        id: "urn:tag:category:place:indian_restaurant",
        name: "Indian restaurant",
        types: ["urn:tag"],
        detail: "",
      },
    ],
    sections: ["Eat"],
    constraints: ["touristy"],
  };
  const r = await runTurn(
    s,
    { tagChoice: s.pending.candidates[0].id },
    dependencies(),
  );
  assert.equal(r.state.tags.length, 1);
  assert.equal(r.state.pending, undefined);
  assert.deepEqual(r.changed, ["Eat"]);
  assert.equal(
    r.state.cards.find((c) => c.section === "Music")?.name,
    "Protocol music",
  );
});
test("MCP failure preserves the existing passport rather than fake results", async () => {
  const d = dependencies();
  d.provider = model;
  d.workflow = async () => {
    throw Error("MCP unavailable");
  };
  const r = await runTurn(
    state(),
    { message: "Tonight I want Indian food" },
    d,
  );
  assert.deepEqual(r.state.cards, state().cards);
  assert.match(r.message, /temporarily unavailable/);
});
test("provider failure falls back to deterministic refinement", async () => {
  const d = dependencies();
  d.provider = {
    interpret: async () => {
      throw Error("Provider unavailable");
    },
    choose: async () => [],
  };
  const r = await runTurn(state(), { message: "Find more dining" }, d);
  assert.equal(r.mode, "deterministic");
  assert.deepEqual(r.changed, ["Eat"]);
  assert.match(r.message, /temporarily unavailable/);
});
test("guard bounds calls, prevents duplicates and expires stalled operations", async () => {
  const guard = new TurnGuard(1);
  await guard.run("one", {}, async () => 1);
  await assert.rejects(
    guard.run("one", {}, async () => 1),
    /Duplicate/,
  );
  await assert.rejects(
    guard.run("two", {}, async () => 1),
    /budget/,
  );
  const timed = new TurnGuard(1, 5);
  await assert.rejects(
    timed.run("stall", {}, () => new Promise((r) => setTimeout(r, 20))),
    /timeout/,
  );
});
test("tool budget in the orchestration path prevents a second category request", async () => {
  const r = await runTurn(
    state(),
    { message: "Show me food and music" },
    dependencies(),
    () => {},
    new TurnGuard(1),
  );
  assert.deepEqual(r.changed, ["Eat"]);
  assert.equal(
    r.state.cards.find((c) => c.section === "Music")?.name,
    "Protocol music",
  );
});
test("duplicate model-selected concept tools result in one bounded call", async () => {
  const d = dependencies();
  d.provider = {
    ...model,
    choose: async () => [
      { name: "qloo_find_tags", arguments: { query: "Indian cuisine" } },
      { name: "qloo_find_tags", arguments: { query: "Indian cuisine" } },
    ],
  };
  let calls = 0;
  const f = d.workflow;
  d.workflow = async (...args) => {
    calls++;
    return f(...args);
  };
  await runTurn(state(), { message: "Tonight I want Indian food" }, d);
  assert.equal(calls, 1);
});
test("429-like discovery failure preserves unrelated results and honors the rejected ID", async () => {
  const d = dependencies();
  d.discover = async () => {
    throw Error("HTTP 429");
  };
  const r = await runTurn(
    state(),
    { feedback: { id, accepted: false, reason: "Not interested" } },
    d,
  );
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.state.cards, state().cards.filter(c => c.id !== id));
  assert.match(r.message, /previous discoveries and their active preferences are unchanged/);
});
test("rank workflow cannot introduce a generated entity or address", async () => {
  const d = dependencies();
  d.provider = {
    interpret: async () => interpret("Rank dining shortlist"),
    choose: async () => [{ name: "qloo_rank", arguments: {} }],
  };
  d.workflow = async () => ({
    status: "ok",
    results: [
      {
        entity_id: "invented",
        name: "Fake place",
        address: "Fake address",
        affinity: 1,
      },
    ],
  });
  const r = await runTurn(state(), { message: "Rank dining shortlist" }, d);
  assert.ok(!JSON.stringify(r).includes("Fake place"));
  assert.ok(!r.state.cards.some((c) => c.id === "invented"));
});
test("place validation rejects nearby-food landmark tags and wrong cities", () => {
  const e = {
    name: "Protocol venue",
    entity_id: id,
    type: "urn:entity",
    subtype: "urn:entity:place",
    properties: { geocode: { city: "New York", metro: "New York City" } },
    tags: [{ name: "Nearby food trucks", type: "urn:tag:amenity:qloo" }],
  };
  assert.deepEqual(
    validateDiscoveries(
      { results: { entities: [e] } },
      "New York City",
      "Eat",
      [],
      [],
    ),
    [],
  );
  const restaurant = {
    ...e,
    tags: [{ name: "Indian restaurant", type: "urn:tag:category:place" }],
  };
  assert.equal(
    validateDiscoveries(
      { results: { entities: [restaurant] } },
      "New York City",
      "Eat",
      [],
      [],
    ).length,
    1,
  );
  assert.deepEqual(
    validateDiscoveries(
      { results: { entities: [restaurant] } },
      "Paris",
      "Eat",
      [],
      [],
    ),
    [],
  );
});
test("tag validation accepts only actual returned URNs and never invents tags", () => {
  assert.deepEqual(
    tagCandidates(
      { status: "ok", results: [{ id: "invented", name: "Fake tag" }] },
      "Indian",
    ),
    [],
  );
  assert.deepEqual(
    tagCandidates({ status: "needs_input", results: [] }, "Indian"),
    [],
  );
});
test("mixed concierge request hides coffee but refreshes food/books instead of deleting them", async () => {
  const s = state();
  s.cards.push({
    id: "coffee-id",
    name: "Protocol cafe",
    types: ["urn:entity:place"],
    detail: "",
    section: "Coffee",
  });
  s.tags.push({
    id: "urn:tag:category:place:book_store",
    name: "Bookstore",
    types: ["urn:tag:category:place"],
    detail: "Qloo concept for bookstore",
  });
  const r = await runTurn(
    s,
    { message: "Forget coffee. Show me books and food." },
    dependencies(),
  );
  assert.ok(r.state.hiddenCategories?.includes("Coffee"));
  assert.ok(r.state.cards.some((c) => c.section === "Coffee"));
  assert.ok(r.state.cards.some((c) => c.section === "Eat"));
  assert.ok(r.state.cards.some((c) => c.section === "Books"));
  assert.equal(
    r.state.cards.find((c) => c.section === "Music")?.name,
    "Protocol music",
  );
});

test("live-observed generic cuisine URNs are accepted as real concepts", () => {
  const tags = tagCandidates(
    {
      status: "ok",
      results: [
        {
          id: "urn:tag:cuisine:qloo:indian",
          name: "Indian",
          type: "urn:tag:cuisine:qloo",
        },
      ],
    },
    "Indian cuisine",
  );
  assert.equal(tags[0].id, "urn:tag:cuisine:qloo:indian");
});

test("accepted preference can be cleared without discovery", async () => {
  const s = state();
  s.feedback = [{ id, section: "Eat", accepted: true }];
  const r = await runTurn(
    s,
    { feedback: { id, accepted: true, clear: true } },
    dependencies(),
  );
  assert.equal(r.state.feedback.length, 0);
  assert.deepEqual(r.changed, []);
});

test("onboarding merges model concepts and named seeds without duplicating cuisine aliases", () => {
  const i = {
    ...interpret("Tonight I want Indian food"),
    kind: "onboard" as const,
    seeds: ["A.R. Rahman", "Interstellar"],
    concepts: ["Indian cuisine"],
  };
  assert.equal(onboardingTastes(i).length, 3);
  assert.equal(
    onboardingTastes({ ...i, seeds: [...i.seeds, "Indian food"] }).length,
    3,
  );
  assert.equal(isConcept("biryani"), true);
  assert.equal(isConcept("A.R. Rahman"), false);
});

test("turn deadline aborts linked work and prevents later queued calls", async () => {
  const guard = new TurnGuard(2, 5);
  await assert.rejects(
    guard.run(
      "slow",
      {},
      () =>
        new Promise<void>((_resolve, reject) =>
          guard.signal.addEventListener("abort", () =>
            reject(Error("cancelled")),
          ),
        ),
    ),
    /cancelled|timeout/,
  );
  assert.equal(guard.signal.aborted, true);
  await assert.rejects(
    guard.run("later", {}, async () => 1),
    /cancelled/,
  );
});
