import { matchesDishRequirements } from "../passport/dish-evidence.ts";
import { activityMatches } from "../passport/day-out.ts";
import { rankDiverseChoices } from "./ranking.ts";
import "server-only";
import { debugEvent } from "./debug.ts";
import { discoveryQueries, mixPools } from "./strategy.ts";
import { withEvidence } from "../passport/evidence.ts";
import { sectionTags } from "./session.ts";
import { workflow, discoverTools } from "./harness.ts";
import { configuredProvider } from "./provider.ts";
import { tagCandidates, validateDiscoveries } from "./validation.ts";
import { culturalText, isConcept } from "./intent.ts";
import { TurnGuard } from "./guard.ts";
import { search, insights, insightParams, QlooError } from "../qloo/client.ts";
import { candidates } from "../passport/model.ts";
import type { AgentDependencies } from "./orchestrator.ts";
import type { AgentState, Constraint } from "./types.ts";
import { diversifyCards, sectionTypes, knownChain } from "../passport/model.ts";
import type { Card, Section } from "../passport/model.ts";
import { buildQuery } from "../qloo/query-plan.ts";
import { findTags } from "../qloo/lookups.ts";

export function agentDependencies(): AgentDependencies {
  let provider;
  try {
    provider = configuredProvider();
  } catch {}
  return {
    provider,
    tools: discoverTools,
    workflow: async (transport,name,args,signal) => {
      try {
        const result=await workflow(transport,name,args,signal);
        if(name !== "qloo_find_tags" || tagCandidates(result,String(args.query ?? "")).length) return result;
      } catch(error) { if(name !== "qloo_find_tags") throw error; }
      if(typeof args.query !== "string")throw Error("Invalid concept lookup");
      const tags=await findTags(args.query,signal);
      return {status:"ok",results:tags.map(tag=>({id:tag.id,name:tag.name,type:tag.types[0]})),execution:{transport:"native"}};
    },
    discover: discoverSection,
  };
}
export async function resolveCulturalSeeds(
  queries: string[],
  concepts: string[] = [],
) {
  debugEvent("resolution.started", { count: queries.length });
  const deadline=AbortSignal.timeout(75_000);
  const guard = new TurnGuard(5, 75_000, deadline);
  const items = [];
  for (const query of queries) {
    culturalText(query, 100);
    if (isConcept(query) || concepts.includes(query)) {
      let matches: ReturnType<typeof tagCandidates> = [];
      try {
        const result = await guard.run(
          "qloo_find_tags",
          { query, limit: 5 },
          () => workflow("exec", "qloo_find_tags", { query, limit: 5 }, deadline),
        );
        matches=tagCandidates(result, query);
      } catch { /* Native lookup below is the bounded supported fallback. */ }
      items.push({query,candidates:matches.length ? matches : await findTags(query,deadline)});
    } else {
      try {
        const entities = await guard.run("entity_search", { query }, () =>
          search(query,deadline),
        );
        items.push({ query, candidates: candidates(entities) });
      } catch (e) {
        if (e instanceof QlooError && e.status === 404) items.push({ query, candidates: [] });
        else throw e;
      }
    }
  }
  items.forEach((item, seedIndex) =>
    debugEvent("resolution.candidates", {
      seedIndex,
      count: item.candidates.length,
    }),
  );
  debugEvent("resolution.completed", {
    count: items.reduce((n, item) => n + item.candidates.length, 0),
  });
  return items;
}
/** The restaurant tag below was observed in real Qloo responses during Phase 1.
 * It is a physical place genre, not an invented keyword/endpoint. */
