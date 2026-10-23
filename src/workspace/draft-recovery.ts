import { validDestination } from "./location.ts";
import type { Section } from "../passport/model.ts";
import { sectionTypes } from "../passport/model.ts";

const KEY = "tastepassport.onboarding.draft.v1";
const TTL = 2 * 60 * 60_000;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export interface OnboardingDraft {
  city: string;
  origin: string;
  tastes: string[];
  activities: Section[];
}
export function saveOnboardingDraft(store: Storage, draft: OnboardingDraft, now = Date.now()) {
  try {
    if (!draft.city && !draft.tastes.length && !draft.origin && !draft.activities.length) {
      store.removeItem(KEY);
      return;
    }
    store.setItem(KEY, JSON.stringify({savedAt:now,draft}));
  } catch { /* Browser storage may be unavailable. */ }
}
export function restoreOnboardingDraft(store: Storage, now = Date.now()): OnboardingDraft | undefined {
  try {
    const raw = store.getItem(KEY);
    if (!raw || raw.length > 3000) return;
    const value = JSON.parse(raw);
    const draft = value?.draft;
    if (typeof value?.savedAt !== "number" || value.savedAt > now || now - value.savedAt > TTL ||
      !draft || typeof draft.city !== "string" || typeof draft.origin !== "string" ||
      !Array.isArray(draft.tastes) || !Array.isArray(draft.activities) ||
      draft.tastes.length > 5 || draft.tastes.some((taste: unknown) => typeof taste !== "string" || taste.length > 100) ||
      draft.activities.length > 5 || draft.activities.some((section: unknown) => typeof section !== "string" || !Object.hasOwn(sectionTypes, section))) return;
    return {city:validDestination(draft.city) ? draft.city : "",origin:draft.origin.slice(0,100),tastes:draft.tastes,activities:draft.activities};
  } catch { return; }
}
export function clearOnboardingDraft(store: Storage) {
  try { store.removeItem(KEY); } catch { /* Browser storage may be unavailable. */ }
}
