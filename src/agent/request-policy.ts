import { isExistingChoiceRequest } from "./existing-choice.ts";
import { incompleteUtterance } from "./category-language.ts";
import { isGreetingOrTypo } from "./conversation-grounding.ts";
import { isShortlistRequest } from "./chat-shortlist.ts";
import { isListRequest } from "./answers.ts";
import { isReadOnlyFollowUp } from "./read-only.ts";
import { refinementScope } from "./scope.ts";
import { sectionTypes } from "../passport/model.ts";
import { interpret } from "./intent.ts";
import type { AgentInput, AgentReply, AgentState } from "./types.ts";

export type RequestRoute = "conversation" | "clarification" | "current-results" | "interpret" | "action";
export type RequestPhase = "routing" | "interpreting" | "executing" | "checking" | "completed" | "needs-input" | "partial" | "blocked" | "cancelled" | "failed";
export interface RequestExecution {
  route: RequestRoute;
  phase: RequestPhase;
  steps: RequestPhase[];
  elapsedMs: number;
}
/** Cheap, conservative routes use existing evidence. All other language goes
 * through the existing structured Gemini interpretation, not a second router call. */
export function routeRequest(input: AgentInput): RequestRoute {
  if (!input.message) return "action";
  const text = input.message;
  if (isGreetingOrTypo(text) || /^(?:thanks(?: bro)?|thank you(?: bro)?|cheers)[!,.\s]*$/i.test(text.trim())) return "conversation";
  if (incompleteUtterance(text)) return "clarification";
  if (isExistingChoiceRequest(text) || isShortlistRequest(text) || isListRequest(text) || isReadOnlyFollowUp(text) || interpret(text).question) return "current-results";
  return "interpret";
}

/** Execution trace is per request; it never becomes persistent conversation context. */
export class RequestMachine {
  private started = Date.now();
  private steps: RequestPhase[] = ["routing"];
  readonly route: RequestRoute;
  constructor(route: RequestRoute) { this.route = route; }
  move(phase: RequestPhase) {
    if (["completed", "needs-input", "partial", "blocked", "cancelled", "failed"].includes(this.steps.at(-1)!))
      throw Error("Request is already terminal");
    if (this.steps.at(-1) !== phase) this.steps.push(phase);
  }
  snapshot(): RequestExecution {
    return { route: this.route, phase: this.steps.at(-1)!, steps: [...this.steps], elapsedMs: Date.now() - this.started };
  }
}

/** Deterministic evaluator: model confidence never authorizes a state change.
 * The transaction may update only unprotected categories and cannot rewrite
 * identity, destination or confirmed seeds. Tool results remain untrusted data. */
export function checkTurnCommit(original: AgentState, result: AgentReply, input: AgentInput): boolean {
  const state = result.state;
  if (state.id !== original.id || state.city !== original.city || JSON.stringify(state.selected) !== JSON.stringify(original.selected)) return false;
  const protectedSections = input.message ? refinementScope(input.message).preserved : [];
  for (const section of protectedSections) {
    if (result.changed.includes(section)) return false;
    if (JSON.stringify(state.cards.filter(card => card.section === section)) !== JSON.stringify(original.cards.filter(card => card.section === section))) return false;
    for (const key of ["queryPreferences", "categoryConstraints", "categoryTags", "categoryModes", "categoryConcepts"] as const) {
      if (JSON.stringify(state[key]?.[section]) !== JSON.stringify(original[key]?.[section])) return false;
    }
  }
  // A tool cannot silently replace another chapter while reporting a scoped update.
  const explicitlyHidden = state.intent?.kind === "hide" ? state.intent.sections : state.intent?.hide ?? [];
  const feedbackSection = input.feedback ? original.cards.find(card => card.id === input.feedback!.id)?.section : undefined;
  for (const section of Object.keys(sectionTypes) as (keyof typeof sectionTypes)[]) {
    if (result.changed.includes(section) || explicitlyHidden.includes(section) || section === feedbackSection) continue;
    if (JSON.stringify(state.cards.filter(card => card.section === section)) !== JSON.stringify(original.cards.filter(card => card.section === section))) return false;
  }
  for (const section of result.changed) {
    const cards = state.cards.filter(card => card.section === section);
    const ids = new Set<string>();
    if (!cards.length) return false;
    for (const card of cards) {
      if (!card.id || !card.name?.trim() || ids.has(card.id)) return false;
      ids.add(card.id);
      if (state.feedback.some(feedback => !feedback.accepted && feedback.id === card.id)) return false;
      if (card.evidence) {
        if (card.evidence.result.id !== card.id || card.evidence.destination !== state.city) return false;
        const preferences = state.queryPreferences?.[section];
        const price = card.intelligence?.commercial.priceLevel;
        const rating = card.intelligence?.quality.businessRating;
        if (preferences?.priceMax !== undefined && preferences.priceMax < 4 && (price === undefined || price > preferences.priceMax)) return false;
        if ((preferences?.priceMin ?? 0) > 0 && preferences?.priceMin !== undefined && (price === undefined || price < preferences.priceMin)) return false;
        if ((preferences?.businessRatingMin ?? 0) > 0 && preferences?.businessRatingMin !== undefined && (rating === undefined || rating < preferences.businessRatingMin)) return false;
        if (preferences?.excludeTags?.some(id => card.evidence!.result.tags.some(tag => tag.id === id))) return false;
      }
    }
  }
  return true;
}