export async function discoverSection(
  state: AgentState,
  section: Section,
  constraints: Constraint[],
  excluded: string[],
  rank: boolean,
  signal?: AbortSignal,
): Promise<Card[]> {
  debugEvent("discovery.started", {
    section,
    city: state.city,
    signalCount: state.selected.length,
    excludedCount: excluded.length,
  });
  const type = sectionTypes[section];
  const preferences = state.queryPreferences?.[section] ?? {};
  // A numeric budget choice supersedes the older qualitative "cheaper" flag.
  // In particular, Any budget (4) must clear both its query cap and local veto.
  const appliedConstraints = preferences.priceMax !== undefined || (preferences.priceMin ?? 0) > 2
    ? constraints.filter(constraint => constraint !== "expensive")
    : constraints;
  const activityGenres = section === "Culture" ? state.intent?.activityGenres ?? state.activityGenres?.Culture : undefined;
  const activityFilters: string[] = [];
  const entityIds = state.selected
    .filter((s) => !s.id.startsWith("urn:tag:"))
    .map((s) => s.id);
  const likes = state.feedback
    .filter((f) => f.accepted && f.section === section)
    .slice(-2)
    .map((f) => f.id);
  const ids = [...new Set([...entityIds, ...likes])].slice(0, 10);
  const params = ids.length
    ? insightParams(ids, type, type === "place")
    : { "filter.type": `urn:entity:${type}`, take: "20" };
  params.take = "20";
  params[type === "place" ? "filter.location.query" : "signal.location.query"] =
    state.city;
  if (type === "place") params["filter.location.radius"] = "0";
  const excludedTags = new Set(
    state.queryPreferences?.[section]?.excludeTags ?? [],
  );
  const tags = sectionTags(state, section)
    .filter((tag) => !excludedTags.has(tag.id))
    .filter(
      (t) =>
        t.id.includes(":place:") ||
        t.id.includes(":restaurant:") ||
        t.id.includes(":cuisine:") ||
        t.id.includes(":ambience:") ||
        t.id.startsWith("urn:tag:dietary_option:"),
    );
  if (type === "place" && sectionTags(state, section).length)
    params["signal.interests.tags"] = sectionTags(state, section).filter(tag => !excludedTags.has(tag.id)).map((t) => t.id).join(",");
  if (section === "Eat") {
    const dishes = tags.filter((tag) => tag.id.startsWith("urn:tag:specialty_dish:place:"));
    const cuisine = dishes.length ? dishes : tags.filter(
      (t) =>
        !t.id.includes(":ambience:") &&
        /indian|biryani|cuisine|restaurant|savour|savory|food|dish/i.test(
          `${t.id} ${t.name} ${t.detail}`,
        ),
    );
    const atmosphere = constraints.includes("crowded")
      ? tags.filter((t) => t.id.includes(":ambience:"))
      : [];
    params["filter.tags"] = [
      "urn:tag:genre:place:restaurant",
      ...cuisine.map((t) => t.id),
      ...atmosphere.map((t) => t.id),
      ...tags.filter(t => t.id.startsWith("urn:tag:dietary_option:")).map(t => t.id),
    ].join(",");
    params["operator.filter.tags"] = "intersection";
  } else if (type === "place" && tags.length) {
    const relevant = tags.filter(
      (t) =>
        (constraints.includes("crowded") && t.id.includes(":ambience:")) ||
        (section === "Coffee" && /coffee|caf[eé]/i.test(t.name)) ||
        (section === "Lifestyle" && /book|shop/i.test(t.name)) ||
        (section === "Culture" &&
          /museum|culture|gallery|theatre|concert|live music|music venue/i.test(t.name)),
    );
    const hardRelevant = section === "Coffee" && !state.categoryConcepts?.Coffee?.length
      ? relevant.filter((tag) => /urn:tag:(?:genre|category):place:/.test(tag.id))
      : relevant;
    if (hardRelevant.length) {
      params["filter.tags"] = hardRelevant.map((t) => t.id).join(",");
      params["operator.filter.tags"] = "intersection";
    }
  }
  // Returned by live qloo_find_tags("museum") in final acceptance. This is a
  // category starting point, not a fabricated personal taste or relationship.
  if (
    section === "Culture" &&
    !activityGenres?.length &&
    !state.intent?.concepts.length &&
    !tags.some(
      (t) =>
        !t.id.includes(":ambience:") &&
        /museum|culture|gallery|theatre/i.test(t.name),
    )
  ) {
    params["filter.tags"] = [
      "urn:tag:genre:place:museum",
      ...(params["filter.tags"] ?? "").split(",").filter(Boolean),
    ].join(",");
    params["operator.filter.tags"] = "intersection";
    state.notices.push(
      "Your Culture chapter starts with museums. Name a more specific cultural interest to guide the next search.",
    );
  }
  // Resolve category taxonomy through Qloo; never substitute a cuisine pool.
  if (
    (section === "Coffee" || section === "Lifestyle" || (section === "Culture" && !activityGenres?.length)) &&
    !params["filter.tags"]
  ) {
    const options = await findTags(
      section === "Coffee" ? "coffee shop" : section === "Lifestyle" ? "bookstore" : "museum",
      signal,
    );
    const category = options.find(
      (t) =>
        t.id.includes(":place:") &&
        (section === "Coffee" ? /coffee|café|cafe/i : section === "Lifestyle" ? /bookstore|book store|book shop/i : /museum/i).test(t.name),
    );
    if (!category) return [];
    params["filter.tags"] = category.id;
  }
  if (type === "artist") {
    const musicTags = sectionTags(state, section).filter(
      (t) => !/:place:|:restaurant:|:cuisine:|:ambience:/.test(t.id),
    );
    if (musicTags.length)
      params["signal.interests.tags"] = musicTags.map((t) => t.id).join(",");
  }
  if (type !== "place" && !params["signal.interests.tags"] && state.selected.some(s=>s.id.startsWith("urn:tag:")))
    params["signal.interests.tags"] = state.selected.filter(s=>s.id.startsWith("urn:tag:")).map(s=>s.id).join(",");
  if (excluded.length)
    params["filter.exclude.entities"] = excluded.slice(-50).join(",");
  if (section === "Culture" && activityGenres?.length) {
    for (const genre of activityGenres) {
      const options = await findTags(genre === "cinema" ? "movie theater" : genre, signal);
      const match = options.find((tag) =>
        /urn:tag:(?:genre|category):place:/.test(tag.id) &&
        (genre === "cinema" ? /cinema|movie theater|movie theatre/i : /nightclub|night club/i).test(tag.name),
      );
      if (match) activityFilters.push(match.id);
    }
    // Never silently replace an explicit cinema/nightlife request with museums.
    if (activityFilters.length !== activityGenres.length) return [];
    params["filter.tags"] = [...activityFilters,...(constraints.includes("crowded")?tags.filter(t=>t.id.includes(":ambience:")).map(t=>t.id):[])].join(",");
    params["operator.filter.tags"] = "union";
  }
  if (appliedConstraints.includes("expensive") && type === "place")
    params["filter.price_level.max"] = "2";
  if (constraints.includes("mainstream"))
    params["filter.popularity.max"] = "0.9";
  if (rank) {
    const options = state.cards
      .filter((c) => c.section === section && !excluded.includes(c.id))
      .slice(0, 10)
      .map((c) => c.id);
    if (!options.length) return [];
    params["filter.results.entities"] = options.join(",");
  }
  const mode =
    state.categoryModes?.[section] ?? state.discoveryMode ?? "familiar";
  const planned = buildQuery({
    outputType: type,
    interests: { entities: ids, tags: [] },
    preferences,
    take: 20,
  });
  // Merge the shared planner's applied settings with existing category filters.
  // Omitted settings remain in the server session; unrelated categories are untouched.
  const categoryFilter = params["filter.tags"];
  Object.assign(params, planned.params);
  if (planned.params["filter.location"]) delete params["filter.location.query"];
  if (preferences.includeTags?.length && type === "place") {
    params["filter.tags"] = [
      ...new Set([
        ...(categoryFilter ?? "").split(",").filter(Boolean),
        ...preferences.includeTags,
      ]),
    ].join(",");
  }
  if (preferences.tagOperator && params["filter.tags"]) {
    params["operator.filter.tags"] = preferences.tagOperator;
    if (preferences.tagOperator === "union" && section === "Eat") {
      const specific = params["filter.tags"]
        .split(",")
        .filter((id) => id !== "urn:tag:genre:place:restaurant");
      if (specific.length) params["filter.tags"] = specific.join(",");
    }
  }
  // A diet requirement must never become an optional alternative to cuisine.
  if (section === "Eat" && tags.some(tag => tag.id.startsWith("urn:tag:dietary_option:")))
    params["operator.filter.tags"] = "intersection";
  if (excluded.length || preferences.excludeEntities?.length)
    params["filter.exclude.entities"] = [
      ...new Set([...excluded, ...(preferences.excludeEntities ?? [])]),
    ]
      .slice(-50)
      .join(",");
  if (planned.diagnostics.dropped.length)
    state.notices.push(
      `Some requested settings could not be applied: ${planned.diagnostics.dropped.map((d) => d.parameter).join(", ")}. Open Why this suggestion for details.`,
    );
  if (preferences.goal === "surprise") {
    // Exploration changes soft taste signals while explicit venue requirements remain hard filters.
    state.categoryModes ??= {};
    state.categoryModes[section] = "explore";
  }
  const queries = discoveryQueries(
    params,
    state,
    section,
    preferences.goal === "surprise" ? "explore" : mode,
  ).flatMap(query=>activityFilters.length ? activityFilters.map(activity=>({
    ...query,
    params:{...query.params,"filter.tags":[activity,...(query.params["filter.tags"] ?? '').split(',').filter(tag=>tag && !activityFilters.includes(tag))].join(','),"operator.filter.tags":"intersection"},
  })) : [query]);
  const sources = [
    ...state.selected,
    ...state.tags,
    ...[...state.cards, ...(state.savedCards ?? [])].filter((c) =>
      likes.includes(c.id),
    ),
  ];
  const pools: Card[][] = [];
  let failure: unknown;
  for (const query of queries) {
    try {
      const result = await insights(query.params, signal);
      const validated = validateDiscoveries(
        result.body,
        state.city,
        section,
        appliedConstraints,
        excluded,
      );
      const grounded = withEvidence(
        validated,
        result.entities,
        result.params,
        sources,
        state.city,
        mode,
        query.pool,
      );
      for (const card of grounded)
        if (card.evidence) {
          card.evidence.queryId = result.traceId;
          card.evidence.diagnostics = {
            ...result.diagnostics,
            dropped: [
              ...planned.diagnostics.dropped,
              ...result.diagnostics.dropped,
            ],
          };
        }
      if (query.note) {
        state.notices.push(query.note);
        for (const card of grounded)
          if (card.evidence) card.evidence.strategyNote = query.note;
      }
      debugEvent("discovery.pool", {
        section,
        mode,
        pool: query.pool,
        count: result.entities.length,
        keptCount: grounded.length,
      });
      pools.push(grounded);
    } catch (error) {
      debugEvent("discovery.failed", { section, mode, pool: query.pool });
      failure = error;
      if (queries.length === 1) throw error;
    }
  }
  if (!pools.some((pool) => pool.length) && failure) throw failure;
  if (failure && pools.some((pool) => pool.length)) {
    const note =
      "One discovery pool is temporarily unavailable. The available Qloo matches are shown.";
    state.notices.push(note);
    for (const pool of pools)
      for (const card of pool)
        if (card.evidence) card.evidence.strategyNote = note;
  }
  if (!rank && !pools.some((pool) => pool.length) && !signal?.aborted) {
    const broader = { ...params };
    delete broader["signal.interests.entities"];
    delete broader["signal.interests.tags"];
    // Keep city, category, explicit concepts, exclusions and all user filters.
    if (type === "place" && broader["filter.tags"]) {
      const result = await insights(broader, signal);
      const valid = validateDiscoveries(
        result.body,
        state.city,
        section,
        appliedConstraints,
        excluded,
      );
      const local = withEvidence(
        valid,
        result.entities,
        result.params,
        sources,
        state.city,
        mode,
        "adjacent",
      );
      for (const card of local)
        if (card.evidence)
          card.evidence.strategyNote =
            "Broader local suggestion. Your venue requirements were kept; taste similarity was broadened.";
      pools.push(local);
    }
  }
  const requestedActivities = state.activityGenres?.[section] ?? [];
  const dishRequirements=section === "Eat" ? sectionTags(state,section) : [];
  const mixed = mixPools(pools).filter(card=>matchesDishRequirements(card,dishRequirements)).filter(card => !requestedActivities.length || requestedActivities.some(genre => activityMatches(card, genre === "cinema" ? "Cinema" : "Nightlife")));
  const avoidMainstream = constraints.includes("mainstream") && ["Eat","Coffee"].includes(section);
  const eligible = avoidMainstream ? mixed.filter(card=>!knownChain(card)) : mixed;
  if (avoidMainstream && eligible.length < mixed.length)
    state.notices.push(`Excluded ${mixed.length-eligible.length} known chain listings from ${section}. Independent ownership of remaining venues is not verified.`);
  const cards = rankDiverseChoices(diversifyCards(eligible, section), section);
  debugEvent("discovery.completed", { section, mode, count: cards.length });
  return cards;
}
