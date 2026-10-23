import type {
  AgentState,
  Constraint,
  Intent,
  TastePassportSession,
} from "./types.ts";
import type { Section } from "../passport/model.ts";
import { sectionOrder } from "../workspace/state.ts";
/** Canonical state shared by guided controls and conversational interpretation. */
export function normalizeSession(state: AgentState): TastePassportSession {
  state.savedCards ??= state.cards.filter((card) =>
    state.feedback.some((f) => f.id === card.id && f.accepted),
  );
  state.activeCategories ??= sectionOrder.filter((s) =>
    state.cards.some((c) => c.section === s),
  );
  state.hiddenCategories ??= [];
  state.preferences ??= {};
  state.explorationMode ??= "aligned";
  state.discoveryMode ??= "familiar";
  state.categoryModes ??= {};
  state.categoryConcepts ??= {};
  state.history ??= [];
  state.recovery ??= [];
  state.relaxed ??= [];
  state.providerHealth ??= "unconfigured";
  state.categoryTags ??= tagScopes(state);
  state.queryPreferences ??= {};

  return state as TastePassportSession;
}
export function resetConversation(original: AgentState): TastePassportSession {
  const state = normalizeSession(structuredClone(original));
  state.history = [];
  delete state.conversationMemory;
  delete state.failedSearches;
  state.constraints = [];
  state.categoryConstraints = {};
  state.categoryConcepts = {};
  state.preferences = {};
  state.explorationMode = "aligned";
  state.tags = state.selected.filter((t) => t.id.startsWith("urn:tag:"));
  state.categoryTags = tagScopes(state);
  state.recovery = [];
  state.relaxed = [];
  state.previous = [];
  state.queryPreferences = {};
  state.activityGenres = {};
  delete state.outingActivities;
  delete state.pending;
  delete state.intent;
  delete state.comparison;
  return state;
}
export function clearPassport(original: AgentState): TastePassportSession {
  const state = resetConversation(original);
  state.city = "";
  state.selected = [];
  state.tags = [];
  state.categoryTags = {};
  state.cards = [];
  state.savedCards = [];
  state.feedback = [];
  state.notices = [];
  state.activeCategories = [];
  state.hiddenCategories = [];
  state.discoveryMode = "familiar";
  state.categoryModes = {};
  return state;
}
export function guidedIntent(
  section: Section,
  constraints: Constraint[],
): Intent {
  return {
    kind: "refine",
    seeds: [],
    concepts: [],
    sections: [section],
    constraints,
    strategy: "discover",
  };
}
export function relaxationSteps(constraints: Constraint[]): Constraint[][] {
  // Explicit requirements need user consent to relax. Sparse handling changes taste signals only.
  return [constraints];
}

function tagScopes(state: AgentState): Partial<Record<Section, string[]>> {
  return Object.fromEntries(
    sectionOrder.map((section) => [
      section,
      state.tags
        .filter((t) => {
          const text = `${t.id} ${t.name}`;
          return section === "Eat"
            ? !/coffee|caf[eé]/i.test(text) && /cuisine|restaurant|biryani|savour|savory|food|dish/i.test(text)
            : section === "Coffee"
              ? /coffee|caf[eé]/i.test(text)
              : section === "Lifestyle"
                ? /book|shop/i.test(text)
                : section === "Culture"
                  ? /museum|gallery|theatre|culture/i.test(text)
                  : !/:place:|:restaurant:|:cuisine:|:ambience:/.test(t.id);
        })
        .map((t) => t.id),
    ]),
  );
}

export function sectionTags(state: AgentState, section: Section) {
  return state.tags.filter(
    (tag) =>
      !state.categoryTags || state.categoryTags[section]?.includes(tag.id),
  );
}
