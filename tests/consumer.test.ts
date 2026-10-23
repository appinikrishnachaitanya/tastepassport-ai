import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runTurn } from "../src/agent/orchestrator.ts";
import {
  normalizeSession,
  clearPassport,
  resetConversation,
} from "../src/agent/session.ts";
import { passportSnapshot, restoreSnapshot } from "../src/account/snapshot.ts";
import { PassportSections } from "../app/components/passport.tsx";
import {
  PassportCover,
  ConnectionExplorer,
} from "../app/components/passport-overview.tsx";
import type { Card } from "../src/passport/model.ts";
import { dayOutOptions, dayOutText } from "../src/passport/day-out.ts";
import DayOutPlan from "../app/components/day-out.tsx";
import { normalizeEntity } from "../src/qloo/normalizer.ts";
const signal = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Real-shaped protocol taste",
  types: ["urn:entity:artist"],
  detail: "Protocol fixture",
};
function card(id: string): Card {
  return {
    ...signal,
    id,
    name: `Protocol discovery ${id}`,
    section: "Eat",
    evidence: {
      source: "Qloo",
      operation: "/v2/insights/",
      queryId: "protocol-query",
      recordedAt: "2026-10-16T00:00:00Z",
      destination: "Toronto",
      locality: "physical-city",
      mode: "familiar",
      pool: "direct",
      inputs: [
        {
          id: signal.id,
          name: signal.name,
          types: signal.types,
          role: "entity-signal",
        },
      ],
      params: { "filter.type": "urn:entity:place" },
      result: { id, type: "urn:entity:place", tags: [{ id: "urn:tag:genre:place:restaurant", type: "urn:tag:genre:place", name: "Restaurant" }] },
    },
  };
}
function state() {
  return normalizeSession({
    id: "private-guest-token",
    revision: 1,
    expires: Date.now() + 10000,
    city: "Toronto",
    selected: [signal, { ...signal, id: "second" }, { ...signal, id: "third" }],
    tags: [],
    constraints: [],
    categoryConstraints: {},
    cards: [card("one"), card("two"), card("three"), card("four")],
    previous: [],
    feedback: [],
    notices: [],
    history: [{ role: "user", text: "private conversation" }],
  });
}
test("day-out excludes nonlocal, mismatched, ungrounded and duplicate discoveries", () => {
  const local = card("local");
  const audience = card("audience");
  audience.evidence!.locality = "audience-context";
  const otherCity = card("other-city");
  otherCity.evidence!.destination = "London";
  const mismatched = card("mismatch");
  mismatched.evidence!.result.id = "different";
  const music = { ...card("music"), section: "Music" as const };
  assert.deepEqual(dayOutOptions([local, local, audience, otherCity, mismatched, music, { ...card("missing"), evidence: undefined }], "Toronto"), [local]);
});
test("day-out export contains real selections and explicit availability limits", () => {
  const text = dayOutText("Toronto", [{activity:"Culture",time:"11:00",card:{ ...card("chosen"), address: "Fixture address" }}]);
  assert.match(text, /Protocol discovery chosen/);
  assert.match(text, /Fixture address/);
  assert.match(text, /Check opening hours, travel times and availability/);
  assert.match(text, /No booking has been made/);
  assert.doesNotMatch(text, /private-guest-token|private conversation/);
});
test("day-out starts with available local activities without forcing empty categories", () => {
  const session = state();
  const markup = renderToStaticMarkup(createElement(DayOutPlan, { passport: { city: session.city, selected: session.selected, cards: session.cards, notices: [], explanation: "" }, disabled: false }));
  assert.match(markup, /day-out-Eat/);
  assert.doesNotMatch(markup, /id="day-out-Coffee"/);
  assert.match(markup, /What would you like to do/);
  assert.match(markup, /chosen times are suggestions, not verified opening hours or reservations/);
  assert.match(markup, /Download my plan/);
});
const deps = {
  tools: async () => [],
  workflow: async () => ({ status: "ok", results: [] }),
  discover: async () => [card("new")],
};
test("My Vibe retains real cards across replanning and permits clearing a card no longer in the feed", async () => {
  let s = (
    await runTurn(state(), { feedback: { id: "one", accepted: true } }, deps)
  ).state;
  assert.equal(s.savedCards[0].id, "one");
  s = (await runTurn(s, { guided: { section: "Eat", constraints: [] } }, deps))
    .state;
  assert.ok(!s.cards.some((c) => c.id === "one"));
  assert.equal(s.savedCards[0].id, "one");
  s = (
    await runTurn(
      s,
      { feedback: { id: "one", accepted: true, clear: true } },
      deps,
    )
  ).state;
  assert.equal(s.savedCards.length, 0);
  assert.ok(!s.feedback.some((f) => f.id === "one"));
});
test("reset conversation preserves shortlist; New Passport clears it", () => {
  const s = state();
  s.savedCards = [card("one")];
  assert.equal(resetConversation(s).savedCards.length, 1);
  assert.equal(clearPassport(s).savedCards.length, 0);
});
test("account snapshot strips sessions, history and comparisons; restore uses a fresh token and preserves evidence", () => {
  const s = state();
  s.savedCards = [card("one")];
  const snap = passportSnapshot(s);
  const raw = JSON.stringify(snap);
  assert.ok(!raw.includes("private-guest-token"));
  assert.ok(!raw.includes("private conversation"));
  assert.ok(!("history" in snap));
  assert.ok(!("comparison" in snap));
  const restored = restoreSnapshot(snap);
  assert.notEqual(restored.id, s.id);
  assert.equal(restored.revision, 0);
  assert.equal(restored.history.length, 0);
  assert.equal(restored.savedCards[0].evidence?.source, "Qloo");
  assert.equal(restored.city, "Toronto");
  restored.cards.length = 0;
  assert.equal(snap.cards.length, 4);
});
test("saved Passport restores three My Vibe choices and section preferences after a later update", () => {
  const session = state();
  session.savedCards = [card("one"), card("two"), card("three")];
  session.feedback = session.savedCards.map(({ id }) => ({ id, section: "Eat" as const, accepted: true }));
  session.queryPreferences = { Eat: { priceMax: 2, businessRatingMin: 4.5 }, Coffee: { priceMax: 1 } };
  session.categoryConstraints = { Eat: ["crowded"] };
  const earlier = passportSnapshot({ ...session, savedCards: session.savedCards.slice(0, 1) });
  const latest = passportSnapshot(session);
  assert.equal(restoreSnapshot(earlier).savedCards.length, 1);
  const restored = restoreSnapshot(latest);
  assert.deepEqual(restored.savedCards.map(({ id }) => id), ["one", "two", "three"]);
  assert.deepEqual(restored.queryPreferences, session.queryPreferences);
  assert.deepEqual(restored.categoryConstraints, session.categoryConstraints);
});
test("restore rejects fabricated or incompatible account snapshots", () => {
  const snap = passportSnapshot(state());
  assert.throws(() => restoreSnapshot({ ...snap, version: 88 }));
  assert.throws(() =>
    restoreSnapshot({
      ...snap,
      cards: [{ ...card("bad"), evidence: undefined }],
    }),
  );
  assert.throws(() => restoreSnapshot({ ...snap, city: "https://invalid.example" }));
  assert.equal(restoreSnapshot({ ...snap, city: "Bengaluru" }).city, "Bengaluru");
});
test("curated preview retains true total and access to all cards without manufacturing highlights", () => {
  const s = state();
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
  assert.equal((html.match(/data-entity-id=/g) ?? []).length, 3);
  assert.match(html, /See all 4 eat discoveries/);
  assert.doesNotMatch(html, /Protocol discovery four/);
});
test("consumer cover and connection reveal use real query relationships rather than invented taste attribution", () => {
  const s = state();
  const passport = {
    city: s.city,
    selected: s.selected,
    cards: s.cards,
    notices: [],
    explanation: "",
  };
  const cover = renderToStaticMarkup(
    createElement(PassportCover, {
      passport,
      origin: "",
      onConnections: () => {},
    }),
  );
  assert.match(cover, /Your Toronto/);
  assert.match(cover, /Explore taste insights/);
  assert.doesNotMatch(cover, /Why these suggestions\?/);
  assert.doesNotMatch(cover, /Bengaluru|confidence/);
  const html = renderToStaticMarkup(
    createElement(ConnectionExplorer, { passport }),
  );
  assert.match(html, /Real-shaped protocol taste/);
  assert.match(html, /Protocol discovery one/);
  assert.match(html, /Individual contribution evidence was not returned/);
  assert.doesNotMatch(html, /private-guest-token/);
  passport.cards[0].intelligence=normalizeEntity({entity_id:passport.cards[0].id,name:'Fixture result',query:{explainability:{'signal.interests.entities':[{entity_id:signal.id,score:.6}]}}});
  const grounded=renderToStaticMarkup(createElement(ConnectionExplorer,{passport}));
  assert.match(grounded,/Associated via cross-domain audience affinity with Real-shaped protocol taste/);
  assert.match(grounded,/rather than a direct culinary link/);
});

