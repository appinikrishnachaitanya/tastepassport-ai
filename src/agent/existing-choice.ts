import { refinementScope } from "./scope.ts";
import { categoryLanguage } from "./category-language.ts";
import { chatReason, lastReferencedIds, requestedShortlistSections } from "./chat-shortlist.ts";
import { formatReturnedRating } from "../passport/rating-display.ts";
import { isPlaceSection, type Card } from "../passport/model.ts";
import type { AgentState } from "./types.ts";

/** Choosing from returned results is a read operation, never a discovery tool.
 * Bounded common misspellings do not affect cultural entity identity. */
function selectionLanguage(text: string): string {
  return categoryLanguage(text).toLowerCase().replace(/\bnight\s+clubs?\b/g, match => match.endsWith("s") ? "nightclubs" : "nightclub")
    .replace(/\bfor\s+mr\b/g, "for me");
}
const reference = /\b(?:above|these|those|them|already|current|existing|shown|listed|from (?:the|your) (?:list|results|suggestions))\b/;
export function isExistingChoiceRequest(text: string): boolean {
  const q = selectionLanguage(refinementScope(text).positive);
  if (/\b(?:new|different|elsewhere|replace|refresh|update|refine|remove|hide|change|adjust)\b/.test(q)) return false;
  if (/\b(?:pick|choose|select|recommend)\b[\s\S]*\b(?:one|1|single)\b/.test(q)) return true;
  if (/^which (?:one |of (?:these|those) )?has the (?:highest|best) rating\??$/.test(q.trim())) return true;
  if (/\bwhich\b[\s\S]*\b(?:should|would)\b[\s\S]*\b(?:pick|choose|recommend|try|visit|go)\b/.test(q)) return true;
  return reference.test(q) && /\b(?:pick|choose|select|recommend|best|top|highest[ -]rated|best[ -]rated|cheapest|most affordable|lowest price)\b/.test(q);
}
function requestedGenre(q: string): RegExp | undefined {
  if (/\b(?:nightclubs?|nightlife)\b/.test(q)) return /\bnight\s*clubs?\b/i;
  if (/\b(?:cinema|movie theat(?:er|re))\b/.test(q)) return /\bcinema|movie theat(?:er|re)\b/i;
  if (/\bmuseums?\b/.test(q)) return /\bmuseums?\b/i;
  if (/\b(?:art galleries|art gallery)\b/.test(q)) return /\bart galler(?:y|ies)\b/i;
}
function hasGenre(card: Card, genre: RegExp): boolean {
  return (card.evidence?.result.tags ?? []).some(tag =>
    (/^urn:tag:(?:genre|category):place/.test(tag.type ?? tag.id) || /^urn:tag:(?:genre|category):place:/.test(tag.id)) && genre.test(tag.name));
}
export interface ExistingChoice {
  cards: Card[];
  message: string;
}
export function chooseExisting(state: AgentState, text: string): ExistingChoice {
  const q = selectionLanguage(refinementScope(text).positive);
  const sections = requestedShortlistSections(q);
  const genre = requestedGenre(q);
  const ids = lastReferencedIds(state);
  const above = reference.test(q);
  const implicitShown = /^which (?:one |of (?:these|those) )?has the (?:highest|best) rating\??$/.test(q.trim());
  const available = state.cards.filter(card => !state.hiddenCategories?.includes(card.section) &&
    !state.feedback.some(feedback => feedback.id === card.id && !feedback.accepted));
  const source = (above || implicitShown) && ids !== undefined
    ? ids.flatMap(id => available.find(card => card.id === id) ?? [])
    : available;
  let eligible = source.filter(card => (!sections?.length || sections.includes(card.section)) && (!genre || hasGenre(card, genre)));
  const rating = (card: Card) => isPlaceSection(card.section)
    ? card.intelligence?.quality.businessRating : card.intelligence?.quality.qlooRating;
  const highestRated = /\b(?:highest|best|top)[ -]rated\b|\b(?:best|highest) rating\b/.test(q);
  const cheapest = /\b(?:cheapest|least expensive|lowest price|most affordable)\b/.test(q);
  // A request for an unverified condition must not become an unsupported guarantee.
  if (/\b(?:quiet|quietest|peaceful|vegetarian|vegan|halal|gluten|accessible|wheelchair|open now|tonight|tickets?|available|nearest|closest)\b/.test(q)) {
    return { cards: [], message: "I can help choose from these, but I can’t verify that requirement from the current results alone. Would you like a taste-based pick, a rating comparison, or a new search with that preference? Your Passport is unchanged." };
  }
  // Extra descriptors must be supported by returned tags, not silently ignored.
  // The vocabulary is for the choice command; arbitrary cultural terms are
  // checked against evidence rather than maintained as a cuisine allowlist.
  const commandWords = new Set("a an the this that these those from above below of in for me my our your us you i we mr bro man please can could would should which go visit try start with pick choose select recommend give tell show help one two three 1 2 3 single best top highest rated rating cheapest least expensive lowest price most affordable option options choice choices result results suggestion suggestions recommendation recommendations current existing already shown listed list among between and or is are to it them something kind all interests categories across restaurants restaurant dining dinner food coffee cafe cafes cafés music artist artists movies movie film films culture museums museum cinema nightlife nightclub nightclubs books book podcasts shows games brands people destinations shops bookstores gallery galleries art theater theatre".split(" "));
  const named = eligible.filter(card => q.includes(card.name.toLowerCase()));
  if (named.length) eligible = named;
  let qualifiers = q.replace(state.city.toLowerCase(), " ");
  for (const card of named) qualifiers = qualifiers.replace(card.name.toLowerCase(), " ");
  const descriptors = qualifiers.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(word => word && !commandWords.has(word) && word !== "has");
  if (descriptors.length) eligible = eligible.filter(card => {
    const returned = (card.evidence?.result.tags ?? []).map(tag => tag.name.toLowerCase()).join(" ");
    const words = new Set(returned.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/));
    return descriptors.every(word => words.has(word));
  });
  if (highestRated && new Set(eligible.map(card => isPlaceSection(card.section) ? "business" : "content")).size > 1)
    return {cards: [], message: "Those options use different kinds of ratings. Which category would you like me to compare? Your Passport is unchanged."};
  if (highestRated) eligible = eligible.filter(card => rating(card) !== undefined)
    .sort((a, b) => rating(b)! - rating(a)!);
  else if (cheapest) eligible = eligible.filter(card => card.intelligence?.commercial.priceLevel !== undefined)
    .sort((a, b) => a.intelligence!.commercial.priceLevel! - b.intelligence!.commercial.priceLevel!);
  const count = /\b(?:three|3)\b/.test(q) ? 3 : /\b(?:two|2)\b/.test(q) ? 2 : 1;
  const seen = new Set<string>();
  const cards = eligible.filter(card => !seen.has(card.id) && Boolean(seen.add(card.id))).slice(0, count);
  if (!cards.length) {
    const requested = /nightclubs?|nightlife/.test(q) ? "a verified nightclub" : "a matching choice";
    return {cards: [], message: descriptors.length ? "I can’t verify a choice matching those extra details among the options shown. I can pick using the current taste ranking, or search for new options with that preference. Your Passport is unchanged." : highestRated || cheapest
      ? "I don’t have enough returned price or rating details to make that comparison among these options. I can pick a starting choice using the existing taste ranking instead. Your Passport is unchanged."
      : `I don’t see ${requested} ${above ? "among the choices above" : "in your current discoveries"}. I can search for new options if you’d like. Your Passport is unchanged.`};
  }
  const lead = cards.length === 1 ? `My pick${above ? " from those options" : " from your current discoveries"} is ${cards[0].name}.`
    : `I’d start with ${cards.map(card => card.name).join(" and ")} from these options.`;
  const basis = highestRated ? `It has the highest returned ${isPlaceSection(cards[0].section) ? "business " : ""}rating among the matching choices: ${formatReturnedRating(rating(cards[0]))}/5.`
    : cheapest ? "It has the lowest returned price level among the matching choices; check the current prices before going."
    : "I’m using the existing taste ranking to help you choose, rather than starting another search.";
  const reasons = cards.map(card => `${card.name}: ${chatReason(card)}`).join("\n");
  const practical = cards.some(card => isPlaceSection(card.section)) ? " Check current hours, entry requirements and availability before going." : "";
  return {cards, message: `${lead}\n\n${basis}\n${reasons}\n\nYour Passport is unchanged.${practical}`};
}
