import { request } from "./client.ts";
import { isObject, parseEntities } from "./types.ts";
import type { Candidate } from "../passport/model.ts";
export async function findTags(
  query: string,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  if (!query.trim() || query.length > 100)
    throw Error("Invalid concept query.");
  let b = await request(
    "/v2/tags",
    { "filter.query": query, "feature.typo_tolerance":"true", take: "5" },
    signal,
  );
  let tags = isObject(b) && isObject(b.results) ? b.results.tags : undefined;
  if (!Array.isArray(tags)) throw Error("Unexpected Qloo tags response.");
  if (!tags.length) {
    b=await request("/v2/tags",{"filter.query":query,"feature.semantic_search":"true",take:"5"},signal);
    tags=isObject(b)&&isObject(b.results)?b.results.tags:undefined;
    if(!Array.isArray(tags))throw Error("Unexpected Qloo tags response.");
  }
  return tags
    .filter(isObject)
    .filter(
      (t) =>
        typeof t.id === "string" &&
        /^urn:tag:[\w:-]+$/.test(t.id) &&
        typeof t.name === "string",
    )
    .map((t) => ({
      id: String(t.id),
      name: String(t.name),
      types: [String(t.type ?? "urn:tag")],
      detail: "Confirmed cultural concept",
    }));
}
export async function tagTypes(type = "urn:entity:place") {
  const b = await request("/v2/tags/types", {
    "filter.parents.types": type,
    take: "50",
  });
  const list =
    isObject(b) && isObject(b.results) ? b.results.tag_types : undefined;
  if (!Array.isArray(list)) throw Error("Unexpected Qloo tag types response.");
  return list
    .filter(isObject)
    .flatMap((t) => (typeof t.type === "string" ? [t.type] : []));
}
export async function entityDetails(ids: string[], signal?: AbortSignal) {
  if (
    !ids.length ||
    ids.length > 10 ||
    ids.some((id) => !/^[a-f0-9-]{36}$/i.test(id))
  )
    throw Error("Invalid entity IDs.");
  return parseEntities(
    await request("/entities", { entity_ids: ids.join(",") }, signal),
    "search",
  );
}
