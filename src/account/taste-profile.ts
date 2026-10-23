import type { AgentState } from "../agent/types.ts";
import type { Candidate, Section } from "../passport/model.ts";
import { sectionOrder } from "../workspace/state.ts";
import { validatePreferences, type QueryPreferences } from "../qloo/query-plan.ts";
import { normalizeSession } from "../agent/session.ts";

const localKeys = new Set(["locationQuery", "locationPoint", "radius", "excludeLocation", "countryCode", "region", "metro", "excludeEntities"]);
const constraints = new Set(["touristy", "crowded", "mainstream", "expensive", "atmosphere"]);
const candidateValid = (value: Candidate) => value && typeof value.name === "string" && value.name.length <= 250 &&
  typeof value.id === "string" && /^(?:[a-f0-9-]{36}|urn:tag:[\w:-]+)$/i.test(value.id) &&
  Array.isArray(value.types) && value.types.every(t=>typeof t === "string") && typeof value.detail === "string";

/** Only cultural preferences travel. No city, venue results, chat, tokens or identity. */
export function portableTasteProfile(original: AgentState) {
  const state = normalizeSession(structuredClone(original));
  if (state.selected.length < 1 || state.selected.length > 5 || !state.selected.every(candidateValid))
    throw Error("Confirm one to five tastes before saving your profile.");
  const queryPreferences: Partial<Record<Section, QueryPreferences>> = {};
  for (const section of sectionOrder) {
    const value = state.queryPreferences?.[section];
    if (value) queryPreferences[section] = validatePreferences(Object.fromEntries(Object.entries(value).filter(([key])=>!localKeys.has(key))));
  }
  const profile = {
    version: 1 as const,
    selected: state.selected.map(({id,name,types})=>({id,name,types,detail:""})),
    tags: state.tags.filter(t=>t.id.startsWith("urn:tag:") && candidateValid(t)).slice(-50).map(({id,name,types})=>({id,name,types,detail:""})),
    constraints: state.constraints.filter(c=>constraints.has(c)),
    categoryConstraints: Object.fromEntries(sectionOrder.map(s=>[s,(state.categoryConstraints[s] ?? []).filter(c=>constraints.has(c))])) as AgentState["categoryConstraints"],
    categoryTags: state.categoryTags,
    categoryConcepts: Object.fromEntries(sectionOrder.map(section=>[
      section,
      state.categoryConcepts[section]?.length
        ? (state.categoryTags[section] ?? [])
          .filter(id=>!state.queryPreferences?.[section]?.excludeTags?.includes(id))
          .flatMap(id=>state.tags.filter(tag=>tag.id===id).map(tag=>tag.name))
        : [],
    ])) as NonNullable<AgentState["categoryConcepts"]>,
    queryPreferences,
    discoveryMode: state.discoveryMode,
    categoryModes: state.categoryModes,
    hiddenCategories: state.hiddenCategories,
    activeCategories: state.activeCategories,
    activityGenres: state.activityGenres ?? {},
  };
  if (new TextEncoder().encode(JSON.stringify(profile)).length > 40000) throw Error("Taste profile is too large.");
  return profile;
}
export type TasteProfile = ReturnType<typeof portableTasteProfile>;
export function readTasteProfile(value: unknown): TasteProfile {
  const profile = value as TasteProfile;
  if (!profile || profile.version !== 1 || !Array.isArray(profile.selected) || !Array.isArray(profile.tags) || !profile.tags.every(candidateValid))
    throw Error("Saved taste profile needs to be updated.");
  return portableTasteProfile({
    ...profile, id: "profile", revision: 0, expires: 0, city: "", cards: [], previous: [], feedback: [], notices: [],
    categoryConstraints: profile.categoryConstraints ?? {}, constraints: profile.constraints ?? [],
  });
}
