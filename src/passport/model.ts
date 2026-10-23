import { isObject } from "../qloo/types.ts";
import type { Entity } from "../qloo/types.ts";
export const sectionTypes = {
  Eat: "place", Coffee: "place", Culture: "place", Lifestyle: "place",
  Music: "artist", Movies: "movie", Books: "book", Podcasts: "podcast",
  Shows: "tv_show", Games: "video_game", Brands: "brand", People: "person",
  Destinations: "destination",
} as const;
export type Section = keyof typeof sectionTypes;
export const isPlaceSection = (section: Section) => sectionTypes[section] === "place";
export interface Candidate {
  id: string;
  name: string;
  types: string[];
  detail: string;
}
export interface Card extends Candidate {
  section: Section;
  address?: string;
  description?: string;
  affinity?: number;
  inputSignals?: string[];
  evidence?: import("./evidence.ts").QlooEvidence;
  intelligence?: import("../qloo/normalizer.ts").TasteResult;
}
const normalizedBrandName = (name: string) => name.toLowerCase()
  .replace(/\b(?:restaurant|café|cafe|coffee shop)\b/g, " ")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
export function brandNameCounts(cards: Card[]) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const name = normalizedBrandName(card.name);
    const token = card.name.toLowerCase().match(/[a-z][a-z0-9&'-]{3,}/)?.[0];
    for (const key of new Set([`name:${name}`, ...(token ? [`token:${token}`] : [])]))
      counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
export function resultBrand(card: Card, repeatedNames?: Map<string, number>) {
  const tags = card.evidence?.result.tags ?? [];
  const named = tags.find((tag) =>
    /brand|franchise|business:place:chain/i.test(
      `${tag.type ?? ""} ${tag.name}`,
    ),
  );
  if (named) return named.name.toLowerCase().trim();
  const name = normalizedBrandName(card.name);
  if (name && (repeatedNames?.get(`name:${name}`) ?? 0) > 1) return name;
  // Preserve the established cafe branch heuristic. A restaurant sharing a
  // first word such as "Indian" is not enough evidence of a common business.
  const token = card.name.toLowerCase().match(/[a-z][a-z0-9&'-]{3,}/)?.[0];
  if (card.section === "Coffee" && token && (repeatedNames?.get(`token:${token}`) ?? 0) > 1) return token;
  return undefined;
}

/** Keep repeated branches from consuming a physical-place chapter. */
export function diversifyCards(cards: Card[], section: Section) {
  if (!isPlaceSection(section) || cards.length < 3) return cards;
  const nameCounts = brandNameCounts(cards);
  const counts = new Map<string, number>();
  return cards.filter((card) => {
    const brand = resultBrand(card, nameCounts);
    if (!brand) return true;
    const count = counts.get(brand) ?? 0;
    if (count >= 2) return false;
    counts.set(brand, count + 1);
    return true;
  });
}
/** Clean missing-value placeholders without inventing identifying metadata. */
export function candidate(e: Entity): Candidate {
  const p = e.properties ?? {};
  const clean = (value: unknown) => typeof value === "string" || typeof value === "number"
    ? (/^(?:None|null|undefined|N\/A)$/i.test(String(value).trim()) ? "" : String(value).replace(/\s+/g, " ").trim()) : "";
  const types = e.types?.length ? e.types : [e.subtype ?? e.type ?? "Unknown"];
  return {
    id: e.entity_id,
    name: clean(e.name).replace(/\s+(?:None|null|undefined)$/i, ""),
    types,
    detail: [...new Set([...types.map(type => type.replace(/^urn:entity:/, "").replace(/_/g, " ").toLowerCase()),
      clean(p.release_year), clean(p.address), clean(p.short_description)].filter(Boolean))].join(" · ").slice(0, 250),
  };
}
export function candidates(entities: Entity[]): Candidate[] {
  const ids = new Set<string>(), labels = new Set<string>();
  return entities.map(candidate).filter(item => {
    const label = `${item.name}|${item.detail}`.toLowerCase();
    if (!item.name || ids.has(item.id) || labels.has(label)) return false;
    ids.add(item.id); labels.add(label); return true;
  }).slice(0, 10);
}
/** Conservative local classification uses returned tag NAMES only, never invented
 * filter parameters. Unknown types are omitted, and non-leisure services excluded.
 * This sacrifices recall for precision; no inference from taste names. */
export function classify(e: Entity): Section | undefined {
  const tags = Array.isArray(e.tags)
    ? e.tags
        .filter(isObject)
        .map((t) => (typeof t.name === "string" ? t.name.toLowerCase() : ""))
        .join(" ")
    : "";
  const text = `${e.name} ${tags}`.toLowerCase();
  if (
    /consulate|embassy|government|hospital|airport|medical|diplomatic/.test(
      text,
    )
  )
    return;
  if (/coffee|cafe|café|espresso|tea house/.test(tags)) return "Coffee";
  if (/restaurant|dining|cuisine|food|bistro|bakery|pizza/.test(tags))
    return "Eat";
  if (
    /museum|gallery|theater|theatre|performing arts|concert|cinema|cultural|nightclub|night club|live music|music venue/.test(
      tags,
    )
  )
    return "Culture";
  if (/bookstore|book shop|record store|boutique|shopping|yoga/.test(tags))
    return "Lifestyle";
}
export function card(e: Entity, section: Section): Card {
  const p = e.properties ?? {};
  return {
    ...candidate(e),
    section,
    ...(typeof p.address === "string" ? { address: p.address } : {}),
    ...(typeof p.short_description === "string"
      ? { description: p.short_description.slice(0, 500) }
      : {}),
    ...(typeof e.query?.affinity === "number"
      ? { affinity: e.query.affinity }
      : {}),
  };
}

/** Conservative exclusion of known chains, not certification of independent ownership. */
export function knownChain(card: Card): boolean {
  const names = [card.name, ...(card.evidence?.result.tags ?? []).filter(tag=>/brand|chain|franchise/i.test(tag.type ?? tag.id)).map(tag=>tag.name)].join(" ");
  return /\b(?:starbucks|costa(?: coffee)?|pret(?: a manger)?|harris\s*(?:\+|and|&)\s*hoole|caff[eè] nero|tim hortons|dunkin|mcdonald'?s|burger king|kfc|subway|pizza hut|domino'?s|greggs|panera|blue bottle|joe\s*(?:&|and)\s*the juice)\b/i.test(names);
}
