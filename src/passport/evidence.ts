import type { Candidate, Card, Section } from "./model.ts";
import type { Entity } from "../qloo/types.ts";
import { sectionOrder } from "../workspace/state.ts";
import { isObject } from "../qloo/types.ts";
import { normalizeEntity } from "../qloo/normalizer.ts";
import {
  supportedParameterNames,
  type QueryDiagnostics,
} from "../qloo/query-plan.ts";
export type Familiarity = "familiar" | "balanced" | "explore";
export const familiarities: Familiarity[] = ["familiar", "balanced", "explore"];
export interface QlooEvidence {
  source: "Qloo";
  operation: "/v2/insights/";
  queryId: string;
  recordedAt: string;
  destination: string;
  locality: "physical-city" | "audience-context";
  mode: Familiarity;
  pool: "direct" | "adjacent" | "profile";
  inputs: {
    id: string;
    name: string;
    types: string[];
    role: "entity-signal" | "tag-signal" | "tag-filter";
  }[];
  params: Record<string, string>;
  result: {
    id: string;
    type: string;
    tags: { id: string; name: string; type?: string }[];
    geocode?: Record<string, string>;
    affinity?: { field: "query.affinity"; value: number };
  };
  fusion?: {
    method: "weighted-rrf";
    score: number;
    sources: { queryId: string; pool: QlooEvidence["pool"]; rank: number; weight: number }[];
  };
  strategyNote?: string;
  diagnostics?: QueryDiagnostics;
  ranking?: {
    operation: "qloo_rank";
    signals: string[];
    options: string[];
    destination: string;
    affinity?: number;
  };
}
export function withEvidence(
  cards: Card[],
  entities: Entity[],
  params: Record<string, string>,
  candidates: Candidate[],
  destination: string,
  mode: Familiarity = "familiar",
  pool: QlooEvidence["pool"] = "profile",
): Card[] {
  const queryId = crypto.randomUUID(),
    recordedAt = new Date().toISOString();
  const inputs: QlooEvidence["inputs"] = [];
  for (const [key, role] of [
    ["signal.interests.entities", "entity-signal"],
    ["signal.interests.tags", "tag-signal"],
    ["filter.tags", "tag-filter"],
  ] as const) {
    for (const id of (params[key] ?? "").split(",").filter(Boolean)) {
      const candidate = candidates.find((c) => c.id === id);
      inputs.push({
        id,
        name: candidate?.name ?? id,
        types:
          candidate?.types ?? (id.startsWith("urn:tag:") ? ["urn:tag"] : []),
        role,
      });
    }
  }
  return cards.flatMap((card) => {
    const entity = entities.find((e) => e.entity_id === card.id);
    if (!entity) return [];
    const tags = Array.isArray(entity.tags)
      ? entity.tags
          .filter(isObject)
          .filter((t) => typeof t.id === "string" && typeof t.name === "string")
          .map((t) => ({
            id: String(t.id),
            name: String(t.name),
            ...(typeof t.type === "string" ? { type: t.type } : {}),
          }))
      : [];
    const geo = entity.properties?.geocode;
    const geocode = isObject(geo)
      ? (Object.fromEntries(
          Object.entries(geo).filter(
            ([key, value]) =>
              ["city", "metro", "name", "country"].includes(key) &&
              typeof value === "string",
          ),
        ) as Record<string, string>)
      : undefined;
    const affinity =
      typeof entity.query?.affinity === "number" &&
      Number.isFinite(entity.query.affinity)
        ? entity.query.affinity
        : undefined;
    const evidence: QlooEvidence = {
      source: "Qloo",
      operation: "/v2/insights/",
      queryId,
      recordedAt,
      destination,
      locality: params["filter.location.query"] || params["filter.location"]
        ? "physical-city"
        : "audience-context",
      mode,
      pool,
      inputs,
      params: Object.fromEntries(
        Object.entries(params).filter(([key]) =>
          supportedParameterNames(
            params["filter.type"]?.replace("urn:entity:", ""),
          ).has(key),
        ),
      ),
      result: {
        id: entity.entity_id,
        type: entity.subtype ?? entity.type ?? entity.types?.[0] ?? "Unknown",
        tags,
        ...(geocode ? { geocode } : {}),
        ...(affinity !== undefined
          ? { affinity: { field: "query.affinity", value: affinity } }
          : {}),
      },
    };
    const { affinity: _old, ...rest } = card;
    return [
      {
        ...rest,
        ...(affinity !== undefined ? { affinity } : {}),
        inputSignals: [
          ...new Set(
            inputs
              .filter((i) => candidates.some((c) => c.id === i.id))
              .map((i) => i.name),
          ),
        ],
        evidence,
        intelligence: normalizeEntity(entity),
      },
    ];
  });
}
/** One visible route per category, never one row per underlying query/pool.
 * Each card keeps its own unmodified Qloo evidence and provenance.
 */
export function bridgeRoutes(cards: Card[], signals: Candidate[]) {
  const groups = new Map<string, {
    id: string;
    section: Section;
    destination: string;
    locality: QlooEvidence["locality"];
    mode: Familiarity;
    pool: QlooEvidence["pool"];
    inputs: Candidate[];
    count: number;
  }>();
  const counts = new Map<string, Set<string>>();
  for (const card of cards) {
    const evidence = card.evidence;
    if (!evidence || evidence.source !== "Qloo" || evidence.result.id !== card.id) continue;
    const relevant = signals.filter(signal =>
      evidence.inputs.some(input => input.id === signal.id));
    if (!relevant.length) continue;
    const key = card.section; // The active Passport has one destination.
    const existing = groups.get(key);
    if (existing) {
      const seen = new Set(existing.inputs.map(input => input.id));
      existing.inputs.push(...relevant.filter(input => !seen.has(input.id)));
      if (existing.mode !== evidence.mode) existing.mode = "balanced";
      if (existing.pool !== evidence.pool) existing.pool = "profile";
      if (evidence.locality === "physical-city") existing.locality = "physical-city";
      counts.get(key)!.add(card.id);
      existing.count = counts.get(key)!.size;
    } else {
      counts.set(key, new Set([card.id]));
      groups.set(key, {
        id: key,
        section: card.section,
        destination: evidence.destination,
        locality: evidence.locality,
        mode: evidence.mode,
        pool: evidence.pool,
        inputs: [...relevant],
        count: 1,
      });
    }
  }
  return [...groups.values()].sort((a,b) =>
    sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section));
}
export function sparseSections(cards: Card[], sections: Section[]) {
  return sections.filter(
    (section) => cards.filter((c) => c.section === section).length < 3,
  );
}
