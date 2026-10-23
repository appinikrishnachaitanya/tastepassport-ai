import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cityDate, nextWeekend, planFromSession, calendarFile, mergeSavedPlan, savedStopActivity, type SavedPlan } from "../src/account/plans.ts";
import { normalizeSession } from "../src/agent/session.ts";
import type { Card, Section } from "../src/passport/model.ts";
import UpcomingPlans from "../app/components/plans.tsx";
const now = new Date("2026-10-17T12:00:00Z");
function card(id: string, section: Section): Card {
  return { id, section, name: `Protocol ${id}`, detail: "Test fixture", address: "Fixture address", types: ["urn:entity:place"], evidence: {
    source: "Qloo", operation: "/v2/insights/", queryId: "fixture-query", recordedAt: now.toISOString(), destination: "Toronto", locality: "physical-city", mode: "familiar", pool: "direct", inputs: [], params: {}, result: { id, type: "urn:entity:place", tags: [{ id: "urn:tag:genre:place:fixture", type: "urn:tag:genre:place", name: section === "Coffee" ? "Coffee shop" : section === "Culture" ? "Museum" : "Restaurant" }] },
  } };
}
function state() {
  return normalizeSession({ id: "private-session", city: "Toronto", revision: 3, expires: Date.now() + 10000, selected: [], tags: [], constraints: [], categoryConstraints: {}, cards: [card("coffee", "Coffee"), card("culture", "Culture"), card("eat", "Eat"), card("eat2", "Eat")], previous: [], feedback: [], notices: [] });
}
const input = { revision: 3, ids: ["coffee", "culture", "eat"], date: "2026-10-18", stopTimes: ["10:00", "12:00", "19:00"] };
test("saving a changed time replaces the same dated outing in Upcoming plans",()=>{
  const prior:SavedPlan={id:"same",city:"Toronto",scheduled_date:"2099-10-18",time_zone:"America/Toronto",stop_times:["11:00"],stops:[card("coffee","Coffee")],created_at:"2026-10-17"};
  const updated={...prior,stop_times:["12:00"]};
  const plans=mergeSavedPlan([prior],updated);
  assert.equal(plans.length,1);
  assert.equal(plans[0].stop_times?.[0],"12:00");
  const html=renderToStaticMarkup(createElement(UpcomingPlans,{plans,busy:false,error:"",onDelete:()=>{},onRetry:()=>{}}));
  assert.match(html,/12:00/);
  assert.doesNotMatch(html,/11:00/);
});
test("saved cinema and nightlife keep their specific planner activity when reopened",()=>{
  const cinema=card("cinema","Culture"); cinema.name="Prince Charles Cinema";
  cinema.evidence!.result.tags=[{id:"urn:tag:category:place:movie_theater",name:"Movie theater",type:"urn:tag:category:place"}];
  const club=card("club","Culture"); club.name="Evening club";
  club.evidence!.result.tags=[{id:"urn:tag:category:place:night_club",name:"Night club",type:"urn:tag:category:place"}];
  assert.equal(savedStopActivity(cinema),"Cinema");
  assert.equal(savedStopActivity(club),"Nightlife");
  assert.equal(savedStopActivity(card("culture","Culture")),"Culture");
});
test("plans copy only server-held current stop data and never client snapshots", () => {
  const original = state();
  const plan = planFromSession(original, { ...input, stops: [{ name: "Fabricated" }], user_id: "someone-else" }, now);
  assert.deepEqual(plan.stops.map((s) => s.name), ["Protocol coffee", "Protocol culture", "Protocol eat"]);
  assert.equal(plan.time_zone, "America/Toronto");
  original.cards[0].name = "Changed later";
  assert.equal(plan.stops[0].name, "Protocol coffee");
  assert.doesNotMatch(JSON.stringify(plan), /private-session|someone-else|Fabricated/);
});
test("plan save rejects stale revision, duplicates, unknown IDs and repeated categories", () => {
  for (const change of [{ revision: 2 }, { ids: ["coffee", "coffee"] }, { ids: ["invented"] }, { ids: ["eat", "eat2"] }, { ids: [] }, { ids: ["coffee", "culture", "eat", "eat2"] }]) {
    assert.throws(() => planFromSession(state(), { ...input, ...change }, now));
  }
});
test("plan save excludes hidden categories, wrong-city results and audience-context entities", () => {
  const hidden = state(); hidden.hiddenCategories = ["Eat"];
  assert.throws(() => planFromSession(hidden, input, now));
  const wrong = state(); wrong.cards[0].evidence!.destination = "London";
  assert.throws(() => planFromSession(wrong, input, now));
  const audience = state(); audience.cards[0].evidence!.locality = "audience-context";
  assert.throws(() => planFromSession(audience, input, now));
});
test("five-activity plans preserve requested order and allow distinct cinema and nightlife stops", () => {
  const s=state();
  const cinema=card("cinema","Culture");
  cinema.evidence!.result.tags=[{id:"urn:tag:category:place:movie_theater",name:"Movie theater",type:"urn:tag:category:place"}];
  const nightlife=card("nightlife","Culture");
  nightlife.evidence!.result.tags=[{id:"urn:tag:category:place:night_club",name:"Night club",type:"urn:tag:category:place"}];
  s.cards.push(cinema,nightlife);
  const ids=["cinema","eat","nightlife","coffee","culture"];
  const plan=planFromSession(s,{...input,ids,stopTimes:["10:00","12:00","15:00","17:00","20:00"]},now);
  assert.deepEqual(plan.stops.map(stop=>stop.id),ids);
});
test("plan dates are real future destination-local dates", () => {
  for (const date of ["2026-10-16", "2026-02-30", "tomorrow", "", "2026-10-18T12:00Z"]) assert.throws(() => planFromSession(state(), { ...input, date }, now));
  assert.equal(planFromSession(state(), { ...input, date: "2026-10-17" }, now).scheduled_date, "2026-10-17");
  assert.equal(cityDate("Toronto", new Date("2026-10-18T01:00:00Z")), "2026-10-17");
  assert.equal(cityDate("Tokyo", new Date("2026-10-18T01:00:00Z")), "2026-10-18");
});
test("next-weekend shortcut uses Saturday on the destination calendar", () => {
  assert.equal(nextWeekend("Toronto", now), "2026-10-24");
  assert.equal(nextWeekend("Toronto", new Date("2026-10-18T01:00:00Z")), "2026-10-24");
});
test("calendar export gives each stop a local start time, escapes content and folds UTF-8 lines", () => {
  const plan = planFromSession(state(), input, now);
  plan.stops[0].name = "Café, ".repeat(30) + "\r\nBEGIN:VALARM";
  const text = calendarFile({ id: "fixture-id", ...plan });
  assert.match(text, /DTSTART;TZID=America\/Toronto:20261018T100000/);
  assert.match(text, /DTSTART;TZID=America\/Toronto:20261018T190000/);
  assert.doesNotMatch(text, /^BEGIN:VALARM$/m);
  assert.ok(text.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75));
  assert.match(text.replace(/\r\n /g, ""), /Suggested start time\\, not a booking/);
});
test("plan times align to selected stops and calendar keeps old all-day plans readable", () => {
  for (const stopTimes of [["10:00"], ["12:00", "10:00", "19:00"], ["25:00", "12:00", "19:00"]])
    assert.throws(() => planFromSession(state(), { ...input, stopTimes }, now));
  const plan = planFromSession(state(), input, now);
  assert.deepEqual(plan.stop_times, input.stopTimes);
  assert.match(calendarFile({ id: "old", ...plan, stop_times: null }), /DTSTART;VALUE=DATE:20261018/);
});
test("upcoming plan library renders saved stops and calendar actions without exposing session credentials", () => {
  const plan = { id: "fixture-id", ...planFromSession(state(), { ...input, date: "2099-10-18" }, now), created_at: now.toISOString() };
  const html = renderToStaticMarkup(createElement(UpcomingPlans, { plans: [plan], busy: false, error: "", onDelete() {}, onRetry() {} }));
  assert.match(html, /Protocol coffee/);
  assert.match(html, /Add to calendar/);
  assert.match(html, /not bookings/);
  assert.doesNotMatch(html, /private-session/);
});
