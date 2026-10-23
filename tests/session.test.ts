import test from "node:test";
import assert from "node:assert/strict";
import {
  clearPassport,
  resetConversation,
  normalizeSession,
} from "../src/agent/session.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import type { AgentDependencies } from "../src/agent/orchestrator.ts";
import type { AgentState, Constraint } from "../src/agent/types.ts";
import { providerHealth, recordProviderHealth } from "../src/agent/health.ts";
function fresh(): AgentState {
  return normalizeSession({
    id: "test",
    revision: 0,
    expires: Date.now() + 10000,
    city: "New York City",
    selected: [
      {
        id: "artist-id",
        name: "A.R. Rahman",
        types: ["urn:entity:artist"],
        detail: "",
      },
      {
        id: "movie-id",
        name: "Interstellar",
        types: ["urn:entity:movie"],
        detail: "",
      },
      {
        id: "urn:tag:cuisine:qloo:indian",
        name: "Indian",
        types: ["urn:tag:cuisine"],
        detail: "Indian cuisine",
      },
    ],
    tags: [
      {
        id: "urn:tag:cuisine:qloo:indian",
        name: "Indian",
        types: ["urn:tag:cuisine"],
        detail: "Indian cuisine",
      },
    ],
    constraints: [],
    categoryConstraints: {},
    cards: [
      {
        id: "old-food",
        name: "Existing dining",
        types: ["urn:entity:place"],
        detail: "",
        section: "Eat",
      },
      {
        id: "music",
        name: "Existing music",
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
function deps(): AgentDependencies {
  return {
    tools: async () => [],
    workflow: async () => ({ status: "ok", results: [] }),
    discover: async (_s, section) => [
      {
        id: "new-food",
        name: "Qloo fixture dining",
        types: ["urn:entity:place"],
        detail: "",
        section,
      },
    ],
  };
}
function polluted() {
  const s = fresh();
  s.hiddenCategories = ["Eat"];
  s.categoryConstraints = { Eat: ["crowded", "touristy"] };
  s.constraints = ["mainstream"];
  s.preferences = { Eat: ["quiet"] };
  s.explorationMode = "shortlist";
  s.feedback = [
    {
      id: "old-food",
      section: "Eat",
      accepted: false,
      reason: "Not interested",
    },
  ];
  s.intent = {
    kind: "hide",
    seeds: [],
    concepts: [],
    constraints: [],
    sections: ["Eat"],
    strategy: "filter",
  };
  s.history = [{ role: "user", text: "Forget food" }];
  s.pending = {
    query: "quiet",
    candidates: [],
    sections: ["Eat"],
    constraints: ["crowded"],
  };
  s.previous = s.cards;
  s.recovery = ["Eat"];
  s.relaxed = [{ section: "Eat", constraints: ["touristy"] }];
  return s;
}
test("New Passport clears all taste, conversation, result, rejection and hidden-category state", () => {
  const old = polluted(),
    s = clearPassport(old);
  assert.equal(s.city, "");
  for (const field of [
    "selected",
    "tags",
    "cards",
    "previous",
    "feedback",
    "constraints",
    "history",
    "hiddenCategories",
    "activeCategories",
    "recovery",
    "relaxed",
    "notices",
  ] as const)
    assert.deepEqual(s[field], []);
  assert.deepEqual(s.categoryConstraints, {});
  assert.deepEqual(s.categoryTags, {});
  assert.deepEqual(s.preferences, {});
  assert.equal(s.intent, undefined);
  assert.equal(s.pending, undefined);
  assert.equal(old.city, "New York City");
});
test("conversation-only reset removes refinement context but preserves destination, DNA, cards and saved feedback", () => {
  const old = polluted(),
    s = resetConversation(old);
  assert.equal(s.city, old.city);
  assert.deepEqual(s.selected, old.selected);
  assert.deepEqual(s.cards, old.cards);
  assert.deepEqual(s.feedback, old.feedback);
  assert.deepEqual(s.history, []);
  assert.deepEqual(s.categoryConstraints, {});
  assert.deepEqual(s.constraints, []);
  assert.equal(s.intent, undefined);
  assert.equal(s.pending, undefined);
  assert.deepEqual(
    s.tags,
    old.selected.filter((t) => t.id.startsWith("urn:tag:")),
  );
});
test("Guided Mode and conversation use the same intent, state update and discovery pipeline", async () => {
  const d = deps();
  const a = await runTurn(
    fresh(),
    { message: "Tonight I want Indian food and nothing too touristy" },
    d,
  );
  const b = await runTurn(
    fresh(),
    { guided: { section: "Eat", constraints: ["touristy"] } },
    d,
  );
  assert.deepEqual(a.state.cards, b.state.cards);
  assert.deepEqual(a.state.categoryConstraints, b.state.categoryConstraints);
  assert.deepEqual(a.changed, b.changed);
  assert.deepEqual(a.state.tags, b.state.tags);
});
test("guided refinement bypasses failed provider and only updates the affected category", async () => {
  const d = deps();
  let modelCalls = 0;
  d.provider = {
    interpret: async () => {
      modelCalls++;
      throw Error();
    },
    choose: async () => {
      modelCalls++;
      throw Error();
    },
  };
  const original = fresh();
  const r = await runTurn(
    original,
    { guided: { section: "Eat", constraints: [] } },
    d,
  );
  assert.equal(modelCalls, 0);
  assert.deepEqual(r.changed, ["Eat"]);
  assert.deepEqual(
    r.state.cards.filter((c) => c.section === "Music"),
    original.cards.filter((c) => c.section === "Music"),
  );
});
test("sparse refinement preserves explicit constraints, cuisine, location and rejected IDs", async () => {
  const s = fresh();
  s.feedback = [
    {
      id: "rejected",
      section: "Eat",
      accepted: false,
      reason: "Not interested",
    },
  ];
  const attempts: Constraint[][] = [];
  const d = deps();
  d.workflow=async()=>({status:"ok",results:[{id:"urn:tag:ambience:place:quiet",name:"Quiet",type:"urn:tag:ambience:place"}]});
  d.discover = async (state, section, constraints, excluded) => {
    assert.equal(state.city, "New York City");
    assert.equal(section, "Eat");
    assert.ok(state.categoryTags?.Eat?.includes("urn:tag:cuisine:qloo:indian"));
    assert.deepEqual(excluded, ["rejected"]);
    attempts.push([...constraints]);
    return attempts.length < 3
      ? []
      : [
          {
            id: "success",
            name: "Dining",
            types: ["urn:entity:place"],
            detail: "",
            section,
          },
        ];
  };
  const r = await runTurn(
    s,
    { guided: { section: "Eat", constraints: ["crowded", "touristy"] } },
    d,
  );
  assert.deepEqual(attempts, [["crowded", "touristy"]]);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.state.relaxed, []);
  assert.deepEqual(r.state.cards, s.cards);
});
test("no stale hidden category or constraints carry into a new explicit guided refinement", async () => {
  const r = await runTurn(
    polluted(),
    { guided: { section: "Eat", constraints: [] } },
    deps(),
  );
  assert.ok(!r.state.hiddenCategories?.includes("Eat"));
  assert.ok(r.state.activeCategories?.includes("Eat"));
  assert.deepEqual(r.state.categoryConstraints.Eat, []);
  assert.equal(r.state.pending, undefined);
  assert.ok(!r.state.cards.some((c) => c.id === "old-food"));
});
test("rejected IDs do not leak into a newly reset Passport", async () => {
  const old = clearPassport(polluted());
  const clean = {
    ...fresh(),
    feedback: old.feedback,
    hiddenCategories: old.hiddenCategories,
  };
  const d = deps();
  d.discover = async (_s, section, _constraints, excluded) => {
    assert.deepEqual(excluded, []);
    return [
      {
        id: "old-food",
        name: "Dining",
        types: ["urn:entity:place"],
        detail: "",
        section,
      },
    ];
  };
  const r = await runTurn(
    clean,
    { guided: { section: "Eat", constraints: [] } },
    d,
  );
  assert.ok(r.state.cards.some((c) => c.id === "old-food"));
});
test("empty results expose real recovery actions that change state and rerun discovery", async () => {
  const d = deps();
  d.discover = async () => [];
  const empty = await runTurn(
    fresh(),
    { guided: { section: "Eat", constraints: ["touristy"] } },
    d,
  );
  assert.deepEqual(empty.state.recovery, ["Eat"]);
  assert.deepEqual(empty.state.cards, fresh().cards);
  assert.match(empty.message, /couldn’t apply that search/);
  let called = false;
  d.discover = async (_s, section, constraints) => {
    called = true;
    assert.deepEqual(constraints, []);
    return [
      {
        id: "recover",
        name: "Dining",
        types: ["urn:entity:place"],
        detail: "",
        section,
      },
    ];
  };
  const recovered = await runTurn(
    empty.state,
    { recovery: { section: "Eat", action: "allow-popular" } },
    d,
  );
  assert.ok(called);
  assert.deepEqual(recovered.state.recovery, []);
  assert.deepEqual(recovered.changed, ["Eat"]);
  assert.deepEqual(recovered.state.categoryConstraints.Eat, []);
});
test("quiet lookup failure preserves discoveries instead of silently weakening an explicit requirement", async () => {
  const d = deps();
  d.provider = {
    interpret: async () => {
      throw Error("unavailable");
    },
    choose: async () => [],
  };
  d.workflow = async () => {
    throw Error("tag lookup unavailable");
  };
  let attempts = 0;
  d.discover = async (_s, section) => {
    attempts++;
    return [
      {
        id: "dining",
        name: "Dining fixture",
        types: ["urn:entity:place"],
        detail: "",
        section,
      },
    ];
  };
  const s = fresh();
  const r = await runTurn(
    s,
    {
      message:
        "Tonight I want Indian food, quiet atmosphere, and nothing too touristy.",
    },
    d,
  );
  assert.equal(r.state.intent?.sections[0], "Eat");
  assert.ok(!r.state.hiddenCategories?.includes("Eat"));
  assert.equal(r.state.providerHealth, "unavailable");
  assert.match(r.message, /Taste Concierge is temporarily unavailable/);
  assert.equal(attempts, 0);
  assert.deepEqual(r.changed, []);
  assert.match(r.message,/could not verify.*quiet-atmosphere/);
  assert.deepEqual(
    r.state.cards.filter((c) => c.section === "Music"),
    s.cards.filter((c) => c.section === "Music"),
  );
  assert.deepEqual(r.state.relaxed, []);
  assert.deepEqual(clearPassport(r.state).cards, []);
});
test("conversation reset makes no tool calls and clears stored history", async () => {
  const d = deps();
  d.discover = async () => {
    throw Error("should not run");
  };
  d.workflow = async () => {
    throw Error("should not run");
  };
  const r = await runTurn(polluted(), { reset: "conversation" }, d);
  assert.deepEqual(r.state.history, []);
  assert.deepEqual(r.state.cards, polluted().cards);
  assert.deepEqual(r.changed, []);
});
test("provider health distinguishes configuration, actual failure and successful recovery", () => {
  assert.equal(providerHealth(false), "unconfigured");
  recordProviderHealth("unavailable");
  assert.equal(providerHealth(true), "unavailable");
  recordProviderHealth("healthy");
  assert.equal(providerHealth(true), "healthy");
});

test("every empty-result recovery action applies its advertised constraint change", async () => {
  const cases = [
    ["keep-concept", []],
    ["relax-quiet", ["touristy", "mainstream"]],
    ["allow-popular", ["crowded"]],
    ["closest", []],
  ] as const;
  for (const [action, expected] of cases) {
    const s = fresh();
    s.categoryConstraints.Eat = ["crowded", "touristy", "mainstream"];
    const d = deps();
    d.workflow=async()=>({status:"ok",results:[{id:"urn:tag:ambience:place:quiet",name:"Quiet",type:"urn:tag:ambience:place"}]});
    let applied: Constraint[] = [];
    d.discover = async (_s, section, constraints) => {
      applied = constraints;
      return [
        {
          id: "recovery",
          name: "Dining",
          types: ["urn:entity:place"],
          detail: "",
          section,
        },
      ];
    };
    const r = await runTurn(s, { recovery: { section: "Eat", action } }, d);
    assert.deepEqual(applied, expected);
    assert.deepEqual(r.state.categoryConstraints.Eat, expected);
  }
});
test("a newly confirmed primary cuisine replaces the previous cuisine filter in Eat only", async () => {
  const s = fresh();
  const newTag = {
    id: "urn:tag:cuisine:qloo:japanese",
    name: "Japanese",
    types: ["urn:tag:cuisine"],
    detail: "Japanese cuisine",
  };
  s.pending = {
    query: "Japanese cuisine",
    candidates: [newTag],
    sections: ["Eat"],
    constraints: [],
  };
  const r = await runTurn(s, { tagChoice: newTag.id }, deps());
  assert.deepEqual(r.state.categoryTags.Eat, [newTag.id]);
  assert.ok(r.state.selected.some((t) => t.name === "Indian")); // DNA remains the original profile.
  assert.deepEqual(
    r.state.cards.filter((c) => c.section === "Music"),
    s.cards.filter((c) => c.section === "Music"),
  );
});

test("category-scoped concepts never become another category's refinement filters", async () => {
  const { sectionTags } = await import("../src/agent/session.ts");
  const s = fresh();
  const tag = {
    id: "urn:tag:genre:media:comedy",
    name: "Comedy",
    types: ["urn:tag:genre:media"],
    detail: "",
  };
  s.tags.push(tag);
  s.categoryTags!.Culture = [tag.id];
  assert.ok(sectionTags(s, "Culture").some((t) => t.id === tag.id));
  assert.ok(!sectionTags(s, "Music").some((t) => t.id === tag.id));
  assert.ok(!sectionTags(s, "Eat").some((t) => t.id === tag.id));
});
test("hidden category disappears from the rendering projection without destroying its stored cards", async () => {
  const { passportView } = await import("../src/workspace/state.ts");
  const s = normalizeSession(fresh());
  s.hiddenCategories = ["Eat"];
  s.activeCategories = ["Music"];
  const view = passportView(s, "");
  assert.ok(!view.cards.some((c) => c.section === "Eat"));
  assert.ok(s.cards.some((c) => c.section === "Eat"));
  assert.equal(view.session, s);
});

test("constrained model-selected ranking uses native filters instead of an MCP contract that cannot apply them", async () => {
  const d = deps();
  d.provider = {
    interpret: async () => ({
      kind: "refine",
      seeds: [],
      concepts: [],
      sections: ["Eat"],
      constraints: ["touristy"],
      strategy: "rank",
    }),
    choose: async () => [{ name: "qloo_rank", arguments: {} }],
  };
  d.tools = async () => [{ name: "qloo_rank", inputSchema: {} }];
  let native = false;
  d.workflow = async () => {
    throw Error("MCP must not bypass the constraints");
  };
  d.discover = async (_s, section, constraints, _excluded, rank) => {
    native = true;
    assert.deepEqual(constraints, ["touristy"]);
    assert.ok(rank);
    return [
      {
        id: "ranked",
        name: "Dining",
        types: ["urn:entity:place"],
        detail: "",
        section,
      },
    ];
  };
  const r = await runTurn(
    fresh(),
    { message: "Rank my dining shortlist and avoid touristy places" },
    d,
  );
  assert.ok(native);
  assert.deepEqual(r.changed, ["Eat"]);
});
