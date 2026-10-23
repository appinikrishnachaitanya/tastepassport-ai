import { conversationFocus, conversationSummary } from "./memory.ts";
import { chatShortlist } from "./chat-shortlist.ts";
import { culturalText } from "./intent.ts";
import type { AgentState, ConversationContext } from "./types.ts";

export const RECENT_CONTEXT_MESSAGES = 4;
export const RECENT_CONTEXT_CHARACTERS = 2400;

/** Approved cultural context only: whitelist fields rather than serializing the session. */
export function conversationContext(state: AgentState): ConversationContext {
  const safe = (value: string, max = 1000): string | undefined => {
    try { return culturalText(value, max) || undefined; } catch { return undefined; }
  };
  const names = (ids: string[]) => [...new Set(ids.flatMap(id => {
    const name = state.tags.find(tag => tag.id === id)?.name ??
      [...state.cards, ...state.previous].find(card => card.id === id)?.name;
    const checked = name && safe(name, 100);
    return checked ? [checked] : [];
  }))].slice(0, 12);
  const recent = (state.history ?? []).slice(-RECENT_CONTEXT_MESSAGES).flatMap(turn => {
    const text = safe(turn.text);
    return text ? [{ role: turn.role, text }] : [];
  });
  // Keep complete messages; never crop away a negation to meet the budget.
  while (recent.reduce((sum, turn) => sum + turn.text.length, 0) > RECENT_CONTEXT_CHARACTERS) recent.shift();
  const firstUser = recent.findIndex(turn => turn.role === "user");
  return {
    city: safe(state.city, 100) ?? "",
    summary: conversationSummary(state),
    history: firstUser < 0 ? [] : recent.slice(firstUser),
    tastes: state.selected.slice(0, 10).flatMap(taste => {
      const name = safe(taste.name, 100);
      return name ? [name] : [];
    }),
    lastSections: conversationFocus(state),
    activeRecommendations: [...new Map([...chatShortlist(state),...state.cards].map(card=>[card.id,card])).values()].slice(0,15).flatMap(card => {
      const name = safe(card.name, 100);
      if (!name) return [];
      return [{
        id: card.id,
        name,
        section: card.section,
        priceLevel: card.intelligence?.commercial?.priceLevel,
        rating: card.intelligence?.quality?.businessRating,
        tags: (card.evidence?.result?.tags ?? []).slice(0, 4).flatMap(t => {
          const n = safe(t.name, 50);
          return n ? [n] : [];
        }),
      }];
    }),
    categories: (state.activeCategories ?? []).filter(section => !state.hiddenCategories?.includes(section)).map(section => {
      const query = state.queryPreferences?.[section] ?? {};
      const preferences: Record<string, string | number> = {};
      for (const key of ["priceMin", "priceMax", "businessRatingMin", "businessRatingMax", "ratingMin", "ratingMax", "popularityMin", "popularityMax", "radius"] as const) {
        const value = query[key];
        if (typeof value === "number" && Number.isFinite(value)) preferences[key] = value;
      }
      for (const key of ["goal", "qualityBias", "trendBias", "tagOperator", "locationQuery"] as const) {
        const value = query[key];
        const checked = value && safe(value, 100);
        if (checked) preferences[key] = checked;
      }
      return {
        section, preferences,
        constraints: state.categoryConstraints[section] ?? [],
        concepts: (state.categoryConcepts?.[section] ?? []).slice(0, 5).flatMap(concept => {
          const checked = safe(concept, 100); return checked ? [checked] : [];
        }),
        requirements: names([...(state.categoryTags?.[section] ?? []), ...(query.includeTags ?? [])]),
        exclusions: names([...(query.excludeTags ?? []), ...(query.excludeEntities ?? [])]),
        resultCount: state.cards.filter(card => card.section === section).length,
      };
    }),
  };
}
