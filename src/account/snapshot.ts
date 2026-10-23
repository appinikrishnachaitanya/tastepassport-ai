import type { AgentState } from "../agent/types.ts";
import { normalizeSession } from "../agent/session.ts";
import { randomUUID } from "node:crypto";
import { activeSessionExpiry } from "../agent/session-lifetime.ts";
import { validDestination } from "../workspace/location.ts";
export const SNAPSHOT_VERSION = 1;
// Leave room for JSONB serialization overhead under the 2 MB database limit.
export const MAX_PASSPORT_SNAPSHOT_BYTES = 1_800_000;
/** Snapshot only server-held state. Excludes bearer tokens, chat history and model-only output. */
export function passportSnapshot(original: AgentState) {
  const s = normalizeSession(structuredClone(original));
  if (
    !validDestination(s.city) ||
    s.selected.length < 1 ||
    s.selected.length > 5
  )
    throw Error("Invalid Passport");
  const snapshot = {
    version: SNAPSHOT_VERSION,
    city: s.city,
    selected: s.selected,
    tags: s.tags,
    // Bound the persisted current results while retaining every My Vibe item.
    // Large, frequently refined passports must remain restorable.
    cards: s.cards.slice(-300),
    savedCards: s.savedCards.slice(-100),
    constraints: s.constraints,
    categoryConstraints: s.categoryConstraints,
    categoryConcepts: s.categoryConcepts,
    activityGenres: s.activityGenres,
    outingActivities: s.outingActivities,
    feedback: s.feedback,
    activeCategories: s.activeCategories,
    hiddenCategories: s.hiddenCategories,
    preferences: s.preferences,
    explorationMode: s.explorationMode,
    discoveryMode: s.discoveryMode,
    categoryModes: s.categoryModes,
    categoryTags: s.categoryTags,
    queryPreferences: s.queryPreferences,
  };
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_PASSPORT_SNAPSHOT_BYTES)
    throw Error("Passport is too large to save. Try a new Passport with fewer activities.");
  return snapshot;
}
export type PassportSnapshot = ReturnType<typeof passportSnapshot>;
/** Only restore rows written by the server-only DB role, never a client-supplied snapshot. */
export function restoreSnapshot(value: unknown) {
  const v = value as PassportSnapshot;
  if (
    !v ||
    v.version !== SNAPSHOT_VERSION ||
    !validDestination(v.city) ||
    !Array.isArray(v.selected) ||
    v.selected.length < 1 ||
    v.selected.length > 5 ||
    !Array.isArray(v.cards) ||
    v.cards.length > 300 ||
    !Array.isArray(v.savedCards) ||
    v.savedCards.length > 100
  )
    throw Error("Saved Passport format unavailable");
  if (
    [...v.cards, ...v.savedCards].some(
      (c) =>
        !c || c.evidence?.source !== "Qloo" || c.evidence.result.id !== c.id,
    )
  )
    throw Error("Saved discoveries require Qloo evidence");
  const clean = passportSnapshot(
    normalizeSession({
      ...structuredClone(v),
      id: randomUUID(),
      revision: 0,
      expires: activeSessionExpiry(),
      previous: [],
      notices: [],
    }),
  );
  return normalizeSession({
    ...clean,
    id: randomUUID(),
    revision: 0,
    expires: activeSessionExpiry(),
    previous: [],
    notices: [
      "Restored saved Qloo discoveries. Evidence shows when they were retrieved; refine a category for fresh results.",
    ],
    history: [],
    providerHealth: "unconfigured",
  });
}
