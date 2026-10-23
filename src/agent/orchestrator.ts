import { matchesDishRequirements } from "../passport/dish-evidence.ts";
import { responseContext, responseReceipt, validateResponse } from "./response.ts";
import { refinementSettings, restoreRefinementSettings } from "./refinement-settings.ts";
import { conversationFocus, updateConversationMemory } from "./memory.ts";
import { chooseExisting, isExistingChoiceRequest } from "./existing-choice.ts";
import { RequestMachine, routeRequest, checkTurnCommit } from "./request-policy.ts";
import { sectionLabel } from "../passport/labels.ts";
import { chatShortlist, chatShortlistText, isShortlistRequest, requestedShortlistSections } from "./chat-shortlist.ts";
import { refinementScope } from "./scope.ts";
import { groundedModelIntent, isGreetingOrTypo } from "./conversation-grounding.ts";
import { conversationContext } from "./context.ts";
import { decisionSummary } from "./decision-summary.ts";
import { passportAnswer, cardSpecificAnswer, isListRequest, listPassportCards, listPassportResults, previewRefinedResults } from "./answers.ts";
import { isReadOnlyFollowUp, readOnlyFollowUp } from "./read-only.ts";
import { debugEvent } from "./debug.ts";
import {
  normalizeSession,
  resetConversation,
  guidedIntent,
  relaxationSteps,
  sectionTags,
} from "./session.ts";
import { captureComparison } from "./comparison.ts";
import { recordProviderHealth } from "./health.ts";
import { TurnGuard } from "./guard.ts";
import { validatePreferences, patchPreferences } from "../qloo/query-plan.ts";
import {
  culturalText,
  interpret,
  reasonConstraint,
  validateIntent,
  findMentionedCard,
} from "./intent.ts";
import { tagCandidates } from "./validation.ts";
import { sectionOrder } from "../workspace/state.ts";
import { conceptSections } from "../passport/routing.ts";
import { sectionTypes, isPlaceSection } from "../passport/model.ts";
import { isObject } from "../qloo/types.ts";
import type { Card, Section } from "../passport/model.ts";
import type {
  AgentEvent,
  AgentInput,
  AgentReply,
  AgentState,
  Constraint,
  ModelProvider,
  ToolDefinition,
  ToolResult,
} from "./types.ts";

function conceptKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(?:in|near|around|within|for)\b.*$/i, "")
    .replace(
      /\b(?:new york city|new york|nyc|toronto|london|paris|tokyo)\b/g,
      "",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function conceptAlreadyApplied(
  state: AgentState,
  section: Section,
  concept: string,
) {
  const wanted = conceptKey(concept);
  if (!wanted) return true;
  const words = wanted
    .split(" ")
    .filter(
      (word) =>
        ![
          "cuisine",
          "food",
          "restaurant",
          "restaurants",
          "shop",
          "shops",
        ].includes(word),
    );
  return (state.categoryTags?.[section] ?? []).some((id) => {
    const tag = state.tags.find((candidate) => candidate.id === id);
    if (!tag) return false;
    const current = conceptKey(`${tag.name} ${tag.detail}`);
    return (
      current.includes(wanted) ||
      (words.length > 0 && words.every((word) => current.includes(word)))
    );
  });
}
export interface AgentDependencies {
  provider?: ModelProvider;
  tools: () => Promise<ToolDefinition[]>;
  workflow: (
    mode: "exec" | "mcp",
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
  discover: (
    state: AgentState,
    section: Section,
    constraints: Constraint[],
    excluded: string[],
    rank: boolean,
    signal?: AbortSignal,
  ) => Promise<Card[]>;
}
export async function runTurn(
  original: AgentState,
  input: AgentInput,
  deps: AgentDependencies,
  emit: (event: AgentEvent) => void = () => {},
  guard = new TurnGuard(),
): Promise<AgentReply> {
  const request = new RequestMachine(routeRequest(input));
  debugEvent("agent.route", { action: request.route });
  const provider = deps.provider;
  const wrapped: AgentDependencies = {
    ...deps,
    ...(provider ? { provider: {
      ...provider,
      interpret: async (text, context) => {
        request.move("interpreting");
        return guard.model(() => provider.interpret(text, context, guard.signal));
      },
      choose: async (text, state, tools) => {
        request.move("interpreting");
        return guard.model(() => provider.choose(text, state, tools, guard.signal));
      },
      ...(provider.chooseWithObservation ? {
        chooseWithObservation: async (...args: Parameters<NonNullable<ModelProvider["chooseWithObservation"]>>) => {
          request.move("interpreting");
          return guard.model(() => provider.chooseWithObservation!(...args));
        },
      } : {}),
    } } : {}),
    workflow: async (...args) => {
      request.move("executing");
      return deps.workflow(...args);
    },
    discover: async (...args) => {
      request.move("executing");
      return deps.discover(...args);
    },
  };
  let needsInput = false;
  try {
    const result = await executeTurn(original, input, wrapped, emit, guard, () => { needsInput = true; });
    // Unconfirmed edits are a draft, never active preference state.
    if (result.state.pending && JSON.stringify(result.state.pending) !== JSON.stringify(original.pending)) {
      result.state.pending.settings ??= {};
      for (const section of result.state.pending.sections) {
        if(result.changed.includes(section)) continue;
        result.state.pending.settings[section] ??= refinementSettings(result.state,section);
        restoreRefinementSettings(result.state,section,refinementSettings(original,section));
      }
    }
    // Cancellation must never commit a partial in-flight mutation.
    guard.signal.throwIfAborted();
    request.move("checking");
    if (!checkTurnCommit(normalizeSession(structuredClone(original)), result, input)) {
      request.move("blocked");
      debugEvent("agent.check_failed");
      return {
        state: normalizeSession(structuredClone(original)), changed: [], events: result.events,
        mode: result.mode, execution: request.snapshot(),
        message: "I couldn't safely apply that update. Your Passport is unchanged. Please try changing one category at a time.",
      };
    }
    if (input.message && provider?.compose && input.reset !== "conversation") {
      try {
        const context=responseContext(result,input);
        const drafted=await guard.respond(signal=>provider.compose!(structuredClone(context),signal));
        const composed=validateResponse(drafted,context);
        guard.signal.throwIfAborted();
        const receipt=responseReceipt(result,input);
        const completeList=(result.state.history?.at(-1)?.referenceIds?.length ?? 0)>3 ? result.message : "";
        result.message=[composed.message,completeList,receipt].filter(Boolean).join("\n\n");
        const presentation=result.state.history?.at(-1);
        if(presentation?.role === "agent") {
          presentation.text=result.message;
          if(context.choices.length) presentation.recommendationIds=composed.recommendationIds;
        }
        debugEvent("agent.response",{action:"completed",count:composed.recommendationIds.length});
      } catch {
        // Composition is optional. Never roll back validated retrieval or retry tools.
        debugEvent("agent.response",{action:"fallback"});
      }
    }
    guard.signal.throwIfAborted();
    request.move(needsInput || result.state.pending || request.route === "clarification" ? "needs-input" :
      result.state.recovery?.length ? (result.changed.length ? "partial" : "blocked") : "completed");
    debugEvent("agent.completed", { action: request.snapshot().phase, count: result.changed.length, elapsedMs: request.snapshot().elapsedMs });
    const completed = { ...result, execution: request.snapshot() };
    updateConversationMemory(original, completed, input);
    return completed;
  } catch (error) {
    request.move(guard.signal.aborted ? "cancelled" : "failed");
    debugEvent("agent.check_failed", { action: request.snapshot().phase });
    throw error;
  }
}

async function executeTurn(
  original: AgentState,
  input: AgentInput,
  deps: AgentDependencies,
  emit: (event: AgentEvent) => void = () => {},
  guard = new TurnGuard(),
  markNeedsInput: () => void = () => {},
): Promise<AgentReply> {
  debugEvent("agent.started", {
    action: input.reset
      ? "conversation"
      : input.feedback
        ? "feedback"
        : input.guided
          ? "guided"
          : input.recovery
            ? "recovery"
            : input.familiarity
              ? "familiarity"
              : input.tagChoice
                ? "tag-choice"
                : "message",
  });
  // Transactional working copy; never commit generated provider text as data.
  const state = normalizeSession(structuredClone(original));
  state.recovery = [];
  state.relaxed = [];
  const events: AgentEvent[] = [];
  const changed: Section[] = [];
  let mode: AgentReply["mode"] = "deterministic";
  let fallback = "";
  let rememberedRank = false;
  let comparedRequest = input.message;
  const event = (label: string, status: AgentEvent["status"]) => {
    const e = { label, status };
    events.push(e);
    emit(e);
  };
  const reply = (message: string, recommendations?: Card[], referenceIds?: string[]): AgentReply => {
    const text = fallback + message;
    state.history = [
      ...state.history!,
      ...(input.message
        ? [{ role: "user" as const, text: input.message }]
        : []),
      { role: "agent" as const, text, ...(referenceIds ? {referenceIds:referenceIds.slice(0,40)} : {}), ...(recommendations ? {recommendationIds:recommendations.slice(0,3).map(card=>card.id)} : {}) },
    ].slice(-100);
    return { state, changed, events, mode, message: text };
  };
  const clarify = (message: string): AgentReply => {
    markNeedsInput();
    return reply(message);
  };
  if (input.reset === "conversation") {
    debugEvent("session.reset", {
      action: "conversation",
      count: state.cards.length,
    });
    const clean = resetConversation(state);
    return {
      state: clean,
      changed: [],
      events: [],
      mode,
      message:
        "Conversation cleared. Your city, confirmed interests and Passport are preserved.",
    };
  }
  if (!deps.provider) state.providerHealth = "unconfigured";
  if (input.guided || input.recovery || input.familiarity || input.discovery)
    delete state.pending;
  if (deps.provider && state.providerHealth === "unconfigured")
    state.providerHealth = "configured";
  const route = routeRequest(input);
  if (input.message) {
    culturalText(input.message);
    if(route === "clarification")return reply("I didn’t catch that. You can say ‘list restaurants’, ask for three starting choices, or tell me what to change. Your Passport and current context are unchanged.");
    if (state.pending && /^(?:cancel(?: that| the)?(?: concept| choice)?|skip(?: this| the)?(?: concept| choice)?|none of (?:these|those)(?: matches| options)?|never ?mind|start over)[!,.\s]*$/i.test(input.message.trim())) {
      const abandoned=new Set([state.pending.query,...(state.pending.remainingConcepts ?? [])].map(conceptKey));
      for(const section of state.pending.sections)
        state.categoryConcepts[section]=(state.categoryConcepts[section] ?? []).filter(concept=>!abandoned.has(conceptKey(concept)));
      delete state.pending;
      return reply("Okay, I've skipped that concept choice. Your Passport hasn't changed. What would you like to explore next?");
    }
    if (route === "current-results" && isExistingChoiceRequest(input.message)) {
      delete state.pending;
      const choice = chooseExisting(state, input.message);
      if (!choice.cards.length) markNeedsInput();
      return reply(choice.message, choice.cards);
    }
    // Handle presentation requests before intent classification. A model may
    // otherwise interpret "list here" as another discovery/refinement request.
    if (route === "current-results" && isShortlistRequest(input.message)) {
      delete state.pending;
      const cards=chatShortlist(state,requestedShortlistSections(input.message));
      return reply(chatShortlistText(state,cards),cards);
    }
    if (/^(?:thanks(?: bro)?|thank you(?: bro)?|cheers)[!,.\s]*$/i.test(input.message.trim()))
      return reply("You’re welcome. Want to compare a couple of choices, find a different vibe, or put an outing together?");
    if (route === "current-results" && isListRequest(input.message)) {
      delete state.pending; // A read-only listing supersedes an unrelated choice.
      return reply(listPassportResults(state,input.message),[],listPassportCards(state,input.message).slice(0,40).map(card=>card.id));
    }
    // Questions about an existing result must be handled BEFORE Gemini intent
    // classification. Otherwise "rating for second" can become a filter and
    // destroy the original shortlist or unrelated category state.
    if (route === "current-results" && isReadOnlyFollowUp(input.message)) {
      delete state.pending;
      return reply(readOnlyFollowUp(state,input.message));
    }
    const activeCards = [...state.cards, ...state.savedCards];
    const mentioned = findMentionedCard(input.message, activeCards);
    if (mentioned) {
      const isCardInquiry =
        /why|tell me|explain|what is|how is|is it|about|details|review|rating|price|location|quiet|where is|who is/i.test(input.message) ||
        conceptKey(input.message) === conceptKey(mentioned.name) ||
        input.message.trim().toLowerCase() === mentioned.name.trim().toLowerCase();
      if (isCardInquiry) {
        delete state.pending;
        return reply(cardSpecificAnswer(mentioned, input.message));
      }
    }
    if (
      state.pending &&
      conceptKey(state.pending.request ?? "") === conceptKey(input.message)
    )
      return reply(
        `I found matches for “${state.pending.query}”. Choose one of the options below to continue; you don't need to send the request again.`,
      );
    // Legacy sessions may contain concepts stored before their choice was
    // confirmed. A new request must not inherit those abandoned draft concepts.
    if (original.pending) {
      const abandoned=new Set([original.pending.query,...(original.pending.remainingConcepts ?? [])].map(conceptKey));
      for(const section of original.pending.sections)
        state.categoryConcepts[section]=(state.categoryConcepts[section] ?? []).filter(concept=>!abandoned.has(conceptKey(concept)));
    }
    delete state.pending;
  }
  if (input.message && isGreetingOrTypo(input.message))
    return reply(`Hi! What would you like to explore in ${state.city}? I can help you choose from your current discoveries, compare a couple, or refine what isn’t working. Want three starting choices or do you have something in mind?`);
  let intent = interpret(input.message ?? "", state.city);
  if (input.message && intent.question) {
    state.pending = original.pending; // A genuine read-only question may pause, not confirm, a choice.
    return reply(passportAnswer(state, intent));
  }
  if (input.familiarity) {
    const previous = state.queryPreferences?.[input.familiarity.section];
    if (previous?.goal === "surprise") previous.goal = "discover";
    state.categoryModes[input.familiarity.section] = input.familiarity.mode;
    intent = guidedIntent(
      input.familiarity.section,
      state.categoryConstraints[input.familiarity.section] ?? [],
    );
  }
  if (input.guided)
    intent = guidedIntent(input.guided.section, input.guided.constraints);
  if (input.discovery)
    intent = {
      ...guidedIntent(
        input.discovery.section,
        state.categoryConstraints[input.discovery.section] ?? [],
      ),
      query: validatePreferences(input.discovery.preferences),
    };
  if (input.recovery) {
    const { section, action } = input.recovery;
    const failedSearch = state.failedSearches?.[section];
    if (failedSearch) restoreRefinementSettings(state, section, failedSearch);
    let constraints = [...(state.categoryConstraints[section] ?? [])];
    if (action === "relax-quiet")
      constraints = constraints.filter(
        (c) => c !== "crowded" && c !== "atmosphere",
      );
    if (action === "allow-popular")
      constraints = constraints.filter(
        (c) => c !== "mainstream" && c !== "touristy",
      );
    if (action === "closest" || action === "keep-concept") constraints = [];
    intent = guidedIntent(section, constraints);
  }
  if (input.feedback) {
    const current =
      state.cards.find((c) => c.id === input.feedback!.id) ??
      state.savedCards.find((c) => c.id === input.feedback!.id);
    if (!current)
      throw Error("That recommendation is no longer in the current passport.");
    if (input.feedback.detail) culturalText(input.feedback.detail, 160);
    state.feedback = state.feedback.filter((f) => f.id !== current.id);
    state.savedCards = state.savedCards.filter((c) => c.id !== current.id);
    if (input.feedback.clear) {
      debugEvent("feedback.recorded", {
        section: current.section,
        action: "cleared",
      });
      return reply(
        "Cleared this preference. Your discoveries remain unchanged.",
      );
    }
    state.feedback.push({
      id: current.id,
      section: current.section,
      accepted: input.feedback.accepted,
      reason: input.feedback.reason,
      detail: input.feedback.detail,
    });
    state.feedback = state.feedback.slice(-100);
    debugEvent("feedback.recorded", {
      section: current.section,
      action: input.feedback.accepted ? "accepted" : "rejected",
    });
    if (input.feedback.accepted) {
      state.savedCards = [...state.savedCards, structuredClone(current)].slice(
        -100,
      );
      return reply(
        "Saved as your vibe. Future refinements can use this cultural signal.",
      );
    }
    state.cards = state.cards.filter((card) => card.id !== current.id);
    intent = {
      kind: "refine",
      seeds: [],
      concepts: [
        ...new Set([
          ...(state.categoryConcepts[current.section] ?? []),
          ...(input.feedback.detail
            ? interpret(input.feedback.detail).concepts
            : []),
        ]),
      ],
      sections: [current.section],
      constraints: [
        ...reasonConstraint(input.feedback.reason ?? ""),
        ...(input.feedback.detail
          ? interpret(input.feedback.detail).constraints
          : []),
      ],
      strategy: "discover",
    };
  } else if (input.tagChoice) {
    if(state.pending?.request) {
      const protectedSections=refinementScope(state.pending.request).preserved;
      state.pending.sections=state.pending.sections.filter(section=>!protectedSections.includes(section));
      if(state.pending.conceptSections)state.pending.conceptSections=state.pending.conceptSections.filter(section=>!protectedSections.includes(section));
      if(!state.pending.sections.length){delete state.pending;return reply("Your protected categories are unchanged. Name the category you want to update.");}
    }
    const pending = state.pending;
    if(pending?.settings) for(const section of pending.sections) {
      const settings=pending.settings[section];
      if(settings)restoreRefinementSettings(state,section,settings);
    }
    comparedRequest = pending?.request;
    const tag = pending?.candidates.find((t) => t.id === input.tagChoice);
    if (!pending || !tag) throw Error("Choose a returned concept match.");
    state.tags = [...state.tags.filter((t) => t.id !== tag.id), tag].slice(-10);
    if (pending.exclude) {
      state.queryPreferences ??= {};
      for (const section of pending.sections)
        state.queryPreferences[section] = {
          ...state.queryPreferences[section],
          excludeTags: [
            ...new Set([
              ...(state.queryPreferences[section]?.excludeTags ?? []),
              tag.id,
            ]),
          ],
        };
    }
    for (const section of pending.conceptSections ?? pending.sections) {
      if (pending.exclude) continue;
      const replacesCuisine =
        section === "Eat" &&
        !state.queryPreferences?.[section]?.tagOperator &&
        !pending.optional &&
        !/^vegetarian(?: cuisine)?$/i.test(tag.name) &&
        /cuisine|restaurant/i.test(`${tag.id} ${tag.name} ${tag.detail}`);
      const existing = (state.categoryTags![section] ?? []).filter(
        (id) =>
          !replacesCuisine ||
          !state.tags.some(
            (t) =>
              t.id === id &&
              /cuisine|restaurant/i.test(`${t.id} ${t.name} ${t.detail}`),
          ),
      );
      state.categoryTags![section] = [...new Set([...existing, tag.id])];
    }
    intent = {
      kind: "refine",
      seeds: [],
      concepts:
        pending.optional || pending.exclude
          ? []
          : [pending.query, ...(pending.remainingConcepts ?? [])],
      sections: pending.sections,
      constraints: pending.constraints,
      excludeConcepts: pending.remainingExcludeConcepts,
      activityGenres: pending.activityGenres,
      strategy: pending.strategy ?? "discover",
    };
    rememberedRank = Boolean(pending.rankMcp);
    if (rememberedRank && deps.provider) mode = "model-mcp";
    delete state.pending;
  } else if (deps.provider && input.message) {
    event("Interpreting your cultural request", "active");
    try {
      intent = groundedModelIntent(input.message,validateIntent(
        await deps.provider.interpret(input.message ?? "", conversationContext(state)),
      ),interpret(input.message,state.city));
      mode = "model-mcp";
      state.providerHealth = "healthy";
      event("Cultural intent recognized", "complete");
    } catch {
      fallback =
        "Taste Concierge is temporarily unavailable. You can still refine your Passport. ";
      state.providerHealth = "unavailable";
      recordProviderHealth("unavailable");
      debugEvent("agent.fallback", { mode: "deterministic" });
      event(
        "Taste Concierge is temporarily unavailable. Guided refinement is available.",
        "attention",
      );
    }
  }
  // Excluding a venue type is not permission to hide its whole chapter.
  if (input.message) {
    const explicit = interpret(input.message, state.city);
    if (explicit.question) intent = { ...explicit, sections: explicit.sections };
    if(explicit.kind === "refine" && explicit.sections.length)
      intent.sections = explicit.sections;
    if (explicit.kind === "refine" && !explicit.sections.length && conversationFocus(original).length > 0 &&
        /\b(?:it|those|them|these|same|rest)\b|^(?:cheaper|quieter|more familiar|more adventurous)\b/i.test(input.message.trim())) {
      const previous = conversationFocus(original).filter(section => !state.hiddenCategories.includes(section));
      intent.sections = previous.length === 1 ? previous : [];
      // A relative modifier does not introduce a new cuisine or taxonomy concept.
      if (!explicit.concepts.length && explicit.constraints.length) {
        intent.concepts = [];
        intent.excludeConcepts = explicit.excludeConcepts ?? [];
      }
    }
    if (explicit.kind === "refine" && (explicit.constraints.length || explicit.excludeConcepts?.length || explicit.concepts.length)) {
      intent.kind = "refine";
      delete intent.question;
      intent.constraints = [...new Set([...intent.constraints, ...explicit.constraints])];
      if (!intent.sections.length) intent.sections = explicit.sections;
      if (explicit.concepts.length) intent.concepts = [...new Set([...explicit.concepts,...intent.concepts.filter(concept=>
        !(explicit.constraints.includes("crowded") && /quiet|calm|tranquil/i.test(concept)) &&
        !explicit.concepts.some(known=>known.toLowerCase().split(/\s+/).filter(word=>!["cuisine","food"].includes(word)).every(word=>concept.toLowerCase().includes(word)))
      )])];
    }
    if (explicit.excludeConcepts?.length)
      intent.excludeConcepts = [...new Set([...(intent.excludeConcepts ?? []), ...explicit.excludeConcepts])];
    if (intent.query) {
      // Model-produced IDs must go through resolution, not bypass it as filters.
      delete intent.query.includeTags; delete intent.query.excludeTags; delete intent.query.excludeEntities;
      if (!explicit.query?.tagOperator) delete intent.query.tagOperator;
    }
    if (explicit.query) intent.query={...intent.query,...explicit.query};
    if (explicit.familiarity) intent.familiarity = explicit.familiarity;
    else if (!/familiar|adventur|explor|balanced|comfort zone|home|surprise/i.test(input.message))
      delete intent.familiarity;
    const preserved=refinementScope(input.message).preserved;
    intent.sections=intent.sections.filter(section=>!preserved.includes(section));
    intent.hide=intent.hide?.filter(section=>!preserved.includes(section));
    // The current user message, not a remembered model guess, authorizes a
    // new taxonomy filter or special discovery mode.
    intent = groundedModelIntent(input.message, intent, explicit);
    if (explicit.activityGenres?.length) {
      intent.activityGenres = explicit.activityGenres;
      intent.concepts = explicit.concepts;
      intent.sections = [...new Set([...intent.sections, ...explicit.sections])];
      intent.kind = "refine";
    }
  }
  if (input.message && !/\b(?:hide|remove|skip|forget)\b/i.test(input.message))
    intent.hide = [];
  debugEvent("agent.intent", {
    kind: intent.kind,
    sections: intent.sections,
    mode,
  });
  if (intent.kind === "unknown" && intent.question) {
    return reply(passportAnswer(state, intent));
  }
  if (intent.kind === "unknown" || intent.kind === "onboard")
    return clarify(
      `I didn't catch a discovery request. You can ask naturally—for example, “Find a nightclub in ${state.city}”, “Show my restaurants here”, or “Make dining quieter”. Your Passport is unchanged.`,
    );
  const acceptedScope = state.feedback
    .filter((f) => f.accepted)
    .at(-1)?.section;
  const refersToLike = Boolean(
    input.message && /(?:i liked|similar vibe|like this)/i.test(input.message),
  );
  if (refersToLike && !acceptedScope && !intent.sections.length)
    return reply(
      "Save My vibe on a card first, or name a category, so I can use a real cultural anchor.",
    );
  // A modifier can continue the category of an unresolved task without
  // inheriting its abandoned concept (e.g. chicken -> peaceful Food).
  const pendingScope = input.message && !intent.sections.length && original.pending &&
    (intent.constraints.length > 0 || intent.query || intent.familiarity)
    ? original.pending.sections : [];
  const previousSections = (pendingScope.length ? pendingScope : conversationFocus(original)).filter(section => !state.hiddenCategories.includes(section));
  // An unresolved pronoun is not permission to update the first of several sections.
  if (input.message && !intent.sections.length && previousSections.length > 1)
    return clarify(`Which section should I change: ${previousSections.join(", ")}? Your Passport is unchanged.`);
  const currentScope = previousSections.length === 1 ? previousSections[0] : undefined;
  const visibleSections = state.activeCategories.filter(section => !state.hiddenCategories.includes(section));
  const venueOnly = intent.query?.priceMax !== undefined || intent.query?.priceMin !== undefined ||
    intent.constraints.includes("expensive") || intent.constraints.includes("crowded") || Boolean(intent.excludeConcepts?.length);
  const implicitSections = venueOnly ? visibleSections.filter(isPlaceSection) : visibleSections;
  const implicitScope = currentScope ?? (implicitSections.length === 1 ? implicitSections[0] : undefined);
  if (input.message && !intent.sections.length && !implicitScope && visibleSections.length && !(refersToLike && acceptedScope))
    return clarify(`Which section should I change: ${visibleSections.join(", ")}? Your Passport is unchanged.`);
  const modeScope =
    implicitScope ??
    state.activeCategories.find((s) => !state.hiddenCategories.includes(s)) ??
    "Eat";
  const preserved=input.message ? refinementScope(input.message).preserved : [];
  const targets: Section[] = (intent.sections.length
    ? intent.sections
    : [
        refersToLike && acceptedScope
          ? acceptedScope
          : intent.familiarity
            ? modeScope
            : (implicitScope ?? "Eat"),
      ]).filter(section=>!preserved.includes(section));
  if (!targets.length) return clarify("Your protected categories are unchanged. Name the category you want to update.");
  if (input.message && mode === "model-mcp") {
    const positive = refinementScope(input.message).positive;
    const asksBudget = /cheap|afford|budget|price|cost|expensive|economical|inexpensive|moderate|premium|luxury|spend|[$£€₹]/i.test(positive);
    const asksRating = /rating|rated|stars?|reviewed/i.test(positive);
    // Context helps resolve references; it must not invent a dining budget for
    // a newly requested cinema (or introduce an unrelated minimum rating).
    if (intent.query) {
      for (const key of ["priceMin", "priceMax"] as const)
        if (!asksBudget && targets.every(section => original.queryPreferences?.[section]?.[key] === undefined))
          delete intent.query[key];
      for (const key of ["businessRatingMin", "businessRatingMax"] as const)
        if (!asksRating && targets.every(section => original.queryPreferences?.[section]?.[key] === undefined))
          delete intent.query[key];
    }
    if (!asksBudget && !original.constraints.includes("expensive") && targets.every(section => !original.categoryConstraints[section]?.includes("expensive")))
      intent.constraints = intent.constraints.filter(constraint => constraint !== "expensive");
  }
  if (intent.familiarity)
    for (const section of targets)
      state.categoryModes[section] = intent.familiarity;
  if (intent.kind === "refine") {
    if (!intent.concepts.length && targets.length === 1)
      intent.concepts = [...(state.categoryConcepts[targets[0]] ?? [])];
    for (const section of targets)
      if (intent.concepts.some(concept=>conceptSections(concept, targets).includes(section)))
        state.categoryConcepts[section] = intent.concepts.filter(concept=>conceptSections(concept, targets).includes(section));
  }
  if (!targets.includes("Culture")) delete intent.activityGenres;
  state.intent = { ...intent, sections: targets };
  if (intent.activityGenres?.length) {
    state.activityGenres ??= {};
    state.activityGenres.Culture = intent.activityGenres;
    delete state.categoryConcepts.Culture;
    const venueGenre=(id:string)=>/^urn:tag:(?:genre|category):place:/.test(id);
    state.categoryTags.Culture=(state.categoryTags.Culture ?? []).filter(id=>!venueGenre(id));
    if(state.queryPreferences?.Culture?.includeTags)
      state.queryPreferences.Culture.includeTags=state.queryPreferences.Culture.includeTags.filter(id=>!venueGenre(id));
    if(input.message) {
      const activityText=refinementScope(input.message).positive;
      const outingActivities = [
        {id:"Coffee",index:activityText.search(/coffee|caf[eé]/i)},
        {id:"Cinema",index:activityText.search(/cinema|movies?/i)},
        {id:"Eat",index:activityText.search(/dinner|lunch|breakfast|\beat\b|biryani|restaurant/i)},
        {id:"Nightlife",index:activityText.search(/party|nightclub|nightlife/i)},
      ].filter(a=>a.index>=0).sort((a,b)=>a.index-b.index).map(a=>a.id);
      if (outingActivities.length > 1) state.outingActivities = outingActivities;
    }
  } else if(input.message && targets.includes("Culture") && intent.concepts.some(concept=>conceptSections(concept,targets).includes("Culture"))) {
    if(state.activityGenres)delete state.activityGenres.Culture;
  }
  state.queryPreferences ??= {};
  // Relative changes are calculated against server state, never a model's guessed absolute cap.
  if (input.message && /\bcheaper\b|less expensive/i.test(input.message) &&
      interpret(input.message, state.city).query?.priceMax === undefined && intent.query)
    delete intent.query.priceMax;
  if (input.message && intent.constraints.includes("expensive") && intent.query?.priceMax === undefined) {
    for (const section of targets) {
      const current = state.queryPreferences[section] ?? {};
      const priceMax = /cheaper|less expensive/i.test(input.message)
        ? Math.max(1, (current.priceMax ?? 3) - 1)
        : Math.min(2, current.priceMax ?? 2);
      state.queryPreferences[section] = patchPreferences(current, { priceMax });
    }
  }
  if (intent.query)
    for (const section of targets) {
      // This is a patch: follow-ups keep the existing price, location and other unaffected preferences.
      state.queryPreferences[section] = patchPreferences(
        state.queryPreferences[section] ?? {},
        intent.query,
      );
    }
  state.explorationMode = intent.strategy === "rank" ? "shortlist" : "aligned";
  if (intent.kind !== "hide") {
    state.hiddenCategories = state.hiddenCategories!.filter(
      (s) => !targets.includes(s),
    );
    state.activeCategories = [
      ...new Set([...state.activeCategories!, ...targets]),
    ];
    for (const section of targets)
      state.preferences![section] = [
        ...(intent.constraints.includes("crowded") ? ["quiet"] : []),
        ...(intent.constraints.includes("mainstream")
          ? ["less mainstream"]
          : []),
      ];
  }
  if (intent.hide?.length && intent.kind !== "hide") {
    state.hiddenCategories = [
      ...new Set([...state.hiddenCategories!, ...intent.hide]),
    ];
    state.activeCategories = state.activeCategories!.filter(
      (s) => !intent.hide!.includes(s),
    );
    changed.push(...intent.hide);
    event(`Hid ${intent.hide.join(", ")} sections`, "complete");
  }
  if (intent.kind === "hide") {
    state.previous = [
      ...state.previous,
      ...state.cards.filter((c) => targets.includes(c.section)),
    ].slice(-200);
    state.hiddenCategories = [
      ...new Set([...state.hiddenCategories!, ...targets]),
    ];
    state.activeCategories = state.activeCategories!.filter(
      (s) => !targets.includes(s),
    );
    changed.push(...targets);
    event(`Hid ${targets.join(", ")} sections`, "complete");
    return reply(
      `Hidden ${targets.join(", ")}. Your taste profile and other sections are unchanged.`,
    );
  }
  let tools: ToolDefinition[] = [];
  let modelChoices: Awaited<ReturnType<ModelProvider["choose"]>> =
    rememberedRank ? [{ name: "qloo_rank", arguments: {} }] : [];
  const observedTags = new Map<string, ToolResult>();
  const neededConcepts = [
    ...intent.concepts,
    ...(intent.constraints.includes("crowded") ? ["quiet"] : []),
  ];
  const conceptUnknown = (concept: string) => {
    const words = concept
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => !["cuisine", "food"].includes(w));
    return !state.tags
      .filter((t) =>
        targets.some((section) => state.categoryTags![section]?.includes(t.id)),
      )
      .some((t) =>
        words.every((w) => `${t.name} ${t.detail}`.toLowerCase().includes(w)),
      );
  };
  if (
    mode === "model-mcp" &&
    deps.provider &&
    !input.tagChoice &&
    (intent.strategy === "rank" || neededConcepts.some(concept=>!/^(?:quiet(?: atmosphere)?|vegetarian)$/i.test(concept) && conceptUnknown(concept)))
  ) {
    let choosingModelTool=false;
    try {
      tools = (await deps.tools()).filter((t) =>
        t.name === "qloo_find_tags" || (t.name === "qloo_rank" && intent.strategy === "rank" && state.cards.some(card=>targets.includes(card.section))),
      );
      choosingModelTool=true;
      if (deps.provider.chooseWithObservation && intent.strategy !== "rank" &&
          neededConcepts.some(concept=>conceptUnknown(concept))) {
        const permitted = [...new Set(neededConcepts.map(concept =>
          /quiet/i.test(concept) ? "quiet atmosphere" : concept
        ))];
        const observed = await deps.provider.chooseWithObservation(
          input.message ?? "", state, tools.filter(t => t.name === "qloo_find_tags"),
          async choice => {
            const requested = choice.arguments.query;
            if (choice.name !== "qloo_find_tags" || typeof requested !== "string")
              throw Error("Invalid model-selected Qloo operation");
            const canonical = permitted.find(c => c.toLowerCase() === requested.trim().toLowerCase());
            if (!canonical) throw Error("Tool argument outside user request");
            const args = { query: canonical, limit: 5 };
            return guard.run("qloo_find_tags_model", args, () =>
              deps.workflow("mcp", "qloo_find_tags", args, guard.signal));
          }, guard.signal, permitted,
        );
        modelChoices = observed.choices;
        for (const observation of observed.observations) {
          const query = String(observation.choice.arguments.query).trim().toLowerCase();
          observedTags.set(query, observation.result);
        }
      } else {
        modelChoices = await deps.provider.choose(input.message ?? "", state, tools);
      }
      if (modelChoices.length > 3) throw Error("Tool budget");
      if (modelChoices.some((c) => !tools.some((t) => t.name === c.name)))
        throw Error("Unadvertised tool");
    } catch {
      mode = "deterministic";
      // Optional MCP planning can fail even when intent interpretation worked.
      // Do not falsely report Gemini as unavailable or erase a successful
      // observation; ordinary validated Qloo discovery can still proceed.
      if (!choosingModelTool) {
        fallback = "The tool connection is unavailable. Using validated Qloo discovery. ";
        event("Qloo tool catalog unavailable; using direct lookup", "attention");
      }
      debugEvent("agent.fallback", { mode: "deterministic" });
      event("Guided refinement is available", "attention");
    }
  }
  const concepts = [...new Set([...intent.concepts, ...(intent.excludeConcepts ?? [])])];
  if (
    intent.constraints.includes("crowded") &&
    !concepts.some((c) => /quiet/i.test(c))
  )
    concepts.push("quiet");
  // Tool selection must not introduce a second, reworded concept after the
  // user confirms the original one. Intent is the source of requested concepts.
  for (const concept of concepts.slice(0, 4)) {
    const excluding = intent.excludeConcepts?.includes(concept) ?? false;
    const scopedTargets = excluding ? targets : conceptSections(concept, targets);
    if (!scopedTargets.length) continue;
    if (
      !excluding &&
      scopedTargets.every((section) => conceptAlreadyApplied(state, section, concept))
    )
      continue;
    if (excluding && (input.message || input.tagChoice)) {
      // Explicit exclusions are already user-confirmed. Resolve their Qloo tags
      // and apply them directly so the agent does not ask the same question twice.
      try {
        const resolved = tagCandidates(
          await guard.run("qloo_find_tags_exclusion", { query: concept }, () =>
            deps.workflow(
              "exec",
              "qloo_find_tags",
              { query: concept, limit: 5 },
              guard.signal,
            ),
          ),
          concept,
        ).filter((tag) =>
          /starbucks/i.test(concept)
            ? /starbucks/i.test(`${tag.name} ${tag.id}`)
            : /chain/i.test(concept) ? /chain/i.test(`${tag.name} ${tag.id}`)
            : conceptKey(tag.name) === conceptKey(concept),
        );
        if (resolved.length) {
          state.tags = [
            ...new Map(
              [...state.tags, ...resolved].map((tag) => [tag.id, tag]),
            ).values(),
          ];
          for (const section of targets) {
            state.categoryTags![section] = [
              ...new Set([
                ...(state.categoryTags![section] ?? []),
                ...resolved.map((tag) => tag.id),
              ]),
            ];
            state.queryPreferences![section] = patchPreferences(
              state.queryPreferences![section] ?? {},
              {
                excludeTags: [
                  ...new Set([
                    ...(state.queryPreferences![section]?.excludeTags ?? []),
                    ...resolved.map((tag) => tag.id),
                  ]),
                ],
              },
            );
          }
        } else return reply("I couldn't verify the requested exclusion in the returned taxonomy. Your current discoveries are preserved; try a more specific exclusion.");
      } catch {
        // The positive independent/local category still runs; no unverified
        // chain claim is presented when exclusion taxonomy is unavailable.
        return reply("I couldn't apply the requested exclusion right now. Your discoveries are preserved; retry when you're ready.");
      }
      continue;
    }
    event(`Finding matching concepts for ${concept}`, "active");
    try {
      const transport =
        mode === "model-mcp" &&
        modelChoices.some((c) => c.name === "qloo_find_tags")
          ? "mcp"
          : "exec";
      const args = { query: /quiet/i.test(concept) ? "quiet atmosphere" : concept, limit: 5 };
      let result: ToolResult;
      try {
        const observed = observedTags.get(args.query.toLowerCase());
        result = observed ?? await guard.run("qloo_find_tags", args, () =>
          deps.workflow(transport, "qloo_find_tags", args, guard.signal),
        );
        if (transport === "mcp" && result.status !== "ok")
          throw Error("Concept transport unavailable");
      } catch (error) {
        if (transport !== "mcp") throw error;
        event("Concept lookup is taking another supported route", "attention");
        result = await guard.run("qloo_find_tags_exec_fallback", args, () =>
          deps.workflow("exec", "qloo_find_tags", args, guard.signal),
        );
      }
      let choices = tagCandidates(result, concept).filter(
        (t) =>
          !/quiet/i.test(concept) ||
          (t.id.includes(":ambience:") && /quiet|calm|tranquil/i.test(t.name)),
      );
      // If Qloo does not index the phrase “Indian cuisine”, try the shorter
      // cultural term once. Never invent a tag or show unfiltered venues.
      const cuisineName = !excluding && scopedTargets.includes("Eat")
        ? concept.match(/^([\p{L}]+) cuisine$/iu)?.[1] : undefined;
      if (cuisineName && !choices.length) {
        const fallbackArgs = {query:cuisineName,limit:5};
        try {
          const fallbackTags=await guard.run("qloo_find_tags_cuisine",fallbackArgs,()=>
            deps.workflow("exec","qloo_find_tags",fallbackArgs,guard.signal));
          choices=tagCandidates(fallbackTags,cuisineName);
        } catch { /* Keep original empty result and explain the limitation. */ }
      }
      // A dietary option is a venue requirement, not a new cultural seed.
      // Prefer the returned options taxonomy over audience/cuisine homonyms.
      if (!excluding && /^vegetarian$/i.test(concept)) {
        const dietary = choices.filter(tag => tag.id.startsWith("urn:tag:dietary_option:") && /^vegetarian$/i.test(tag.name));
        if (dietary.length !== 1) return reply("I could not verify vegetarian options. Your Passport is unchanged; please retry. Confirm dietary needs with the venue before ordering.");
        const tag = dietary[0];
        state.tags = [...state.tags.filter(old => old.id !== tag.id), tag];
        state.categoryTags!.Eat = [...new Set([...(state.categoryTags!.Eat ?? []), tag.id])];
        event("Vegetarian options requirement verified", "complete");
        continue;
      }
      if (!excluding && /quiet/i.test(concept)) {
        const direct=choices.filter(tag=>conceptKey(tag.name)===conceptKey(concept));
        const exact=direct.length ? direct : choices.filter(tag=>conceptKey(tag.name)===conceptKey(args.query));
        const known=exact.length===1 ? exact[0] : choices.length===1 ? choices[0] : undefined;
        if(known) {
          state.tags=[...state.tags.filter(tag=>tag.id!==known.id),known];
          for(const section of scopedTargets) state.categoryTags![section]=[...new Set([...(state.categoryTags![section] ?? []),known.id])];
          continue;
        }
      }
      // An explicitly named dish with one exact specialty-dish match needs no
      // additional personal-taste disambiguation. Broader/partial matches do.
      const exactDishes = choices.filter((tag) =>
        tag.id.startsWith("urn:tag:specialty_dish:place:") &&
        conceptKey(tag.name) === conceptKey(concept),
      );
      if (!excluding && scopedTargets.includes("Eat") && exactDishes.length === 1) {
        const tag = exactDishes[0];
        state.tags = [...state.tags.filter((old) => old.id !== tag.id), tag];
        state.categoryTags!.Eat = [...new Set([...(state.categoryTags!.Eat ?? []), tag.id])];
        continue;
      }
      // A clearly identified cuisine is already the user's explicit choice.
      // Do not ask them to confirm an unambiguous Qloo taxonomy entry twice.
      if (cuisineName) {
        const canonical=cuisineName.toLowerCase();
        const matches=choices.filter(tag =>
          /urn:tag:(?:cuisine|category:place)/i.test(tag.id) &&
          (tag.name.toLowerCase()===canonical || tag.name.toLowerCase()===canonical+" cuisine" ||
           tag.name.toLowerCase()===canonical+" restaurant" || tag.name.toLowerCase()===canonical+" restaurants")
        );
        const preferred=matches.filter(tag=>tag.id.startsWith("urn:tag:cuisine:"));
        const verified=choices.length===1 && matches.length > 0 ? choices[0]
          : preferred.length===1?preferred[0]:matches.length===1?matches[0]:undefined;
        if(verified) {
          state.tags=[...state.tags.filter(tag=>tag.id!==verified.id),verified].slice(-50);
          const old=state.categoryTags!.Eat??[];
          // Switching cuisines replaces the old restrictive cuisine filter.
          state.categoryTags!.Eat=[...new Set([...old.filter(id=>!state.tags.some(tag=>tag.id===id && /cuisine|restaurant/i.test(`${tag.id} ${tag.name}`))),verified.id])];
          event(`${verified.name} dining filter confirmed by Qloo`,"complete");
          continue;
        }
      }
      // Generic venue genres describe the requested output, not a new personal taste.
      // Resolve their actual Qloo taxonomy without another taste-confirmation dialog.
      const genericGenre =
        targets.length === 1 &&
        targets[0] === "Culture" &&
        /^(?:(?:museums?|art galler(?:y|ies)|galleries|restaurants?)(?:\s+(?:or|and)\s+)?)+$/i.test(
          concept.trim(),
        );
      const genres = genericGenre
        ? choices.filter(
            (t) =>
              t.id.includes(":place:") &&
              (excluding
                ? /^(restaurant|restaurants)$/i
                : /^(museum|museums|art gallery|art galleries|gallery|galleries)$/i
              ).test(t.name),
          )
        : [];
      if (genres.length) {
        state.tags = [
          ...new Map([...state.tags, ...genres].map((t) => [t.id, t])).values(),
        ];
        state.categoryTags!.Culture = [
          ...new Set([
            ...(state.categoryTags!.Culture ?? []),
            ...genres.map((t) => t.id),
          ]),
        ];
        const old = state.queryPreferences!.Culture ?? {};
        state.queryPreferences!.Culture = patchPreferences(
          old,
          excluding
            ? {
                excludeTags: [
                  ...new Set([
                    ...(old.excludeTags ?? []),
                    ...genres.map((t) => t.id),
                  ]),
                ],
              }
            : {
                includeTags: [
                  ...new Set([
                    ...(old.includeTags ?? []),
                    ...genres.map((t) => t.id),
                  ]),
                ],
                tagOperator: "union",
              },
        );
        if (intent.strategy !== "rank")
          modelChoices = modelChoices.filter((c) => c.name !== "qloo_rank");
        continue;
      }
      if (choices.length) {
        state.pending = {
          query: concept,
          candidates: choices,
          sections: targets,
          conceptSections: scopedTargets,
          activityGenres: intent.activityGenres,
          constraints: intent.constraints,
          strategy:
            intent.strategy === "rank" ||
            modelChoices.some((c) => c.name === "qloo_rank")
              ? "rank"
              : "discover",
          rankMcp: modelChoices.some((c) => c.name === "qloo_rank"),
          optional: false,
          request: comparedRequest,
          exclude: excluding,
          remainingConcepts: excluding
            ? []
            : concepts.slice(concepts.indexOf(concept) + 1, 4),
          remainingExcludeConcepts: excluding
            ? []
            : (intent.excludeConcepts ?? []).filter(
                (candidate) => candidate !== concept,
              ),
        };
        event("Concept matches returned · your choice needed", "complete");
        return reply(
          excluding
            ? "Choose the concept to exclude before I update that section. Your current Passport is unchanged."
            : "Choose the concept you mean before I update that section. Your current passport is unchanged.",
        );
      }
      event("No matching concept returned", "attention");
      if (/quiet/i.test(concept)) return reply("I could not verify the requested quiet-atmosphere requirement. Your discoveries are unchanged; retry or explicitly relax quietness.");
      return reply(
        scopedTargets.includes("Eat")
          ? `I can help find ${concept} restaurants in ${state.city}, but Qloo did not return a verified cuisine tag this time. I kept your current discoveries rather than showing unrelated places. Try a specific dish such as biryani, or try the cuisine again.`
          : "I couldn’t verify that interest in Qloo. Your discoveries are safe; try a more specific phrase.",
      );
    } catch {
      event("Concept workflow unavailable", "attention");
      if (/quiet/i.test(concept)) return reply("I could not verify the requested quiet-atmosphere requirement. Your discoveries are unchanged; retry or explicitly relax quietness.");
      return reply(
        "Concept refinement is temporarily unavailable. Your existing passport is still available.",
      );
    }
  }
  for (const section of targets) {
    if (!sectionOrder.includes(section)) continue;
    // Explicit requests replace previous refinement constraints. Feedback can
    // retain this category's settings, but no other category contributes state.
    const constraints = [
      ...new Set([
        ...(input.guided || input.recovery
          ? []
          : (state.categoryConstraints[section] ?? state.constraints)),
        ...intent.constraints,
      ]),
    ].filter(
      (c) =>
        !(
          c === "expensive" &&
          (state.queryPreferences?.[section]?.priceMax ?? 2) > 2
        ),
    );
    state.categoryConstraints[section] = constraints;
    const excluded = state.feedback.filter((f) => !f.accepted).map((f) => f.id);
    const rank =
      intent.strategy === "rank" ||
      modelChoices.some((c) => c.name === "qloo_rank");
    if (rank) state.explorationMode = "shortlist";
    event(
      `${rank ? "Ranking" : "Updating"} your ${section} passport`,
      "active",
    );
    try {
      let cards: Card[];
      // The MCP rank contract cannot apply the native category's optional
      // filters. Constrained ranking must use the shared filtered pipeline.
      const useMcpRank =
        constraints.length === 0 &&
        !Object.keys(state.queryPreferences?.[section] ?? {}).length &&
        mode === "model-mcp" &&
        modelChoices.some((c) => c.name === "qloo_rank");
      if (rank && useMcpRank) {
        const existing = state.cards
          .filter((c) => c.section === section && !excluded.includes(c.id))
          .slice(0, 10);
        const args = {
          options: existing.map((c) => c.id),
          option_type: sectionTypes[section],
          signals: state.selected
            .filter((s) => !s.id.startsWith("urn:tag:"))
            .map((s) => s.id),
          signal_location: state.city,
        };
        const ranked = await guard.run("qloo_rank", args, () =>
          deps.workflow("mcp", "qloo_rank", args, guard.signal),
        );
        if (ranked.status !== "ok" || !Array.isArray(ranked.results))
          throw Error("Ranking failed");
        cards = ranked.results.filter(isObject).flatMap((r) => {
          const c = existing.find((c) => c.id === r.entity_id);
          return c
            ? [
                {
                  ...c,
                  inputSignals: state.selected
                    .filter((s) => !s.id.startsWith("urn:tag:"))
                    .map((s) => s.name),
                  ...(c.evidence
                    ? {
                        evidence: {
                          ...c.evidence,
                          ranking: {
                            operation: "qloo_rank" as const,
                            signals: args.signals,
                            options: args.options,
                            destination: state.city,
                            ...(typeof r.affinity === "number"
                              ? { affinity: r.affinity }
                              : {}),
                          },
                        },
                      }
                    : {}),
                  ...(typeof r.affinity === "number"
                    ? { affinity: r.affinity }
                    : {}),
                },
              ]
            : [];
        });
        if (!cards.length) throw Error("No validated shortlist");
      } else {
        cards = [];
        let applied = constraints;
        for (const attempt of relaxationSteps(constraints)) {
          applied = attempt;
          const candidates = await guard.run(
            "direct_discovery",
            { section, constraints: attempt, excluded, rank },
            () =>
              deps.discover(
                state,
                section,
                attempt,
                excluded,
                rank,
                guard.signal,
              ),
          );
          cards = candidates.filter(
            (c) =>
              c.section === section &&
              !excluded.includes(c.id) &&
              !state.selected.some((s) => s.id === c.id),
          );
          if (cards.length) break;
        }
        const relaxed = constraints.filter((c) => !applied.includes(c));
        if (relaxed.length)
          state.relaxed!.push({ section, constraints: relaxed });
      }
      const existingIds = new Set(state.selected.map((s) => s.id));
      cards = cards.filter(
        (c) =>
          c.section === section &&
          !excluded.includes(c.id) &&
          !existingIds.has(c.id) &&
          matchesDishRequirements(c,section === "Eat" ? sectionTags(state,section) : []),
      );
      if (!cards.length) {
        state.recovery!.push(section);
        event(
          `No strong ${section} match yet. Your current discoveries are still here.`,
          "attention",
        );
        continue;
      }
      state.previous = [
        ...state.previous,
        ...state.cards.filter((c) => c.section === section),
      ].slice(-200);
      state.cards = [
        ...state.cards.filter((c) => c.section !== section),
        ...cards,
      ];
      changed.push(section);
      event(`${section} suggestions updated`, "complete");
      if (cards.length < 3) {
        state.notices.push(
          `Limited ${section} coverage: ${cards.length} valid match${cards.length === 1 ? "" : "es"}. Try Balanced or Explore.`,
        );
        event(
          `Limited ${section} coverage · try Balanced or Explore`,
          "attention",
        );
      }
    } catch (error) {
      if (isObject(error) && error.status === 429) {
        state.recovery!.push(section);
        event(
          `Recommendation service is busy · previous ${section} results retained`,
          "attention",
        );
        continue;
      }
      // A failed optional MCP rank can fall back to one known deterministic query.
      if (
        rank &&
        mode === "model-mcp" &&
        modelChoices.some((c) => c.name === "qloo_rank")
      )
        try {
          const cards = await guard.run("ranking_fallback", { section }, () =>
            deps.discover(
              state,
              section,
              constraints,
              excluded,
              true,
              guard.signal,
            ),
          );
          const safeCards = cards.filter(
            (c) =>
              c.section === section &&
              !excluded.includes(c.id) &&
              !state.selected.some((s) => s.id === c.id) &&
              matchesDishRequirements(c,section === "Eat" ? sectionTags(state,section) : []),
          );
          if (safeCards.length) {
            state.cards = [
              ...state.cards.filter((c) => c.section !== section),
              ...safeCards,
            ];
            changed.push(section);
            event(`${section} suggestions updated`, "complete");
            continue;
          }
        } catch {}
      state.recovery!.push(section);
      event(
        `${section} is temporarily unavailable. Your current discoveries are still here.`,
        "attention",
      );
    }
  }
  for (const section of state.recovery ?? []) {
    if (changed.includes(section)) continue;
    state.failedSearches ??= {};
    state.failedSearches[section] = refinementSettings(state, section);
    restoreRefinementSettings(state, section, refinementSettings(original, section));
  }
  for (const section of changed) if (state.failedSearches) delete state.failedSearches[section];
  state.relaxed = state.relaxed?.filter(item => changed.includes(item.section));
  if (intent.constraints.includes("crowded"))
    state.notices = [
      ...state.notices,
      "Quiet cultural tags do not establish current crowd levels.",
    ];
  if (intent.constraints.includes("expensive"))
    state.notices = [
      ...state.notices,
      "Affordable suggestions use available price categories; check actual menu prices before going.",
    ];
  state.notices = [...new Set(state.notices)].slice(-10);
  if (comparedRequest)
    state.comparison = captureComparison(
      state,
      comparedRequest,
      targets,
      changed,
    );
  return reply(
    changed.length
      ? `Updated ${changed.map(section => sectionLabel(section)).join(", ")} suggestions. ${decisionSummary(original, state, changed)} ${state.relaxed!.length ? "I couldn't find a strong match satisfying every preference, so these results prioritize your confirmed cultural tastes. Optional preferences relaxed: " + [...new Set(state.relaxed!.flatMap((r) => r.constraints))].map((c) => (c === "crowded" ? "quiet atmosphere" : c)).join(", ") + ". " : ""}${state.pending ? "You can also confirm the atmosphere concept to refine further. " : ""}Your other categories and confirmed interests are unchanged.${previewRefinedResults(state, changed)}`
      : "I couldn’t apply that search because no verified match was returned. Your previous discoveries and their active preferences are unchanged. The attempted search is kept separately so you can adjust it or retry.",
    changed.length ? chatShortlist(state,changed) : undefined,
  );
}
