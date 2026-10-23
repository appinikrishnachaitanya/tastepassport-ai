import "server-only";
import { debugEvent } from "../agent/debug.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { culturalText } from "../agent/intent.ts";
import type { Constraint } from "../agent/types.ts";
import { search, QlooError } from "../qloo/client.ts";
import { candidates } from "./model.ts";
import type { Candidate, Card } from "./model.ts";
function sign(payload: string) {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new QlooError("Qloo is not configured.");
  return createHmac("sha256", key).update(payload).digest("hex");
}
export function seal(items: { query: string; candidates: Candidate[] }[]) {
  const payload = Buffer.from(
    JSON.stringify({ items, expires: Date.now() + 20 * 60_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function unseal(
  token: string,
): { query: string; candidates: Candidate[] }[] {
  const [payload, signature] = token.split(".");
  const expected = sign(payload ?? "");
  if (
    !signature ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new QlooError(
      "Taste confirmation expired or invalid. Resolve again.",
      400,
    );
  const value = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (value.expires < Date.now())
    throw new QlooError("Taste confirmation expired. Resolve again.", 400);
  return value.items;
}
export async function resolve(queries: string[]) {
  debugEvent("resolution.started", { count: queries.length });
  const items = [];
  for (const query of queries) {
    culturalText(query, 100);
    try {
      items.push({ query, candidates: candidates(await search(query)) });
    } catch (e) {
      if (e instanceof QlooError && e.status === 404)
        items.push({ query, candidates: [] });
      else throw e;
    }
  }
  items.forEach((item, seedIndex) =>
    debugEvent("resolution.candidates", {
      seedIndex,
      count: item.candidates.length,
    }),
  );
  debugEvent("resolution.completed", {
    count: items.reduce((n, item) => n + item.candidates.length, 0),
  });
  return { items, token: seal(items) };
}
export async function passport(
  city: string,
  token: string,
  ids: string[],
  constraints: Constraint[] = [],
  activities: import("./model.ts").Section[] = [],
  mode: import("./evidence.ts").Familiarity = "familiar",
) {
  if (!["familiar", "balanced", "explore"].includes(mode))
    throw new QlooError("Choose a supported discovery style.", 400);
  const items = unseal(token);
  const selected = items.map(item => item.candidates.find(c => ids.includes(c.id)))
    .filter((c): c is Candidate => Boolean(c));
  if (selected.length < 1 || selected.length > 5 || selected.length !== ids.length || new Set(ids).size !== ids.length)
    throw new QlooError("Confirm one to five distinct taste matches.", 400);
  const { suggestedSections } = await import("./routing.ts");
  const { sectionTypes } = await import("./model.ts");
  const { discoverSection } = await import("../agent/runtime.ts");
  const { normalizeSession } = await import("../agent/session.ts");
  const sections = activities.length ? [...new Set(activities)] : suggestedSections(selected);
  if (sections.length > 5 || sections.some(section => !Object.hasOwn(sectionTypes,section)))
    throw new QlooError("Choose up to five supported activities.", 400);
  debugEvent("passport.started", {city, signalCount:selected.length});
  const bootstrap = normalizeSession({
    id:"initial",revision:0,expires:Date.now()+90_000,city,selected,
    tags:selected.filter(s=>s.id.startsWith("urn:tag:")),constraints,
    categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[],
    activeCategories:sections, discoveryMode:mode,
  });
  const deadline=AbortSignal.timeout(65_000);
  const pools=await Promise.all(sections.map(async section=>{
    const local=normalizeSession(structuredClone(bootstrap));
    local.intent={kind:"refine",seeds:[],concepts:[],constraints,sections:[section],strategy:"discover"};
    try {
      const cards=await discoverSection(local,section,constraints,ids.filter(id=>!id.startsWith("urn:tag:")),false,deadline);
      if (cards.length > 0 && cards.length < 3) local.notices.push(`Only ${cards.length} eligible ${section} ${cards.length === 1 ? "match was" : "matches were"} returned for these tastes and requirements. Try Balanced or Explore to broaden taste similarity; explicit filters stay in place.`);
      if (!cards.length) local.notices.push(`No eligible ${section} matches were returned. Try a different activity or refinement.`);
      return {cards,notices:local.notices};
    } catch (error) {
      debugEvent("discovery.failed",{section,...(error instanceof QlooError ? {status:error.status} : {})});
      return {cards:[] as Card[],notices:[`${section} is temporarily unavailable. Retry that activity; your confirmed tastes are preserved.`]};
    }
  }));
  const cards=[...new Map(pools.flatMap(pool=>pool.cards).map(card=>[card.id,card])).values()];
  debugEvent("passport.completed",{city,count:cards.length});
  return {city,selected,cards,requestedActivities:sections,
    notices:[...new Set(pools.flatMap(pool=>pool.notices))],
    explanation:"Recommendations use your confirmed tastes and selected activities. Individual connections are shown only when Qloo returns supporting evidence."};
}
