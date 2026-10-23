import { categoryLanguage } from "./category-language.ts";
import { containsConfiguredSecret } from "./secrets.ts";
import { refinementScope } from "./scope.ts";
import {
  extractDraft,
  sectionOrder,
} from "../workspace/state.ts";
import type { Section } from "../passport/model.ts";
import type { Constraint, Intent } from "./types.ts";
import {
  preferencesFromText,
  validatePreferences,
} from "../qloo/query-plan.ts";
import { validDestination } from "../workspace/location.ts";
export function culturalText(value: string, max = 1000): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /@|https?:\/\/|\b(?:my name|email|phone|device id|account id|user id|my address|my home)\b|\+?\d[\d ()-]{7,}\d/i.test(
      value,
    )
  )
    throw new Error(
      "Please share cultural tastes only, without names identifying you, contact details or account identifiers.",
    );
  if (containsConfiguredSecret(value))
    throw Error("Credentials are not cultural inputs.");
  return value.trim();
}
export function constraintsFrom(text: string): Constraint[] {
  const values: Constraint[] = [];
  if (
    /(?:not|don't|doesn't|avoid|less|too|isn't|is not|hate|dislike)[^.]*tourist|non.?tourist/i.test(
      text,
    )
  )
    values.push("touristy");
  if (/quiet|quieter|peaceful|peacefully|less crowded|too crowded|not crowded/i.test(text))
    values.push("crowded");
  if (/niche|less mainstream|too mainstream|not mainstream/i.test(text))
    values.push("mainstream");
  if (/budget|affordable|cheaper|too expensive|not expensive/i.test(text))
    values.push("expensive");
  if (/wrong atmosphere/i.test(text)) values.push("atmosphere");
  return values;
}
export function isConcept(text: string) {
  return /^(?:(?:chicken|mutton|vegetable|hyderabadi)\s+biryani|biryani|\w+(?:\s+\w+)?\s+cuisine|indian(?: cuisine| food)?|(?:\w+\s+)?(?:savouries|savories|savory snacks)|specialty coffee|coffee|quiet (?:caf[eé]s?|bookstores?)|independent bookstores?|independent culture|cuisine|food|bookstores?)$/i.test(
    text.trim(),
  );
}
export function interpret(text: string, fallback = "New York City"): Intent {
  text=categoryLanguage(text);
  culturalText(text);
  const constraints = constraintsFrom(text);
  const onboarding =
    /\b(?:i love|i like|i enjoy|i'm into|my tastes (?:are|include))\b/i.test(
      text,
    );
  const clean = text.replace(/\bI (?:don't|do not|dislike|hate)[\s\S]*$/i, "");
  const draft = extractDraft(clean, fallback);
  const sections: Section[] = [];
  const scoped = refinementScope(text);
  const positive = scoped.positive.replace(
    /\b(?:not|no|without)\s+(?:ordinary\s+)?restaurants?\b/gi,
    "",
  ).replace(/\b(?:connected to|based on|inspired by|matching|using)\s+my\b[^.!?]*(?:tastes|interests|favorites)\b/gi, "");
  if (/\b(?:eat|dinner|lunch|breakfast|food|dining|restaurant|biryani|indian)\b/i.test(positive))
    sections.push("Eat");
  if (/coffee|caf[eé]/i.test(positive)) sections.push("Coffee");
  const screenContent = /(?:movies?|films?).*(?:to watch|recommendations?|suggestions?|stream)|(?:recommend|suggest|watch|stream).*(?:movies?|films?)/i.test(positive) && !/cinema|theat(?:er|re)|go.*movie/i.test(positive) && !(/dinner|party|nightlife|nightclub/i.test(positive) && /then|after|before/i.test(positive));
  if (screenContent) sections.push("Movies");
  if (/music|musical|artist|bands?/i.test(positive) && !/live music|music.friendly|concert/i.test(positive)) sections.push("Music");
  if (/cultur(?:e|al)|\bart\b|museum|gallery|cinema|\bparty\b|nightclub|nightlife|concert|live music|music.friendly/i.test(positive) || (!screenContent && /\bmovies?\b|\bfilms?\b/i.test(positive)))
    sections.push("Culture");
  if (/bookstore|book shop|lifestyle|shopping|boutique/i.test(positive) && !/coffee\s+shops?/i.test(positive))
    sections.push("Lifestyle");
  if (/\bbooks?\b/i.test(positive) && !/bookstore|book shop|book\s+(?:a|the|my)\b/i.test(positive)) sections.push("Books");
  if (/podcast/i.test(positive)) sections.push("Podcasts");
  if (/tv shows?|television|series to watch/i.test(positive)) sections.push("Shows");
  if (/video games?|games? to play/i.test(positive)) sections.push("Games");
  if (/\bbrands?\b/i.test(positive)) sections.push("Brands");
  if (/\bactors?|directors?|authors?|people\b/i.test(positive)) sections.push("People");
  if (/destinations?|cities to visit|where to travel/i.test(positive)) sections.push("Destinations");
  const concepts = /indian|biryani/i.test(positive)
    ? [/biryani/i.test(positive) ? (/chicken\s+biryani/i.test(positive) ? "chicken biryani" : "biryani") : "Indian cuisine"]
    : [];
  if (
    /independent\s+(?:coffee\s+)?shops?|local\s+coffee|specialty\s+coffee/i.test(
      text,
    )
  )
    concepts.push("independent coffee shops");
  const excludeConcepts =
    /(?:instead of|without|not|no|avoid|exclude)\s+(?:starbucks|big\s+chains?|large\s+chains?|chains?)/i.test(
      text,
    )
      ? ["Starbucks", "coffee chain"]
      : [];
  if (/\bThai\b/i.test(positive)) concepts.push("Thai cuisine");
  if (/\bvegetarian\b/i.test(positive)) concepts.push("vegetarian");
  if (/live music|\bconcerts?\b/i.test(positive)) concepts.push("live music venue");
  if (
    !onboarding &&
    /show|find|want/i.test(text) &&
    /books|bookstore/i.test(text)
  )
    concepts.push("bookstore");
  const hide = /forget|remove|hide|skip/i.test(text) && !onboarding;
  const hidden: Section[] = [];
  const hidePart =
    text.match(
      /(?:forget|remove|hide|skip)\s+([^.!?]*?)(?=\s+(?:show|give|find)|[.!?]|$)/i,
    )?.[1] ?? "";
  if (/coffee|caf[eé]/i.test(hidePart)) hidden.push("Coffee");
  if (/food|dining/i.test(hidePart)) hidden.push("Eat");
  if (/music/i.test(hidePart)) hidden.push("Music");
  if (/book|lifestyle/i.test(hidePart)) hidden.push("Lifestyle");
  if (/cultur(?:e|al)/i.test(hidePart)) hidden.push("Culture");
  const activeSections = sections.filter((s) => !hidden.includes(s) && !scoped.preserved.includes(s));
  const question: Intent["question"] = /\b(?:find|replace|change|update|make|remove|hide|refine|recommend|suggest)\b/i.test(text) ? undefined
    : /what can you|how can you help|what do you do/i.test(text) ? "capabilities"
    : /(?:what|which|show).*(?:preferences|requirements|filters)|what.*(?:remember|saved.*tastes)/i.test(text) ? "preferences"
    : /\bwhy\b|explain.*(?:matches|choices|suggestions|recommendations)/i.test(text) ? "explanation" : undefined;
  const refine =
    !question && !onboarding &&
    (excludeConcepts.length > 0 || constraints.length > 0 || /tonight|quieter|more|less|find|show|want|give|help|too |niche|refine|rank|reorder|trending|hidden gem|safe bet|surprise me|highly rated|make it/i.test(
      text,
    ));
  return {
    ...(question ? { question } : {}),
    kind: onboarding
      ? "onboard"
      : hide
        ? activeSections.length
          ? "refine"
          : "hide"
        : refine
          ? "refine"
          : "unknown",
    destination: onboarding ? draft.city : undefined,
    seeds: onboarding ? draft.tastes.map((s) => s.replace(/[.\s]+$/, "")) : [],
    concepts,
    activityGenres: [
      ...(!screenContent && /\bmovies?\b|cinema/i.test(positive) ? ["cinema" as const] : []),
      ...(/\bparty\b|nightclub|nightlife/i.test(positive) ? ["nightclub" as const] : []),
    ],
    excludeConcepts: /\bno seafood\b/i.test(text)
      ? ["seafood", ...excludeConcepts]
      : excludeConcepts,
    query: preferencesFromText(text),
    constraints,
    sections: hide && !activeSections.length ? hidden : activeSections,
    hide: hidden,
    ...(/adventurous|explore|broader/i.test(text) && !onboarding
      ? { familiarity: "explore" as const }
      : /balanced/i.test(text) && !onboarding
        ? { familiarity: "balanced" as const }
        : /feels? like home|more familiar/i.test(text) && !onboarding
          ? { familiarity: "familiar" as const }
          : {}),
    strategy: /rank|reorder|shortlist/i.test(text)
      ? "rank"
      : hide
        ? "filter"
        : "discover",
  };
}
export function validateIntent(raw: unknown): Intent {
  if (!raw || typeof raw !== "object") throw Error("Invalid model intent");
  const x = raw as Record<string, unknown>;
  if (
    !["onboard", "refine", "hide", "unknown"].includes(String(x.kind)) ||
    !["discover", "rank", "filter"].includes(String(x.strategy))
  )
    throw Error("Invalid intent");
  const arrays = ["seeds", "concepts", "constraints", "sections"] as const;
  for (const key of arrays)
    if (
      !Array.isArray(x[key]) ||
      x[key].length > (key === "seeds" ? 5 : 5) ||
      x[key].some((v) => typeof v !== "string")
    )
      throw Error("Invalid intent fields");
  if (
    (x.constraints as string[]).some(
      (c) =>
        ![
          "touristy",
          "crowded",
          "mainstream",
          "expensive",
          "atmosphere",
        ].includes(c),
    ) ||
    (x.sections as Section[]).some((c) => !sectionOrder.includes(c))
  )
    throw Error("Invalid scope");
  if (
    x.destination !== undefined &&
    !validDestination(x.destination)
  )
    throw Error("Unsupported destination");
  if (
    x.familiarity !== undefined &&
    !["familiar", "balanced", "explore"].includes(String(x.familiarity))
  )
    throw Error("Invalid familiarity mode");
  for (const value of [...(x.seeds as string[]), ...(x.concepts as string[])])
    culturalText(value, 100);
  return {
    kind: x.kind as Intent["kind"],
    ...(["capabilities", "preferences", "explanation"].includes(String(x.question))
      ? { question: x.question as Intent["question"] } : {}),
    strategy: x.strategy as Intent["strategy"],
    seeds: x.seeds as string[],
    concepts: x.concepts as string[],
    constraints: x.constraints as Constraint[],
    sections: x.sections as Section[],
    ...(Array.isArray(x.excludeConcepts)
      ? {
          excludeConcepts: x.excludeConcepts
            .filter((s): s is string => typeof s === "string")
            .slice(0, 2)
            .map((s) => culturalText(s, 100)),
        }
      : {}),
    ...(x.query !== undefined ? { query: validatePreferences(x.query) } : {}),
    ...(x.familiarity
      ? { familiarity: x.familiarity as Intent["familiarity"] }
      : {}),
    ...(x.destination ? { destination: String(x.destination) } : {}),
    ...(Array.isArray(x.hide)
      ? {
          hide: x.hide.filter((s): s is Section =>
            sectionOrder.includes(s as Section),
          ),
        }
      : {}),
  };
}
export function reasonConstraint(reason: string): Constraint[] {
  return reason === "Too touristy"
    ? ["touristy"]
    : reason === "Too crowded"
      ? ["crowded"]
      : reason === "Too mainstream"
        ? ["mainstream"]
        : reason === "Too expensive"
          ? ["expensive"]
          : reason === "Wrong atmosphere"
            ? ["atmosphere"]
            : [];
}

export { onboardingTastes } from "../workspace/state.ts";


export function findMentionedCard<T extends { id: string; name: string }>(text: string, cards: readonly T[]): T | undefined {
  if (!text || typeof text !== "string" || !cards?.length) return undefined;
  const normalized = text.toLowerCase().trim();
  const sorted = [...cards].sort((a, b) => b.name.length - a.name.length);
  return sorted.find(c => {
    if (!c.name || c.name.length < 3) return false;
    const nameLow = c.name.toLowerCase();
    if (normalized === nameLow) return true;
    if (nameLow.length >= 4 && normalized.includes(nameLow)) return true;
    const escaped = nameLow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      return new RegExp(`\\b${escaped}\\b`, "i").test(normalized);
    } catch {
      return false;
    }
  });
}
