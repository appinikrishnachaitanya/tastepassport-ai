export type JsonObject = Record<string, unknown>;
export interface Entity {
  name: string;
  entity_id: string;
  type?: string;
  subtype?: string;
  types?: string[];
  properties?: JsonObject;
  // Preserved as unknown until a live response establishes metric shape.
  scores?: unknown;
  query?: JsonObject;
  tags?: unknown;
  popularity?: number;
  external?: unknown;
  location?: unknown;
}
export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseEntities(
  body: unknown,
  route: "search" | "insights",
): Entity[] {
  if (!isObject(body) || body.success === false)
    throw new Error("Unexpected Qloo response envelope");
  const results = body.results;
  // Search has no response schema in docs-public. Accept only explicit entity
  // collections; these search variants remain provisional until live validation.
  const list =
    route === "insights"
      ? isObject(results)
        ? results.entities
        : undefined
      : Array.isArray(results)
        ? results
        : isObject(results)
          ? results.entities
          : undefined;
  if (!Array.isArray(list))
    throw new Error(
      "Unexpected Qloo entity collection; inspect official response schema",
    );
  return list.map((entry: unknown) => {
    if (
      !isObject(entry) ||
      typeof entry.name !== "string" ||
      typeof entry.entity_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        entry.entity_id,
      ) ||
      (entry.type !== undefined && typeof entry.type !== "string") ||
      (entry.subtype !== undefined && typeof entry.subtype !== "string") ||
      (entry.query !== undefined && !isObject(entry.query)) ||
      (entry.types !== undefined &&
        (!Array.isArray(entry.types) ||
          !entry.types.every((t) => typeof t === "string"))) ||
      (entry.properties !== undefined && !isObject(entry.properties))
    ) {
      throw new Error("Unexpected Qloo entity fields");
    }
    const canonical = (type: unknown) => type === "urn:entity:videogame" ? "urn:entity:video_game" : type;
    return {...entry,
      ...(entry.type !== undefined ? {type:canonical(entry.type)} : {}),
      ...(entry.subtype !== undefined ? {subtype:canonical(entry.subtype)} : {}),
      ...(Array.isArray(entry.types) ? {types:entry.types.map(canonical)} : {}),
    } as unknown as Entity;
  });
}
