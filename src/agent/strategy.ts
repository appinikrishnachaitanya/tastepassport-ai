import type { AgentState } from "./types.ts";
import { sectionTypes, type Card, type Section } from "../passport/model.ts";
import type { Familiarity, QlooEvidence } from "../passport/evidence.ts";
export interface DiscoveryQuery {
  params: Record<string, string>;
  pool: QlooEvidence["pool"];
  note?: string;
}
/** Only existing native parameters. Broadening soft profile tags is an explicit
 * exploration choice; primary concepts named in a refinement remain hard filters. */
export function discoveryQueries(
  base: Record<string, string>,
  state: AgentState,
  section: Section,
  mode: Familiarity,
): DiscoveryQuery[] {
  const direct = { ...base };
  const adjacent = { ...base };
  const explicitTags = new Set(state.categoryTags?.[section] ?? []);
  const placeOnlyTag = (id: string) => /^urn:tag:(?:cuisine|specialty_dish|dietary_option|dietary_attribute|ambience):/.test(id) || /^urn:tag:(?:genre|category):place:/.test(id);
  if (sectionTypes[section] !== "place" && base["signal.interests.entities"]) {
    // A cuisine tag can swamp film/artist signals. Keep intentionally refined
    // concepts, but do not automatically translate food/ambience into content.
    const tags = (adjacent["signal.interests.tags"] ?? "").split(",").filter(id => id && (explicitTags.has(id) || !placeOnlyTag(id)));
    if (tags.length) adjacent["signal.interests.tags"] = tags.join(",");
    else delete adjacent["signal.interests.tags"];
  }
  // Same-domain seeds anchor familiar content. Cross-domain signals stay in the
  // adjacent query, rather than overwhelming a film with an unrelated artist.
  const outputType = `urn:entity:${sectionTypes[section]}`;
  const relevantIds = [...new Set([
    ...state.selected.filter(seed => seed.types.includes(outputType)).map(seed => seed.id),
    ...state.feedback.filter(feedback => feedback.accepted && feedback.section === section)
      .slice(-2).map(feedback => feedback.id),
  ])];
  if (relevantIds.length) {
    direct["signal.interests.entities"] = relevantIds.join(",");
    if (sectionTypes[section] !== "place") {
      // Explicit category refinements remain signals; unrelated profile cuisine
      // must not steer the familiar movie/music/book retrieval.
      const domain = sectionTypes[section];
      const families = [domain, ...(domain === "movie" ? ["media", "film"] : domain === "artist" ? ["music"] : [])];
      const tags = (direct["signal.interests.tags"] ?? "").split(",").filter(id =>
        explicitTags.has(id) || (!placeOnlyTag(id) && families.some(family => id.includes(`:${family}:`))));
      if (tags.length) direct["signal.interests.tags"] = tags.join(",");
      else delete direct["signal.interests.tags"];
    }
  }
  // The current hackathon/type references do not document bias.content_based.
  // Styles must differ through real seed routing and soft-tag expansion, not
  // an undocumented numeric knob that can be silently ignored by Qloo.
  delete direct["bias.content_based"];
  delete adjacent["bias.content_based"];
  const explicitConcepts = state.categoryConcepts?.[section]?.length ||
    (state.intent?.sections.includes(section) && state.intent.concepts.length);
  if (section !== "Music" && !explicitConcepts) {
    const ids = (adjacent["filter.tags"] ?? "").split(",").filter(Boolean);
    const soft = ids.filter((id) =>
      state.selected.some(selected => selected.id === id) &&
      !/^urn:tag:(?:ambience|dietary_option|dietary_attribute):/.test(id),
    );
    const hard = ids.filter((id) => !soft.includes(id));
    if (soft.length)
      adjacent["signal.interests.tags"] = [
        ...new Set([
          ...(adjacent["signal.interests.tags"] ?? "")
            .split(",")
            .filter(Boolean),
          ...soft,
        ]),
      ].join(",");
    if (hard.length) adjacent["filter.tags"] = hard.join(",");
    else {
      delete adjacent["filter.tags"];
      delete adjacent["operator.filter.tags"];
    }
  }
  // Every strategy keeps at least one confirmed entity/tag signal. A generic
  // city search is never used as a substitute for cultural translation.
  const grounded = (params: Record<string, string>) =>
    Boolean(
      params["signal.interests.entities"] ||
      params["signal.interests.tags"] ||
      params["filter.tags"]
        ?.split(",")
        .some((id) => state.tags.some((t) => t.id === id)),
    );
  if (!grounded(direct) || !grounded(adjacent)) return [];
  if (mode === "familiar") return [{ params: direct, pool: "direct" }];
  if (JSON.stringify(direct) === JSON.stringify(adjacent))
    return [
      {
        params: direct,
        pool: "profile",
        note: "The current signals and refinement requirements do not support a distinct broader query for this category yet. The current cultural query is retained.",
      },
    ];
  if (mode === "explore") return [{ params: adjacent, pool: "adjacent" }];
  return [
    { params: direct, pool: "direct" },
    { params: adjacent, pool: "adjacent" },
  ];
}
/** Weighted reciprocal-rank fusion: ranks, not incomparable per-query affinity.
 * Balanced reserves up to four slots for adjacent-only discoveries. The weights
 * and quota are product policy, not learned probabilities or measured accuracy. */
export function mixPools(pools: Card[][]): Card[] {
  const available = pools.filter(pool => pool.length);
  if (available.length < 2) return (available[0] ?? []).filter((card, index, cards) => cards.findIndex(item => item.id === card.id) === index);
  type FusedResult = {
    card: Card;
    score: number;
    direct: boolean;
    sources: NonNullable<QlooEvidence["fusion"]>["sources"];
  };
  const ranked = new Map<string, FusedResult>();
  // Activity subqueries must not gain extra influence simply because one
  // family issued more queries. Normalize within direct/adjacent families.
  const directCount = available.filter(pool => pool[0]?.evidence?.pool !== "adjacent").length;
  const adjacentCount = available.length - directCount;
  for (const pool of available) {
    const direct = pool[0]?.evidence?.pool !== "adjacent";
    const weight = direct ? 0.75 / directCount : 0.25 / adjacentCount;
    const seen = new Set<string>();
    pool.forEach((card, index) => {
      if (seen.has(card.id)) return;
      seen.add(card.id);
      const entry = ranked.get(card.id) ?? { card, score: 0, direct: false, sources: [] };
      entry.score += weight / (60 + index + 1);
      if (direct && !entry.direct) entry.card = card;
      entry.direct ||= direct;
      if (card.evidence) entry.sources.push({ queryId: card.evidence.queryId, pool: card.evidence.pool, rank: index + 1, weight });
      ranked.set(card.id, entry);
    });
  }
  const sorted = [...ranked.values()].sort((a,b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
  const adjacent = sorted.some(entry => entry.direct)
    ? sorted.filter(entry => !entry.direct).slice(0,4)
    : [];
  const reserved = new Set(adjacent.map(entry => entry.card.id));
  const selected = [...sorted.filter(entry => !reserved.has(entry.card.id)).slice(0,20-adjacent.length), ...adjacent];
  return selected.map(entry => entry.card.evidence ? {
    ...entry.card,
    evidence: { ...entry.card.evidence, fusion: { method: "weighted-rrf", score: entry.score, sources: entry.sources } },
  } : entry.card);
}