test("account writes require the actual browser origin, including local Next Host routing", async () => {
  const { sameOrigin, requestOrigin } = await import(
    "../src/account/policy.ts"
  );
  const request = new Request("http://localhost:3001/api/account", {
    headers: { Host: "127.0.0.1:3001", Origin: "http://127.0.0.1:3001" },
  });
  assert.equal(sameOrigin(request, ""), true);
  assert.equal(requestOrigin(request, ""), "http://127.0.0.1:3001");
  assert.equal(
    sameOrigin(
      new Request(request, {
        headers: { Host: "127.0.0.1:3001", Origin: "https://other.example" },
      }),
      "",
    ),
    false,
  );
  assert.equal(
    sameOrigin(
      new Request(request, { headers: { Host: "127.0.0.1:3001" } }),
      "",
    ),
    false,
  );
});
test("configured public origin takes precedence and ignores spoofed forwarding headers", async () => {
  const { sameOrigin } = await import("../src/account/policy.ts");
  const request = new Request("http://localhost/api/account", {
    headers: {
      Host: "app.example",
      Origin: "https://app.example",
      "X-Forwarded-Host": "evil.example",
    },
  });
  assert.equal(sameOrigin(request, "https://app.example"), true);
  assert.equal(sameOrigin(request, "https://evil.example"), false);
  assert.equal(sameOrigin(request, "https://user:password@app.example"), false);
});
