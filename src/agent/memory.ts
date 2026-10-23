import { culturalText } from "./intent.ts";
import { isExistingChoiceRequest } from "./existing-choice.ts";
import { refinementScope } from "./scope.ts";
import { sectionTypes, type Section } from "../passport/model.ts";
import type { AgentInput, AgentReply, AgentState } from "./types.ts";

export interface ConversationMemory {
  version: 1;
  focusSections: Section[];
  lastSuccessfulTask?: { request?: string; sections: Section[] };
  lastAction?: { kind: "refined" | "selected" | "shown" | "answered" | "dismissed" | "feedback"; outcome: "completed" | "needs-input" | "partial" | "blocked"; sections: Section[] };
  recentChanges: { section: Section; resultCount: number }[];
  dismissedConcepts: { query: string; sections: Section[] }[];
  lastPresentedIds?: string[];
  lastSelectedIds?: string[];
  lastPreservedSections: Section[];
}
export function memoryText(value: unknown, max = 400): string | undefined {
  if (typeof value !== "string") return;
  try { return culturalText(value, max) || undefined; } catch { return; }
}
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const sections = (value: unknown): Section[] => Array.isArray(value) ? [...new Set(value.filter((item): item is Section => typeof item === "string" && Object.hasOwn(sectionTypes, item)))].slice(0, 13) : [];
const ids = (value: unknown, max: number): string[] | undefined => Array.isArray(value) ? [...new Set(value.flatMap(id => memoryText(id, 200) ?? []))].slice(0, max) : undefined;

/** Whitelist and bound persisted memory. Never spread arbitrary model/user metadata. */
export function compactConversationMemory(value: unknown): ConversationMemory | undefined {
  const raw = object(value);
  if (raw?.version !== 1) return;
  const task = object(raw.lastSuccessfulTask), action = object(raw.lastAction);
  const validKind = ["refined", "selected", "shown", "answered", "dismissed", "feedback"].includes(String(action?.kind));
  const validOutcome = ["completed", "needs-input", "partial", "blocked"].includes(String(action?.outcome));
  return {
    version: 1,
    focusSections: sections(raw.focusSections),
    ...(task ? {lastSuccessfulTask: {request: memoryText(task.request), sections: sections(task.sections)}} : {}),
    ...(action && validKind && validOutcome ? {lastAction: {kind: action.kind as NonNullable<ConversationMemory["lastAction"]>["kind"], outcome: action.outcome as NonNullable<ConversationMemory["lastAction"]>["outcome"], sections: sections(action.sections)}} : {}),
    recentChanges: (Array.isArray(raw.recentChanges) ? raw.recentChanges : []).flatMap(item => {
      const row = object(item), section = sections([row?.section])[0];
      return section && Number.isSafeInteger(row?.resultCount) && Number(row?.resultCount) >= 0 ? [{section, resultCount: Math.min(Number(row!.resultCount), 300)}] : [];
    }).slice(-6),
    dismissedConcepts: (Array.isArray(raw.dismissedConcepts) ? raw.dismissedConcepts : []).flatMap(item => {
      const row = object(item), query = memoryText(row?.query, 100);
      return query ? [{query, sections: sections(row?.sections)}] : [];
    }).slice(-3),
    lastPresentedIds: ids(raw.lastPresentedIds, 40),
    lastSelectedIds: ids(raw.lastSelectedIds, 3),
    lastPreservedSections: sections(raw.lastPreservedSections),
  };
}

/** Focus comes from completed decisions, not an unconfirmed/model-guessed edit. */
export function conversationFocus(state: AgentState): Section[] {
  const memory = compactConversationMemory(state.conversationMemory);
  return (memory?.focusSections ?? state.intent?.sections ?? []).filter(section => !state.hiddenCategories?.includes(section));
}

