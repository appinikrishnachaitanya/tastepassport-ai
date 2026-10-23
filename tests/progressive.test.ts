import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page.tsx";
import { MoveForm, TasteConfirmation } from "../app/components/onboarding.tsx";
import ConciergeDrawer from "../app/components/concierge.tsx";
import FeedbackDialog from "../app/components/feedback.tsx";
import type { Candidate } from "../src/passport/model.ts";
const noop = () => {};
const signal: Candidate = {
  id: "ui-protocol-id",
  name: "Confirmed protocol taste",
  types: ["urn:entity:artist"],
  detail: "Protocol metadata",
};

test("first load has one clear onboarding action without agent panels or advanced disclosures", () => {
  const html = renderToStaticMarkup(createElement(Home));
  assert.match(html, /Build your/);
  assert.match(html, /Moving to/);
  assert.match(html, /What already feels like you/);
  assert.match(html, /Find my taste matches/);
  assert.doesNotMatch(
    html,
    /Taste Concierge|Agent execution activity|THE DEMO JOURNEY|View Qloo evidence|cultural-reveal|guided-panel|split-workspace/,
  );
  assert.equal((html.match(/class="primary-button/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Reset conversation|New Passport/);
});
test("onboarding requires city and one taste, uses a single taste input and accessible removable chips", () => {
  const props = {
    city: "Toronto",
    origin: "",
    draft: ["Artist"],
    disabled: false,
    onCity: noop,
    onOrigin: noop,
    onDraft: noop,
    onSubmit: noop,
  };
  const html = renderToStaticMarkup(createElement(MoveForm, props));
  assert.match(html, /id="taste-input"/);
  assert.match(html, /aria-label="Remove Artist"/);
  const cta = html.match(
    /<button[^>]*class="primary-button build-map"[^>]*>/,
  )?.[0];
  assert.ok(cta);
  assert.doesNotMatch(cta, /disabled/);
  for (const invalid of [
    { ...props, city: "" },
    { ...props, draft: [] },
  ])
    assert.match(
      renderToStaticMarkup(createElement(MoveForm, invalid)),
      /class="primary-button build-map"[^>]*disabled/,
    );
});
test("confirmation offers actual candidates inline, explicit selection, replacement and real strategy choices", () => {
  const props = {
    items: [
      { index: 0, item: { query: "Protocol input", candidates: [signal] } },
    ],
    chosen: {},
    disabled: false,
    complete: false,
    mode: "familiar" as const,
    onMode: noop,
    onChoose: noop,
    onRemove: noop,
    onReplace: noop,
    onBack: noop,
    onSubmit: noop,
  };
  const html = renderToStaticMarkup(createElement(TasteConfirmation, props));
  assert.match(html, /Review your/);
  assert.match(html, /select/);
  assert.match(html, /ui-protocol-id/);
  assert.match(html, /Replace taste/);
  assert.match(html, /Feels like home/);
  assert.match(html, /Balanced/);
  assert.match(html, /Help me explore/);
  assert.match(html, /Create my TastePassport/);
  assert.doesNotMatch(html, /class="confirmation-card confirmed"/);
  const confirmed = renderToStaticMarkup(
    createElement(TasteConfirmation, {
      ...props,
      chosen: { 0: signal.id },
      complete: true,
    }),
  );
  assert.match(confirmed, /confirmation-card confirmed/);
});
test("assistant remains a closed modal with accessible close control and manual tab content slot", () => {
  const html = renderToStaticMarkup(
    createElement(ConciergeDrawer, {
      open: false,
      onClose: noop,
      children: createElement("button", null, "Refine manually"),
    }),
  );
  assert.match(html, /<dialog[^>]*aria-labelledby="concierge-title"/);
  assert.doesNotMatch(html, /<dialog[^>]*\sopen/);
  assert.match(html, /Close Taste Concierge/);
  assert.match(html, /Refine manually/);
});
test("feedback modal retains all seven adaptive reasons and requires an explicit choice", () => {
  const html = renderToStaticMarkup(
    createElement(FeedbackDialog, {
      card: { ...signal, section: "Eat" },
      onClose: noop,
      onSubmit: noop,
    }),
  );
  assert.equal((html.match(/type="radio"/g) ?? []).length, 7);
  assert.match(html, /Too mainstream/);
  assert.match(html, /Wrong atmosphere/);
  assert.match(html, /Update my Food passport/);
  assert.doesNotMatch(html, /checked/);
});
