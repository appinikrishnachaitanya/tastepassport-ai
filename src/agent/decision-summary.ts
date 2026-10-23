import { sectionLabel } from "../passport/labels.ts";
import type { AgentState } from "./types.ts";
import type { Card, Section } from "../passport/model.ts";
import { priceLabel } from "../passport/pricing.ts";
const label = (section: Section) => sectionLabel(section);
const price = (card: Card) => card.intelligence?.commercial?.priceLevel;
const knownPrice = (card: Card) => Boolean(priceLabel(price(card)));

/** A receipt of applied state changes and actual returned listings, not model-authored reasoning. */
export function decisionSummary(before: AgentState, after: AgentState, changed: Section[]): string {
  return [...new Set(changed)].slice(0, 3).flatMap(section => {
    if (after.hiddenCategories?.includes(section)) return [];
    const previous = before.queryPreferences?.[section] ?? {};
    const current = after.queryPreferences?.[section] ?? {};
    const cards = after.cards.filter(card => card.section === section);
    const sentences: string[] = [];
    if (current.priceMax !== undefined && current.priceMax !== previous.priceMax) {
      sentences.push(previous.priceMax !== undefined
        ? `${label(section)} maximum price category: ${previous.priceMax}/4 → ${current.priceMax}/4 (${priceLabel(current.priceMax)}).`
        : `${label(section)} maximum price category set to ${current.priceMax}/4 (${priceLabel(current.priceMax)}).`);
      const oldCards = before.cards.filter(card => card.section === section && knownPrice(card)).sort((a,b) => price(b)! - price(a)!);
      const newCards = cards.filter(knownPrice).sort((a,b) => price(a)! - price(b)!);
      const old = oldCards.find(old => newCards.some(next => next.id !== old.id && price(next)! < price(old)!));
      const next = old && newCards.find(next => next.id !== old.id && price(next)! < price(old)!);
      if (old && next)
        sentences.push(`Listing example — before: ${old.name} (${price(old)}/4); now: ${next.name} (${price(next)}/4).`);
      else sentences.push("A lower-priced before/after example could not be verified from the returned listing metadata.");
      sentences.push("Price categories are relative; check current menu prices.");
    }
    if (current.businessRatingMin !== undefined && current.businessRatingMin !== previous.businessRatingMin)
      sentences.push(`${label(section)} minimum rating: ${previous.businessRatingMin !== undefined ? `${previous.businessRatingMin}/5 → ` : ""}${current.businessRatingMin}/5.`);
    const retained = (before.categoryTags?.[section] ?? []).filter(id => after.categoryTags?.[section]?.includes(id)).flatMap(id => {
      const tag = after.tags.find(tag => tag.id === id);
      return tag && /urn:tag:(?:cuisine|dietary_option|specialty_dish):/.test(tag.id) ? [tag.name] : [];
    });
    if (retained.length) sentences.push(`Kept: ${[...new Set(retained)].slice(0, 4).join(", ")}${retained.some(name => /vegetarian|vegan/i.test(name)) ? " options" : ""}.`);
    const quietApplied = (after.categoryTags?.[section] ?? []).some(id => {
      const tag = after.tags.find(t => t.id === id);
      return tag && /quiet|calm|tranquil|atmosphere/i.test(tag.name);
    });
    if (quietApplied) {
      sentences.push("Atmosphere: quiet filter applied via Qloo venue metadata (real-time noise levels not measured).");
    }
    if (sentences.length) sentences.unshift(`${cards.length} ${label(section).toLowerCase()} ${cards.length === 1 ? "suggestion" : "suggestions"} returned.`);
    return sentences;
  }).join(" ");
}
