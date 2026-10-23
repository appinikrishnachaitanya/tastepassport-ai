import { entityParameters } from "./capabilities.ts";

export type DiscoveryGoal =
  | "discover"
  | "trending"
  | "hidden-gems"
  | "safe-bets"
  | "surprise";
export interface QueryPreferences {
  goal?: DiscoveryGoal;
  priceMin?: number;
  priceMax?: number;
  ratingMin?: number;
  ratingMax?: number;
  businessRatingMin?: number;
  businessRatingMax?: number;
  popularityMin?: number;
  popularityMax?: number;
  tripAdvisorRatingMin?: number;
  tripAdvisorRatingMax?: number;
  tripAdvisorReviewCountMin?: number;
  tripAdvisorReviewCountMax?: number;
  resyRatingMin?: number;
  resyReviewCountMin?: number;
  partySize?: number;
  locationQuery?: string;
  locationPoint?: string;
  radius?: number;
  excludeLocation?: string;
  countryCode?: string;
  region?: string;
  metro?: string;
  includeTags?: string[];
  excludeTags?: string[];
  excludeEntities?: string[];
  tagOperator?: "union" | "intersection";
  requiredProperties?: string[];
  requiredExternalSources?: string[];
  qualityBias?: "low" | "medium" | "high";
  trendBias?: "low" | "medium" | "high";
  contentBasedBias?: number;
  diversifyBy?:
    | "properties.geocode.city"
    | "properties.geocode.metro"
    | "subtype";
  diversifyTake?: number;
}
export interface QlooQueryPlan {
  outputType: string;
  interests: { entities: string[]; tags: string[] };
  preferences?: QueryPreferences;
  take?: number;
  explainability?: boolean;
}
export interface QueryDiagnostics {
  applied: string[];
  unverified?: string[];
  dropped: { parameter: string; reason: string }[];
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const tag = /^urn:tag:[\w:-]+$/;
const numberRanges: Record<string, [number, number]> = {
  priceMin: [1, 4],
  priceMax: [1, 4],
  ratingMin: [0, 5],
  ratingMax: [0, 5],
  businessRatingMin: [0, 5],
  businessRatingMax: [0, 5],
  popularityMin: [0, 1],
  popularityMax: [0, 1],
  tripAdvisorRatingMin: [0, 5],
  tripAdvisorRatingMax: [0, 5],
  tripAdvisorReviewCountMin: [0, 10000000],
  tripAdvisorReviewCountMax: [0, 10000000],
  resyRatingMin: [0, 5],
  resyReviewCountMin: [0, 10000000],
  partySize: [1, 30],
  radius: [0, 800000],
  contentBasedBias: [0, 1],
  diversifyTake: [1, 50],
};
/** Validate model-produced preferences; no provider can supply raw API keys or URLs. */
export function validatePreferences(input: unknown): QueryPreferences {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid discovery preferences.");
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (numberRanges[key]) {
      const [min, max] = numberRanges[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (["priceMin","priceMax","partySize","diversifyTake","tripAdvisorReviewCountMin","tripAdvisorReviewCountMax","resyReviewCountMin","radius"].includes(key) && !Number.isInteger(value))
      )
        throw Error(`Invalid ${key}.`);
      result[key] = value;
    } else if (key === "locationPoint") {
      if (typeof value !== "string") throw Error("Invalid location point.");
      const match=value.match(/^POINT\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/);
      if (!match || Math.abs(Number(match[1])) > 180 || Math.abs(Number(match[2])) > 90) throw Error("Invalid location point.");
      result[key]=value;
    } else if (
      [
        "locationQuery",
        "excludeLocation",
        "countryCode",
        "region",
        "metro",
      ].includes(key)
    ) {
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 100 ||
        /https?:|@|[\r\n]/i.test(value)
      )
        throw Error("Invalid location preference.");
      result[key] = value.trim();
    } else if (
      [
        "includeTags",
        "excludeTags",
        "excludeEntities",
        "requiredProperties",
        "requiredExternalSources",
      ].includes(key)
    ) {
      if (
        !Array.isArray(value) ||
        value.length > 50 ||
        value.some((v) => typeof v !== "string" || v.length > 150)
      )
        throw Error("Invalid filter list.");
      if (key.endsWith("Tags") && value.some((v) => !tag.test(v)))
        throw Error("Resolve tags before applying filters.");
      if (key === "excludeEntities" && value.some((v) => !uuid.test(v)))
        throw Error("Resolve entities before applying exclusions.");
      if (key === "requiredProperties" && value.some(v=>!["image","description","properties.image","properties.description"].includes(v)))
        throw Error("Unsupported required property.");
      if (key === "requiredProperties" && value.length>1) throw Error("Choose one required listing property.");
      result[key] = [...new Set(value)];
    } else {
      const choices: Record<string, string[]> = {
        goal: ["discover", "trending", "hidden-gems", "safe-bets", "surprise"],
        qualityBias: ["low", "medium", "high"],
        trendBias: ["low", "medium", "high"],
        tagOperator: ["union", "intersection"],
        diversifyBy: [
          "properties.geocode.city",
          "properties.geocode.metro",
          "subtype",
        ],
      };
      if (!choices[key]?.includes(String(value)))
        throw Error("Unsupported discovery preference.");
      result[key] = value;
    }
  }
  for (const [min, max] of [
    ["priceMin", "priceMax"],
    ["popularityMin", "popularityMax"],
    ["ratingMin", "ratingMax"],
    ["businessRatingMin", "businessRatingMax"],
    ["tripAdvisorRatingMin", "tripAdvisorRatingMax"],
    ["tripAdvisorReviewCountMin", "tripAdvisorReviewCountMax"],
  ])
    if (
      typeof result[min] === "number" &&
      typeof result[max] === "number" &&
      result[min] > result[max]
    )
      throw Error("Minimum exceeds maximum.");
  return result as QueryPreferences;
}
export function preferenceParams(
  raw: QueryPreferences,
): Record<string, string> {
  const p = validatePreferences(raw),
    params: Record<string, string> = {};
  // Product presets only set ranking/filter intentions; no LLM reranking or invented scores.
  if (p.goal === "trending") params["bias.trends"] = "high";
  if (p.goal === "hidden-gems")
    Object.assign(params, {
      "bias.quality": "high",
      "filter.popularity.max": "0.75",
    });
  if (p.goal === "safe-bets")
    Object.assign(params, {
      "bias.quality": "high",
      "filter.properties.business_rating.min": "4",
    });
  // Surprise uses the adjacent retrieval policy; no undocumented bias knob.
  const mapping: Record<string, string> = {
    priceMin: "filter.price_level.min",
    priceMax: "filter.price_level.max",
    ratingMin: "filter.rating.min",
    ratingMax: "filter.rating.max",
    businessRatingMin: "filter.properties.business_rating.min",
    businessRatingMax: "filter.properties.business_rating.max",
    popularityMin: "filter.popularity.min",
    popularityMax: "filter.popularity.max",
    tripAdvisorRatingMin: "filter.external.tripadvisor.rating.min",
    tripAdvisorRatingMax: "filter.external.tripadvisor.rating.max",
    tripAdvisorReviewCountMin: "filter.external.tripadvisor.rating.count.min",
    tripAdvisorReviewCountMax: "filter.external.tripadvisor.rating.count.max",
    // Resy spellings conflict between the two official guides; validation reports them as unverified.
    resyRatingMin: "filter.external.resy.rating.min",
    resyReviewCountMin: "filter.external.resy.count.min",
    partySize: "filter.external.resy.party_size.min",
    locationQuery: "filter.location.query",
    locationPoint: "filter.location",
    radius: "filter.location.radius",
    excludeLocation: "filter.exclude.location.query",
    countryCode: "filter.geocode.country_code",
    region: "filter.geocode.admin1_region",
    metro: "filter.location.metro",
    includeTags: "filter.tags",
    excludeTags: "filter.exclude.tags",
    excludeEntities: "filter.exclude.entities",
    tagOperator: "operator.filter.tags",
    requiredProperties: "filter.exists",
    requiredExternalSources: "filter.external.exists",
    qualityBias: "bias.quality",
    trendBias: "bias.trends",
    contentBasedBias: "bias.content_based",
    diversifyBy: "diversify.by",
    diversifyTake: "diversify.take",
  };
  for (const [key, value] of Object.entries(p))
    if (mapping[key])
      params[mapping[key]] = Array.isArray(value)
        ? (key === "requiredProperties" ? value.map(v=>v.startsWith("properties.")?v:`properties.${v}`) : value).join(",")
        : String(value);
  // "Any budget" is not a requirement to have a known price field.
  if (p.priceMax === 4 && p.priceMin === undefined) delete params["filter.price_level.max"];
  return params;
}
/** The compatibility entry point also validates legacy callers before network I/O. */
export function validateInsightParams(input: Record<string, string>): {
  params: Record<string, string>;
  diagnostics: QueryDiagnostics;
} {
  const type = input["filter.type"]?.replace("urn:entity:", "");
  if (!entityParameters[type]) throw Error("Unsupported Qloo output type.");
  const allowed = supportedParameterNames(type);
  const params: Record<string, string> = {},
    dropped: QueryDiagnostics["dropped"] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.length > 12000)
      throw Error("Invalid Qloo parameter value.");
    let reason = "";
    if (!allowed.has(key)) reason = "Not documented for this entity type";
    if (/resy/.test(key))
      reason =
        "Conflicting Resy parameter names in official documentation; not verified";
    if (
      key === "filter.external.exists" &&
      value.split(",").some((v) => !["resy", "michelin", "tablet"].includes(v))
    )
      reason = "Unknown external provider";
    if (
      key === "diversify.by" &&
      !["properties.geocode.city", "properties.geocode.metro"].includes(value)
    )
      reason = "Unsupported diversification field for entity results";
    if (key === "operator.filter.tags" || key === "operator.exclude.tags")
      if (!["union", "intersection"].includes(value))
        reason = "Invalid tag operator";
    if(key === "filter.exists" && !["properties.image","properties.description"].includes(value))throw Error("Unsupported required property.");
    if (
      key === "bias.quality" &&
      !["low", "medium", "high"].includes(value) &&
      !(Number.isFinite(Number(value)) && Number(value) > 0)
    )
      throw Error("Invalid quality weight.");
    if (
      key === "bias.trends" &&
      !["low", "medium", "high", "off"].includes(value)
    )
      throw Error("Invalid trend weight.");
    const range = key === "bias.content_based" ? [0,1] : key.includes("price_level.")
      ? [1, 4]
      : key.includes("popularity.")
        ? [0, 1]
        : /rating\.(?:min|max)$/.test(key)
          ? [0, 5]
          : key === "filter.location.radius"
            ? [0, 800000]
            : key === "take"
              ? [1, 50]
              : undefined;
    if (
      range &&
      (!Number.isFinite(Number(value)) ||
        Number(value) < range[0] ||
        Number(value) > range[1])
    )
      throw Error("Qloo numeric filter is outside its supported range.");
    if((key === "take" || key === "filter.location.radius" || key.includes("price_level.")) && !Number.isInteger(Number(value)))throw Error("Qloo requires an integer for this filter.");
    if (
      /^(?:signal.interests.entities|filter.exclude.entities|filter.results.entities)$/.test(
        key,
      ) &&
      value.split(",").some((v) => !uuid.test(v))
    )
      throw Error("Insights requires resolved entity IDs.");
    if (
      /^(?:signal.interests.tags|filter.tags|filter.exclude.tags)$/.test(key) &&
      value.split(",").some((v) => !tag.test(v))
    )
      throw Error("Insights requires resolved tag IDs.");
    if (reason) dropped.push({ parameter: key, reason });
    else if (value !== "") params[key] = value;
  }
  for (const key of Object.keys(params).filter((k) => k.endsWith(".min")))
    if (
      params[key.replace(/\.min$/, ".max")] !== undefined &&
      Number(params[key]) > Number(params[key.replace(/\.min$/, ".max")])
    )
      throw Error("Qloo minimum exceeds maximum.");
  return { params, diagnostics: { applied: Object.keys(params), dropped } };
}
export function supportedParameterNames(type: string) {
  const allowed = new Set(entityParameters[type] ?? []);
  allowed.add("feature.explainability");
  allowed.add("signal.location.query");
  allowed.add("filter.exists");
  // General reference explicitly documents these, despite omissions in the type table.
  if (["place", "destination"].includes(type))
    for (const key of [
      "filter.location.query",
      "filter.exclude.location",
      "filter.exclude.location.query",
      "filter.location.metro",
      "diversify.by",
      "diversify.take",
    ])
      allowed.add(key);
  return allowed;
}
/** Updating one end of a range supersedes a conflicting old opposite bound. */
export function patchPreferences(
  previous: QueryPreferences,
  patch: QueryPreferences,
): QueryPreferences {
  const update = validatePreferences(patch),
    merged = { ...previous, ...update };
  if (update.locationPoint !== undefined) delete merged.locationQuery;
  if (update.locationQuery !== undefined) delete merged.locationPoint;
  for (const [low, high] of [
    ["priceMin", "priceMax"],
    ["popularityMin", "popularityMax"],
    ["ratingMin", "ratingMax"],
    ["businessRatingMin", "businessRatingMax"],
  ] as const) {
    if (
      merged[low] !== undefined &&
      merged[high] !== undefined &&
      merged[low]! > merged[high]!
    ) {
      if (update[low] !== undefined && update[high] === undefined)
        delete merged[high];
      else if (update[high] !== undefined && update[low] === undefined)
        delete merged[low];
    }
  }
  return validatePreferences(merged);
}
export function buildQuery(plan: QlooQueryPlan) {
  const params: Record<string, string> = {
    "filter.type": plan.outputType.startsWith("urn:")
      ? plan.outputType
      : `urn:entity:${plan.outputType}`,
    take: String(Math.min(50, Math.max(1, plan.take ?? 20))),
  };
  if (plan.interests.entities.length)
    params["signal.interests.entities"] = plan.interests.entities.join(",");
  if (plan.interests.tags.length)
    params["signal.interests.tags"] = plan.interests.tags.join(",");
  if (plan.explainability !== false) params["feature.explainability"] = "true";
  Object.assign(params, preferenceParams(plan.preferences ?? {}));
  return validateInsightParams(params);
}
export function preferencesFromText(text: string): QueryPreferences {
  const p: QueryPreferences = {};
  if (
    /\b(?:Indian|Thai|Italian|vegetarian)\b.*\bor\b.*\b(?:Indian|Thai|Italian|vegetarian)\b/i.test(
      text,
    )
  )
    p.tagOperator = "union";
  else if (/\b(?:Indian|Thai|Italian)\b.*\band\b.*\bvegetarian\b/i.test(text))
    p.tagOperator = "intersection";
  if (/\bcheap\b|affordable|budget|under\s*\$\$/i.test(text)) p.priceMax = 2;
  if (/\bmoderate(?:\s+budget)?\b/i.test(text)) p.priceMax = 2;
  const explicitRating=text.match(/(?:minimum\s+(?:business\s+)?rating(?:\s+(?:of|is))?|rated\s+(?:at least|above)|rating\s+(?:at least|above|>=))\s*([0-5](?:\.\d+)?)/i);
  if(explicitRating) p.businessRatingMin=Number(explicitRating[1]);
  if (/mid.range/i.test(text)) {
    p.priceMin = 2;
    p.priceMax = 3;
  }
  if (/luxury/i.test(text)) p.priceMin = 4;
  else if (/premium/i.test(text)) p.priceMin = 3;
  if (/highly rated|excellent places/i.test(text))
    p.businessRatingMin = /excellent/i.test(text) ? 4.5 : 4;
  if (/hidden gems?|not touristy|nothing touristy/i.test(text))
    p.goal = "hidden-gems";
  if (/safe bets?|reliable/i.test(text)) p.goal = "safe-bets";
  if (/trending|what.s hot|gaining momentum|what.s rising/i.test(text))
    p.goal = "trending";
  if (/surprise me/i.test(text)) p.goal = "surprise";
  if (/timeless|don.t care about trends/i.test(text)) p.trendBias = "low";
  const radius = text.match(/within\s+(\d+(?:\.\d+)?)\s*km/i);
  if (radius) p.radius = Math.min(800000, Number(radius[1]) * 1000);
  return p;
}
