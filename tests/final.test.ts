import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparisonPanel } from "../app/components/cultural.tsx";
import { interpret, validateIntent } from "../src/agent/intent.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import {
  normalizeSession,
  resetConversation,
  clearPassport,
} from "../src/agent/session.ts";
import { withEvidence } from "../src/passport/evidence.ts";
import { captureComparison } from "../src/agent/comparison.ts";
import type { AgentDependencies } from "../src/agent/orchestrator.ts";
import type { Card } from "../src/passport/model.ts";
function state() {
  return normalizeSession({
    id: "final-test",
    revision: 0,
    expires: Date.now() + 10000,
    city: "Toronto",
    selected: [
      {
        id: "artist",
        name: "Artist fixture",
        types: ["urn:entity:artist"],
        detail: "",
      },
    ],
    tags: [],
    constraints: [],
    categoryConstraints: {},
    cards: [
      {
        id: "dining",
        name: "Dining fixture",
        types: ["urn:entity:place"],
        detail: "",
        section: "Eat",
      },
      {
        id: "music",
        name: "Music fixture",
        types: ["urn:entity:artist"],
        detail: "",
        section: "Music",
      },
    ],
    previous: [],
    feedback: [],
    notices: [],
  });
}
function dependencies(): AgentDependencies {
  return {
    tools: async () => [],
    workflow: async () => ({ status: "ok", results: [] }),
    discover: async (_s, section) => [
      {
        id: "new",
        name: "Returned fixture",
        types: [section === "Music" ? "urn:entity:artist" : "urn:entity:place"],
        detail: "",
        section,
      },
    ],
  };
}
function evidenceCard(section: "Eat" | "Culture" = "Eat"): Card {
  const id = "00000000-0000-0000-0000-000000000050";
  return withEvidence(
    [
      {
        id,
        name: "Returned fixture",
        types: ["urn:entity:place"],
        detail: "",
        section,
      },
    ],
    [
      {
        entity_id: id,
        name: "Returned fixture",
        type: "urn:entity:place",
        properties: { geocode: { city: "Toronto" } },
        tags: [],
      },
    ],
    {
      "filter.type": "urn:entity:place",
      "signal.interests.entities": "artist",
      "filter.location.query": "Toronto",
      "filter.location.radius": "0",
    },
    state().selected,
    "Toronto",
  )[0];
}
test("exact mixed cultural request hides Eat and selects Culture for actual replanning", async () => {
  const request = "Forget food. Show me something cultural.";
  const intent = interpret(request);
  assert.equal(intent.kind, "refine");
  assert.deepEqual(intent.hide, ["Eat"]);
  assert.deepEqual(intent.sections, ["Culture"]);
  const original = state(),
    d = dependencies();
  let called = "";
  d.discover = async (_s, section) => {
    called = section;
    return [{ ...evidenceCard("Culture") }];
  };
  const r = await runTurn(original, { message: request }, d);
  assert.equal(called, "Culture");
  assert.ok(r.state.hiddenCategories.includes("Eat"));
  assert.deepEqual(
    r.state.cards.filter((c) => c.section === "Music"),
    original.cards.filter((c) => c.section === "Music"),
  );
  assert.equal(r.state.city, "Toronto");
  assert.deepEqual(
    r.state.comparison?.cards.map((c) => c.section),
    ["Culture"],
  );
  assert.equal(r.state.comparison?.request, request);
});
test("adventurous conversation updates the same familiarity state as guided mode", async () => {
  const message =
    "Give me more adventurous dining but still connected to my tastes.";
  assert.equal(interpret(message).familiarity, "explore");
  const a = await runTurn(state(), { message }, dependencies());
  const b = await runTurn(
    state(),
    { familiarity: { section: "Eat", mode: "explore" } },
    dependencies(),
  );
  assert.equal(a.state.categoryModes.Eat, b.state.categoryModes.Eat);
  assert.deepEqual(a.state.cards, b.state.cards);
});
test("adventurous follow-up does not reactivate food hidden by the current Culture request", async () => {
  const s = state();
  s.hiddenCategories = ["Eat"];
  s.activeCategories = ["Culture", "Music"];
  s.intent = interpret("Forget food. Show me something cultural.");
  const r = await runTurn(
    s,
    {
      message:
        "Give me something more adventurous but still connected to my tastes.",
    },
    dependencies(),
  );
  assert.equal(r.state.categoryModes.Culture, "explore");
  assert.deepEqual(r.state.intent?.sections, ["Culture"]);
  assert.ok(r.state.hiddenCategories.includes("Eat"));
});
test("similar-vibe conversation uses a saved real anchor in its category, and asks when no anchor exists", async () => {
  const s = state();
  s.feedback = [{ id: "music", section: "Music", accepted: true }];
  let target = "";
  const d = dependencies();
  d.discover = async (current, section) => {
    target = section;
    assert.ok(current.feedback.some((f) => f.id === "music" && f.accepted));
    return [{ ...s.cards[1], id: "similar" }];
  };
  const r = await runTurn(
    s,
    { message: "I liked this. Find me something with a similar vibe." },
    d,
  );
  assert.equal(target, "Music");
  assert.deepEqual(r.changed, ["Music"]);
  assert.deepEqual(
    r.state.cards.filter((c) => c.section === "Eat"),
    s.cards.filter((c) => c.section === "Eat"),
  );
  const missing = await runTurn(
    state(),
    { message: "I liked this. Find me something with a similar vibe." },
    dependencies(),
  );
  assert.deepEqual(missing.changed, []);
  assert.match(missing.message, /Save My vibe/);
});
test("model familiarity enum is validated and fabricated fields never enter intent", () => {
  const i = validateIntent({
    ...interpret("Give me more adventurous dining"),
    affinity: 99,
    address: "invented",
  });
  assert.equal(i.familiarity, "explore");
  assert.ok(!("affinity" in i));
  assert.ok(!("address" in i));
  assert.throws(() => validateIntent({ ...i, familiarity: "unbounded" }));
});
test("comparison captures the exact request, destination and its affected Qloo cards only", () => {
  const s = state();
  s.cards = [evidenceCard(), ...s.cards.filter((c) => c.section === "Music")];
  const request =
    "Tonight I want Indian food, quiet atmosphere, and nothing too touristy.";
  const snapshot = captureComparison(s, request, ["Eat"], ["Eat"]);
  assert.equal(snapshot.request, request);
  assert.equal(snapshot.destination, "Toronto");
  assert.deepEqual(
    snapshot.cards.map((c) => c.section),
    ["Eat"],
  );
  assert.equal(snapshot.revision, 1);
  s.cards[0].name = "Changed later";
  assert.equal(snapshot.cards[0].name, "Returned fixture");
});
test("empty or failed requests never misattribute retained recommendations to a new comparison", () => {
  const s = state();
  s.cards = [evidenceCard()];
  const snapshot = captureComparison(
    s,
    "Find something cultural",
    ["Culture"],
    [],
  );
  assert.equal(snapshot.outcome, "no-new-results");
  assert.deepEqual(snapshot.cards, []);
});
test("comparison context clears on both reset actions while lightweight reset preserves cards", () => {
  const s = state();
  s.comparison = captureComparison(s, "Find more dining", ["Eat"], ["Eat"]);
  const reset = resetConversation(s);
  assert.equal(reset.comparison, undefined);
  assert.deepEqual(reset.cards, s.cards);
  assert.equal(clearPassport(s).comparison, undefined);
});
test("comparison UI displays the exact shared request and labels baseline as unverified", () => {
  const request = "Find something cultural in Toronto";
  const html = renderToStaticMarkup(
    createElement(ComparisonPanel, {
      baseline: {
        text: "Model protocol fixture",
        model: "test-model",
        generatedAt: "2026-10-14T00:00:00Z",
        source: "model-only",
        request,
      },
      cards: [evidenceCard("Culture")],
    }),
  );
  assert.match(html, /THE SAME USER REQUEST/);
  assert.match(html, /Find something cultural in Toronto/);
  assert.match(html, /unverified/i);
});
test("failed dynamic MCP concept lookup falls back once to the real known exec workflow", async () => {
  const d = dependencies();
  d.provider = {
    interpret: async () => ({
      ...interpret("Find more culture"),
      concepts: ["independent art"],
    }),
    choose: async () => [
      { name: "qloo_find_tags", arguments: { query: "independent art" } },
    ],
  };
  d.tools = async () => [{ name: "qloo_find_tags", inputSchema: {} }];
  const modes: string[] = [];
  d.workflow = async (mode, name) => {
    modes.push(mode);
    assert.equal(name, "qloo_find_tags");
    if (mode === "mcp") throw Error();
    return {
      status: "ok",
      results: [
        {
          id: "urn:tag:genre:place:protocol_art",
          name: "Protocol art",
          type: "urn:tag:genre:place",
        },
      ],
    };
  };
  const r = await runTurn(
    state(),
    { message: "Find independent art connected to my tastes" },
    d,
  );
  assert.deepEqual(modes, ["mcp", "exec"]);
  assert.ok(r.state.pending);
  assert.deepEqual(r.state.cards, state().cards);
});
test("Too mainstream feedback keeps rejection hard even if optional constraints need relaxation", async () => {
  const s = state(),
    d = dependencies();
  let attempts = 0;
  d.discover = async (current, section, constraints, excluded) => {
    assert.equal(current.city, "Toronto");
    assert.equal(section, "Eat");
    assert.ok(excluded.includes("dining"));
    attempts++;
    return constraints.length ? [] : [evidenceCard()];
  };
  const r = await runTurn(
    s,
    { feedback: { id: "dining", accepted: false, reason: "Too mainstream" } },
    d,
  );
  assert.equal(attempts, 1);
  assert.ok(!r.state.cards.some((c) => c.id === "dining"));
  assert.deepEqual(
    r.state.cards.filter((c) => c.section === "Music"),
    s.cards.filter((c) => c.section === "Music"),
  );
  assert.deepEqual(r.state.relaxed, []);
});

