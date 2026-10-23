import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TasteDNA,
  TranslationMap,
  DiscoveryCard,
  PassportSections,
} from "../app/components/passport.tsx";
import { ComparisonPanel } from "../app/components/cultural.tsx";
import {
  withEvidence,
  bridgeRoutes,
  sparseSections,
} from "../src/passport/evidence.ts";
import { discoveryQueries, mixPools } from "../src/agent/strategy.ts";
import { normalizeSession } from "../src/agent/session.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import { interpret } from "../src/agent/intent.ts";
import type { Candidate } from "../src/passport/model.ts";
import type { Entity } from "../src/qloo/types.ts";
const entityId = "00000000-0000-0000-0000-000000000030";
const artist: Candidate = {
  id: "00000000-0000-0000-0000-000000000031",
  name: "Resolved artist",
  types: ["urn:entity:artist"],
  detail: "",
};
const movie: Candidate = {
  id: "00000000-0000-0000-0000-000000000032",
  name: "Resolved film",
  types: ["urn:entity:movie"],
  detail: "",
};
const cuisine: Candidate = {
  id: "urn:tag:cuisine:qloo:indian",
  name: "Indian",
  types: ["urn:tag:cuisine"],
  detail: "Qloo concept for Indian cuisine",
};
const raw: Entity = {
  entity_id: entityId,
  name: "Returned dining",
  type: "urn:entity:place",
  properties: {
    address: "Returned address",
    geocode: { city: "Toronto", country: "Canada" },
  },
  query: { affinity: 0.125 },
  tags: [
    {
      id: "urn:tag:genre:place:restaurant",
      name: "Restaurant",
      type: "urn:tag:genre:place",
    },
  ],
};
const base: Record<string, string> = {
  "filter.type": "urn:entity:place",
  "signal.interests.entities": `${artist.id},${movie.id}`,
  "filter.tags": `urn:tag:genre:place:restaurant,${cuisine.id}`,
  "operator.filter.tags": "intersection",
  "filter.location.query": "Toronto",
  "filter.location.radius": "0",
  take: "20",
};
function grounded() {
  return withEvidence(
    [
      {
        id: entityId,
        name: raw.name,
        types: ["urn:entity:place"],
        detail: "",
        section: "Eat",
        address: "Returned address",
        affinity: 999,
      },
    ],
    [raw],
    base,
    [artist, movie, cuisine],
    "Toronto",
  )[0];
}
function state() {
  return normalizeSession({
    id: "cultural-test",
    revision: 0,
    expires: Date.now() + 10000,
    city: "Toronto",
    selected: [artist, movie, cuisine],
    tags: [cuisine],
    constraints: [],
    categoryConstraints: {},
    cards: [
      grounded(),
      {
        ...artist,
        id: "existing-music",
        name: "Returned artist",
        section: "Music",
      },
    ],
    previous: [],
    feedback: [],
    notices: [],
  });
}
test("Taste DNA renders only confirmed signals and exposes actual type, ID and resolution source", () => {
  const html = renderToStaticMarkup(
    createElement(TasteDNA, {
      signals: [artist, cuisine],
      onRemove: () => {},
      disabled: false,
    }),
  );
  assert.match(html, /Resolved artist/);
  assert.match(html, /Indian/);
  assert.match(html, /entity search/);
  assert.match(html, /tag workflow/);
  assert.match(html, /urn:tag:cuisine:qloo:indian/);
  assert.doesNotMatch(html, /Resolved film|confidence|personality|%/);
});
test("Bridge Map draws only actual query-input relationships, with no unused signal connection", () => {
  const card = grounded();
  const unused = { ...movie, id: "unused", name: "Unused film" };
  const routes = bridgeRoutes([card], [artist, cuisine, unused]);
  assert.equal(routes.length, 1);
  assert.deepEqual(
    routes[0].inputs.map((c) => c.id),
    [artist.id, cuisine.id],
  );
  const html = renderToStaticMarkup(
    createElement(TranslationMap, {
      signals: [artist, cuisine, unused],
      result: {
        city: "Toronto",
        selected: [artist, cuisine, unused],
        cards: [card],
        notices: [],
        explanation: "",
      },
    }),
  );
  assert.match(html, /data-query-receipt/);
  assert.match(html, /QLOO CULTURAL INTELLIGENCE/);
  assert.match(html, /Toronto/);
  assert.doesNotMatch(html, /Unused film/);
  assert.match(html, /Individual taste-to-place links are not provided/);
});
test("Bridge Map shows no connection for missing or mismatched result evidence", () => {
  const card = grounded();
  assert.deepEqual(
    bridgeRoutes([{ ...card, id: "wrong-result" }], [artist]),
    [],
  );
  assert.deepEqual(
    bridgeRoutes([{ ...card, evidence: undefined }], [artist]),
    [],
  );
  const html = renderToStaticMarkup(
    createElement(TranslationMap, { signals: [artist] }),
  );
  assert.doesNotMatch(html, /data-query-receipt|class="bridge-route /);
  assert.match(html, /Connections appear only/);
});
test("Qloo evidence uses raw returned fields and excludes headers and fabricated card affinity", () => {
  const cards = withEvidence(
    [{ ...grounded(), affinity: 999 }],
    [raw],
    { ...base, "x-api-key": "private-value", Authorization: "private-header" },
    [artist, movie, cuisine],
    "Toronto",
  );
  assert.equal(cards[0].affinity, 0.125);
  assert.equal(cards[0].evidence?.result.affinity?.value, 0.125);
  assert.equal(cards[0].evidence?.result.geocode?.city, "Toronto");
  assert.deepEqual(cards[0].evidence?.result.tags, raw.tags);
  assert.doesNotMatch(
    JSON.stringify(cards[0].evidence),
    /private-value|private-header|Authorization|x-api-key/,
  );
  const html = renderToStaticMarkup(
    createElement(DiscoveryCard, {
      card: cards[0],
      onFeedback: () => {},
    }),
  );
  assert.doesNotMatch(html, /Technical details|query.affinity|0\.125|physical place filter/);
  assert.match(html, /Returned address/);
  assert.match(html, /Returned dining/);
  assert.doesNotMatch(
    html,
    /999|confidence|rating|neighborhood|probability.*%/,
  );
});
test("missing raw affinity never becomes a displayed metric even if the input card has one", () => {
  const missing = { ...raw, query: {} };
  const card = withEvidence(
    [{ ...grounded(), affinity: 999 }],
    [missing],
    base,
    [artist, movie, cuisine],
    "Toronto",
  )[0];
  assert.equal(card.affinity, undefined);
  assert.equal(card.evidence?.result.affinity, undefined);
  const html = renderToStaticMarkup(
    createElement(DiscoveryCard, {
      card,
      onFeedback: () => {},
    }),
  );
  assert.doesNotMatch(html, /Qloo affinity|Actual relevance field|999/);
});
test("Familiar keeps direct taste filters; Explore broadens only profile tags while retaining grounded signals and destination", () => {
  const s = state();
  const familiar = discoveryQueries(base, s, "Eat", "familiar");
  const explore = discoveryQueries(base, s, "Eat", "explore");
  assert.ok(familiar[0].params["filter.tags"].includes(cuisine.id));
  assert.ok(!explore[0].params["filter.tags"].includes(cuisine.id));
  assert.equal(explore[0].params["signal.interests.tags"], cuisine.id);
  assert.equal(
    explore[0].params["signal.interests.entities"],
    base["signal.interests.entities"],
  );
  assert.equal(explore[0].params["filter.location.query"], "Toronto");
  assert.equal(explore[0].params["filter.type"], "urn:entity:place");
  assert.equal(explore[0].params["filter.location.radius"], "0");
});
test("explicit primary concepts and hard entity exclusions survive Explore query composition", () => {
  const s = state();
  s.intent = {
    kind: "refine",
    seeds: [],
    concepts: ["Indian cuisine"],
    sections: ["Eat"],
    constraints: [],
    strategy: "discover",
  };
  const params = { ...base, "filter.exclude.entities": "rejected-id" };
  const query = discoveryQueries(params, s, "Eat", "explore")[0];
  assert.ok(query.params["filter.tags"].includes(cuisine.id));
  assert.equal(query.params["filter.exclude.entities"], "rejected-id");
});
test("Balanced blends distinct pools with deduplication and preserves source receipts", () => {
  const queries = discoveryQueries(base, state(), "Eat", "balanced");
  assert.equal(queries.length, 2);
  assert.deepEqual(
    queries.map((q) => q.pool),
    ["direct", "adjacent"],
  );
  const direct = grounded(),
    adjacent = { ...grounded(), id: "adjacent", name: "Adjacent dining" };
  const mixed = mixPools([[direct], [direct, adjacent]]);
  assert.deepEqual(
    mixed.map((c) => c.id),
    [direct.id, adjacent.id],
  );
  assert.equal(mixed[0].evidence?.queryId, direct.evidence?.queryId);
  assert.deepEqual(mixed[0].evidence?.inputs, direct.evidence?.inputs);
});
test("no grounded taste signal means no generic city query is issued", () => {
  const s = state();
  s.selected = [];
  s.tags = [];
  const generic = {
    "filter.type": "urn:entity:place",
    "filter.location.query": "Toronto",
    "filter.tags": "urn:tag:genre:place:restaurant",
  };
  assert.deepEqual(discoveryQueries(generic, s, "Eat", "explore"), []);
});
test("familiarity mode changes canonical category state and updates only that category", async () => {
  const s = state();
  let chosen = "";
  const r = await runTurn(
    s,
    { familiarity: { section: "Eat", mode: "explore" } },
    {
      tools: async () => [],
      workflow: async () => ({ status: "ok" }),
      discover: async (current, section) => {
        chosen = current.categoryModes![section]!;
        return [{ ...grounded(), name: "Broader dining" }];
      },
    },
  );
  assert.equal(chosen, "explore");
  assert.equal(r.state.categoryModes.Eat, "explore");
  assert.deepEqual(r.changed, ["Eat"]);
  assert.deepEqual(
    r.state.cards.filter((c) => c.section === "Music"),
    s.cards.filter((c) => c.section === "Music"),
  );
  assert.deepEqual(s.categoryModes, {});
});
test("sparse categories show only valid returned matches and offer wider exploration", () => {
  assert.deepEqual(sparseSections([grounded()], ["Eat"]), ["Eat"]);
  const s = state();
  s.cards = [grounded()];
  const html = renderToStaticMarkup(
    createElement(PassportSections, {
      result: {
        city: s.city,
        selected: s.selected,
        cards: s.cards,
        notices: [],
        explanation: "",
      },
      feedback: {},
      onFeedback: () => {},
    }),
  );
  assert.match(html, /A smaller selection/);
  assert.match(html, /Balanced or Explore/);
  assert.equal((html.match(/class="discovery-card /g) ?? []).length, 1);
});
test("model-only baseline is completely hidden when unavailable", () => {
  const html = renderToStaticMarkup(
    createElement(ComparisonPanel, { cards: [grounded()] }),
  );
  assert.equal(html, "");
});
test("a generated baseline is labelled unverified and kept separate from Qloo cards", () => {
  const html = renderToStaticMarkup(
    createElement(ComparisonPanel, {
      baseline: {
        text: "Isolated model protocol fixture",
        source: "model-only",
        model: "test-model",
        generatedAt: "2026-10-14T00:00:00Z",
      },
      cards: [grounded()],
    }),
  );
  assert.match(html, /General AI suggestions/);
  assert.match(html, /unverified/i);
  assert.match(html, /Your personalized discoveries/);
  assert.match(html, /1 discovery/);
  assert.doesNotMatch(html, /class="discovery-card/);
});
test("Toronto relocation is a supported destination without storing demo identity in intent", () => {
  const i = interpret(
    "I'm relocating from Bengaluru to Toronto. I love A.R. Rahman, Interstellar and Indian cuisine.",
  );
  assert.equal(i.destination, "Toronto");
  assert.ok(!JSON.stringify(i).includes("software engineer"));
  assert.equal(i.seeds.length, 3);
});

test("identical mode queries degrade honestly rather than claiming an adjacent pool", () => {
  const s = state();
  s.selected = [artist];
  s.tags = [];
  const params = {
    "filter.type": "urn:entity:artist",
    "signal.interests.entities": artist.id,
    "signal.location.query": "Toronto",
    take: "20",
    "bias.content_based": "0.5",
  };
  const queries = discoveryQueries(params, s, "Music", "balanced");
  assert.equal(queries.length, 1);
  assert.equal(queries[0].pool, "profile");
  assert.match(queries[0].note!, /do not support a distinct broader query/);
});
