import { isObject, parseEntities } from "../qloo/types.ts";
import type { Entity } from "../qloo/types.ts";
import { card, classify, sectionTypes, isPlaceSection } from "../passport/model.ts";
import type { Candidate, Card, Section } from "../passport/model.ts";
import type { Constraint, ToolResult } from "./types.ts";
import { matchesDestination } from "../workspace/location.ts";
export function tagCandidates(result: ToolResult, query: string): Candidate[] {
  if (result.status !== "ok" || !Array.isArray(result.results)) return [];
  const seen = new Set<string>();
  return result.results
    .filter(isObject)
    .filter(
      (t) =>
        typeof t.id === "string" &&
        /^urn:tag:[\w:-]+$/.test(t.id) &&
        typeof t.name === "string",
    )
    .sort((a,b) =>
      Number(String(b.id).includes(":place:")) - Number(String(a.id).includes(":place:"))
    )
    .filter(t => {
      // Qloo may return the same user-visible concept through several tag
      // namespaces. A dialog with five identical labels is not actionable.
      const label = String(t.name).toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/s\b/g,"");
      // Dietary requirements must remain distinguishable from audience and
      // cuisine tags that happen to carry the same display name.
      const family = String(t.id).split(":")[2];
      const key = /^(?:vegetarian|vegan|gluten free)$/.test(label) ? label + ":" + family : label;
      if (!label || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5)
    .map((t) => ({
      id: String(t.id),
      name: String(t.name),
      types: [typeof t.type === "string" ? t.type : "urn:tag"],
      detail: `Qloo concept for ${query}`,
    }));
}
/** Preserve the existing service exclusions, then require place-category/genre
 * evidence. "Nearby food trucks" on a landmark is not a dining classification. */
export function validatedSection(e: Entity): Section | undefined {
  if (!classify(e)) return;
  const scoped = Array.isArray(e.tags)
    ? e.tags
        .filter(isObject)
        .filter(
          (t) =>
            String(t.type ?? "").startsWith("urn:tag:category:place") ||
            String(t.type ?? "").startsWith("urn:tag:genre:place"),
        )
    : [];
  const names = scoped
    .map((t) => String(t.name ?? ""))
    .join(" ")
    .toLowerCase();
  if (/government|consulate|hospital|airport|financial institution/.test(names))
    return;
  // Museums may also carry a tourist-attraction tag. Classification and the
  // user's optional touristy avoidance are separate decisions.
  const dining =
    /restaurant|dining|bakery|bistro|food court|pizza|tiffin|delivery kitchen|catering/.test(
      names,
    );
  const description = String(
    e.properties?.short_description ?? "",
  ).toLowerCase();
  // Conflicting venue genres are ambiguous; descriptions may veto, never establish culture.
  if (
    !dining &&
    !/tiffin|delivery kitchen|meal delivery|catering service/.test(
      description,
    ) &&
    /\b(?:museum|art gallery|gallery|theater|theatre|concert hall|cinema|nightclub|night club|live music venue|music venue)\b/.test(
      names,
    )
  )
    return "Culture";
  if (/tourist attraction|landmark/.test(names)) return;
  if (/coffee|cafe|café|tea house/.test(names)) return "Coffee";
  if (/restaurant|dining|bakery|bistro|food court|pizza/.test(names))
    return "Eat";
  if (/bookstore|book shop|record store|boutique|shopping|yoga/.test(names))
    return "Lifestyle";
}
export function satisfies(e: Entity, constraints: Constraint[]): boolean {
  const tags = Array.isArray(e.tags) ? e.tags.filter(isObject) : [];
  if (
    constraints.includes("touristy") &&
    tags.some((t) =>
      /tourist attraction|tourist focused|touristic/i.test(
        String(t.name ?? ""),
      ),
    )
  )
    return false;
  if (
    constraints.includes("mainstream") &&
    typeof (e as Entity & { popularity?: number }).popularity === "number" &&
    (e as Entity & { popularity: number }).popularity > 0.9
  )
    return false;
  if (
    constraints.includes("expensive") &&
    typeof e.properties?.price_level === "number" &&
    e.properties.price_level > 2
  )
    return false;
  return true;
}
export function validateDiscoveries(
  body: unknown,
  city: string,
  section: Section,
  constraints: Constraint[],
  excluded: string[],
): Card[] {
  const entities = parseEntities(body, "insights");
  return entities
    .filter((e) => !excluded.includes(e.entity_id) && satisfies(e, constraints))
    .filter((e) => {
      if (!isPlaceSection(section))
        return [e.subtype, e.type, ...(e.types ?? [])].includes(`urn:entity:${sectionTypes[section]}`);
      if (
        (e.subtype ?? e.type) !== "urn:entity:place" ||
        validatedSection(e) !== section
      )
        return false;
      const geo = e.properties?.geocode;
      if (!isObject(geo)) return false;
      return matchesDestination(city, geo);
    })
    .map((e) => card(e, section));
}