test("Gemini-compatible HTTP adapter sends the exact baseline request without Qloo tools, IDs or credentials in prompts", async () => {
  const { execFileSync } = await import("node:child_process");
  const output = execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
 import assert from 'node:assert/strict';
 import {configuredProvider} from './src/agent/provider.ts';
 delete process.env.GOOGLE_API_KEY;delete process.env.GEMINI_API_KEY;process.env.AGENT_MODEL_API_KEY='protocol-model-secret';process.env.AGENT_MODEL_BASE_URL='https://generativelanguage.googleapis.com/v1beta/openai';process.env.AGENT_MODEL_NAME='protocol-model';process.env.QLOO_API_KEY='protocol-qloo-secret';
 const calls=[];globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
 if(!body.tools)return Response.json({choices:[{message:{content:'Unverified protocol baseline'}}]});
 const name=body.tools[0].function.name;const args=name==='interpret_cultural_intent'?{kind:'refine',seeds:[],concepts:[],constraints:[],sections:['Eat'],strategy:'discover',affinity:999}:{query:'independent art'};
 return Response.json({choices:[{message:{tool_calls:[{function:{name,arguments:JSON.stringify(args)}}]}}]});};
 const provider=configuredProvider();const request='Tonight I want Indian food, quiet atmosphere, and nothing too touristy.';
 const intent=await provider.interpret(request);assert.deepEqual(intent.sections,['Eat']);assert.ok(!('affinity' in intent));
 const baseline=await provider.baseline('Toronto',['A.R. Rahman','Interstellar','Indian'],request);assert.equal(baseline.request,request);assert.equal(baseline.source,'model-only');
 const message=JSON.parse(calls[1].messages[1].content);assert.equal(message.request,request);assert.equal(message.destination,'Toronto');assert.deepEqual(message.tastes,['A.R. Rahman','Interstellar','Indian']);assert.ok(!('tools' in calls[1]));
 assert.ok(!JSON.stringify(calls[1]).includes('protocol-model-secret'));assert.ok(!JSON.stringify(calls[1]).includes('protocol-qloo-secret'));assert.ok(!JSON.stringify(calls[1]).includes('urn:entity:'));
 const state={city:'Toronto',selected:[],cards:[],feedback:[],intent};const choices=await provider.choose('Find independent art',state,[{name:'qloo_find_tags',inputSchema:{type:'object'}}]);assert.equal(choices[0].name,'qloo_find_tags');assert.equal(calls[2].tool_choice,'auto');
 globalThis.fetch=async()=>Response.json({choices:[{message:{tool_calls:[{function:{name:'delete_account',arguments:'{}'}}]}}]});
 await assert.rejects(provider.choose('Find independent art',state,[{name:'qloo_find_tags',inputSchema:{type:'object'}}]),/Invalid tool arguments/);
 let leaked=false;globalThis.fetch=async()=>{leaked=true;throw Error('Unexpected network');};
 await assert.rejects(provider.interpret('protocol-model-secret'),/Credentials/);assert.equal(leaked,false);
 console.log('Adapter protocol PASS');
 `,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30000 },
  );
  assert.match(output, /Adapter protocol PASS/);
});

test("Not My Vibe preserves explicitly requested cuisine even when the category uses Explore mode", async () => {
  const s = state();
  const tag = {
    id: "urn:tag:cuisine:qloo:indian",
    name: "Indian",
    types: ["urn:tag:cuisine"],
    detail: "Indian cuisine",
  };
  s.tags = [tag];
  s.categoryTags.Eat = [tag.id];
  s.categoryModes.Eat = "explore";
  s.categoryConcepts.Eat = ["Indian cuisine"];
  const d = dependencies();
  d.discover = async (current, _section, _constraints, excluded) => {
    assert.deepEqual(current.intent?.concepts, ["Indian cuisine"]);
    assert.ok(excluded.includes("dining"));
    return [evidenceCard()];
  };
  const r = await runTurn(
    s,
    { feedback: { id: "dining", accepted: false, reason: "Too mainstream" } },
    d,
  );
  assert.deepEqual(r.state.categoryConcepts.Eat, ["Indian cuisine"]);
  assert.deepEqual(r.changed, ["Eat"]);
});

test("normalized MCP error envelopes trigger the same bounded exec fallback as transport failures", async () => {
  const d = dependencies();
  d.provider = {
    interpret: async () => ({
      ...interpret("Find more culture"),
      concepts: ["independent art"],
    }),
    choose: async () => [
      { name: "qloo_find_tags", arguments: { query: "independent art" } },
    ],
  };
  d.tools = async () => [{ name: "qloo_find_tags", inputSchema: {} }];
  const modes: string[] = [];
  d.workflow = async (mode) => {
    modes.push(mode);
    return mode === "mcp"
      ? { status: "error", error: { code: "unavailable" } }
      : {
          status: "ok",
          results: [
            {
              id: "urn:tag:genre:place:protocol_art",
              name: "Protocol art",
              type: "urn:tag:genre:place",
            },
          ],
        };
  };
  const r = await runTurn(state(), { message: "Find independent art" }, d);
  assert.deepEqual(modes, ["mcp", "exec"]);
  assert.ok(r.state.pending);
  assert.deepEqual(r.changed, []);
});

test("real museum category evidence is eligible Culture while touristy avoidance remains an independent constraint", async () => {
  const { validateDiscoveries } = await import("../src/agent/validation.ts");
  const entity = {
    entity_id: "00000000-0000-0000-0000-000000000090",
    name: "Museum fixture",
    type: "urn:entity:place",
    properties: { geocode: { city: "Toronto" } },
    tags: [
      {
        id: "urn:tag:genre:place:museum",
        name: "Museum",
        type: "urn:tag:genre:place",
      },
      {
        id: "urn:tag:category:place:tourist_attraction",
        name: "Tourist attraction",
        type: "urn:tag:category:place",
      },
    ],
  };
  const body = { results: { entities: [entity] } };
  assert.equal(
    validateDiscoveries(body, "Toronto", "Culture", [], []).length,
    1,
  );
  assert.equal(
    validateDiscoveries(body, "Toronto", "Culture", ["touristy"], []).length,
    0,
  );
  assert.equal(validateDiscoveries(body, "Toronto", "Eat", [], []).length, 0);
});
