import type { Intent } from "../agent/types.ts";
import type { Candidate, Card, Section } from "../passport/model.ts";
import { validDestination } from "./location.ts";
export type Phase =
  | "idle"
  | "review"
  | "resolving"
  | "confirming"
  | "exploring"
  | "ready"
  | "error"
  | "refining"
  | "interpreting";
export interface Resolution {
  items: { query: string; candidates: Candidate[] }[];
  token: string;
}
export interface AgentSession {
  sessionId: string;
  revision: number;
  tags: Candidate[];
  constraints: string[];
  pending?: { query: string; candidates: Candidate[] };
}
export interface Passport {
  city: string;
  selected: Candidate[];
  cards: Card[];
  notices: string[];
  explanation: string;
  agent?: AgentSession;
  session?: import("../agent/types.ts").TastePassportSession;
}
export const destinations = [
  "Toronto",
  "New York City",
  "London",
  "Paris",
  "Tokyo",
  "Bengaluru",
  "Mumbai",
  "Singapore",
  "Berlin",
  "Sydney",
];
export function supportedCity(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const name = value.split(",")[0].trim().toLowerCase();
  const canonical = name === "bangalore" ? "bengaluru" : name === "nyc" || name === "new york" ? "new york city" : name;
  return destinations.find(city => city.toLowerCase() === canonical);
}
export const sectionOrder: Section[] = [
  "Eat",
  "Coffee",
  "Music",
  "Culture",
  "Lifestyle",
  "Movies", "Books", "Podcasts", "Shows", "Games", "Brands", "People", "Destinations",
];
/** Deliberately deterministic, editable extraction. No LLM or inferred interests.
 * Commas/newlines separate tastes; a final "and" is recognized. Users review
 * the draft before sending it to Qloo, because titles can contain conjunctions. */
export function extractDraft(text: string, fallback: string) {
  const explicitCity = text.match(/\b(?:moving|relocating)\s+(?:from\s+.+?\s+)?to\s+([^.!?]+?)(?=\.\s|\s+I\s+(?:love|like|enjoy)|$)/i)?.[1]?.trim();
  const city = explicitCity && validDestination(explicitCity)
    ? (/^(?:new york(?: city)?|nyc)$/i.test(explicitCity) ? "New York City" : explicitCity)
    : /\bnew york(?: city)?\b|\bnyc\b/i.test(text)
    ? "New York City"
    : (destinations.find(
        (c) =>
          c !== "New York City" && new RegExp(`\\b${c}\\b`, "i").test(text),
      ) ?? fallback);
  const tastePart =
    text.match(
      /\b(?:i love|i like|i enjoy|my tastes? (?:are|include)|i'm into)\s+([\s\S]+)/i,
    )?.[1] ?? text;
  const tastes = tastePart
    .replace(/[.!?]+\s*$/, "")
    .split(/[,;\n]+|\s+and\s+/i)
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return { city, tastes: [...new Set(tastes)] };
}
export function visibleSections(cards: Card[]) {
  return sectionOrder.filter((s) => cards.some((c) => c.section === s));
}
export function confirmed(
  resolution: Resolution | undefined,
  chosen: Record<number, string>,
): Candidate[] {
  if (!resolution) return [];
  return resolution.items.flatMap((item, i) =>
    item.candidates.filter((c) => c.id === chosen[i]),
  );
}
export function typeLabel(candidate: Candidate) {
  return candidate.types
    .map((t) =>
      t.startsWith("urn:tag")
        ? `cultural concept · ${t.split(":")[2] ?? "taste"}`
        : t.replace("urn:entity:", "").replaceAll("_", " "),
    )
    .join(" · ");
}

export function onboardingTastes(intent: Intent): string[] {
  const key = (text: string) =>
    text
      .toLowerCase()
      .trim()
      .replace(/^indian (?:food|cuisine)$/, "indian");
  return [
    ...new Map(
      [...intent.seeds, ...intent.concepts].map((text) => [key(text), text]),
    ).values(),
  ];
}

/** Read-only rendering projection of the canonical session, not another state machine. */
export function passportView(
  session: import("../agent/types.ts").TastePassportSession,
  explanation: string,
): Passport {
  return {
    city: session.city,
    selected: session.selected,
    cards: session.cards.filter(
      (c) => !session.hiddenCategories.includes(c.section),
    ),
    notices: session.notices,
    explanation,
    session,
    agent: {
      sessionId: session.id,
      revision: session.revision,
      tags: session.tags,
      constraints: session.constraints,
      pending: session.pending,
    },
  };
}