/** Rolling event reducer. Called only after commit validation; no inference call. */
export function updateConversationMemory(original: AgentState, reply: AgentReply, input: AgentInput): void {
  if (input.reset === "conversation") { delete reply.state.conversationMemory; return; }
  const memory = compactConversationMemory(original.conversationMemory) ?? {
    version: 1 as const, focusSections: conversationFocus(original), recentChanges: [], dismissedConcepts: [], lastPreservedSections: [],
  };
  const state = reply.state;
  const presentation = state.history?.at(-1);
  const presented = presentation?.referenceIds ?? presentation?.recommendationIds;
  if (presented !== undefined) memory.lastPresentedIds = ids(presented, 40);
  const selected = Boolean(input.message && isExistingChoiceRequest(input.message) && presentation?.recommendationIds?.length);
  const dismissed = Boolean(original.pending && !state.pending && input.message && /^(?:skip|cancel|none of (?:these|those)|never\s?mind|start over)/i.test(input.message));
  const lastSections = reply.changed.length ? reply.changed : presented?.length
    ? [...new Set(presented.flatMap(id => state.cards.find(card => card.id === id)?.section ?? []))]
    : conversationFocus(original);
  const outcome = reply.execution?.phase;
  memory.lastAction = {
    kind: reply.changed.length ? "refined" : dismissed ? "dismissed" : input.feedback ? "feedback" : selected ? "selected" : presented !== undefined ? "shown" : "answered",
    outcome: outcome === "partial" || outcome === "blocked" || outcome === "needs-input" ? outcome : "completed",
    sections: lastSections,
  };
  if (reply.changed.length) {
    memory.focusSections = [...reply.changed];
    const request = memoryText(input.message ?? original.pending?.request);
    memory.lastSuccessfulTask = {request, sections: [...reply.changed]};
    memory.recentChanges = [...memory.recentChanges.filter(change => !reply.changed.includes(change.section)),
      ...reply.changed.map(section => ({section, resultCount: state.cards.filter(card => card.section === section).length}))].slice(-6);
  } else if (selected) {
    memory.focusSections = lastSections;
    memory.lastSelectedIds = ids(presentation?.recommendationIds, 3);
  } else if (presented?.length) {
    memory.focusSections = [...new Set(presented.flatMap(id => state.cards.find(card => card.id === id)?.section ?? []))];
  }
  if (dismissed && original.pending) {
    const query = memoryText(original.pending.query, 100);
    if (query) memory.dismissedConcepts = [...memory.dismissedConcepts.filter(item => item.query !== query), {query, sections: original.pending.sections}].slice(-3);
  }
  if (input.message && (reply.changed.length || selected)) memory.lastPreservedSections = refinementScope(input.message).preserved;
  state.conversationMemory = compactConversationMemory(memory);
}

/** A compact, factual projection for the model. Current preferences are sent separately. */
export function conversationSummary(state: AgentState) {
  const memory = compactConversationMemory(state.conversationMemory);
  const choices = (references: string[] | undefined) => (references ?? []).flatMap(id => {
    const card = state.cards.find(card => card.id === id && !state.hiddenCategories?.includes(card.section));
    const name = card && memoryText(card.name, 100);
    return card && name ? [{id: card.id, name, section: card.section}] : [];
  }).slice(0, 3);
  const pendingQuery = memoryText(state.pending?.query, 100);
  return {
    version: 1 as const,
    source: "validated-application-state" as const,
    focusSections: conversationFocus(state),
    lastSuccessfulTask: memory?.lastSuccessfulTask,
    lastAction: memory?.lastAction,
    recentChanges: memory?.recentChanges ?? [],
    dismissedClarifications: memory?.dismissedConcepts ?? [],
    lastPreservedSections: memory?.lastPreservedSections ?? [],
    selectedChoices: choices(memory?.lastSelectedIds),
    shownChoices: choices(memory?.lastPresentedIds),
    awaitingClarification: pendingQuery ? {query: pendingQuery, sections: sections(state.pending?.sections)} : undefined,
    outingActivities: (Array.isArray(state.outingActivities) ? state.outingActivities : []).flatMap(activity => memoryText(activity, 50) ?? []).slice(0, 5),
  };
}
