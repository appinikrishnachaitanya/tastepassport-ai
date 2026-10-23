import { request } from "./client.ts";
import { cleanTagName } from "./explanation.ts";
import { isObject } from "./types.ts";
export interface TasteComparison {
  shared: { id: string; name: string; score?: number }[];
  aOnly: { id: string; name: string }[];
  bOnly: { id: string; name: string }[];
  recordedAt: string;
}
export function normalizeCompare(body: unknown): TasteComparison {
  const r = isObject(body) && isObject(body.results) ? body.results : undefined;
  if (!r || !Array.isArray(r.tags))
    throw Error("Unexpected Qloo compare response.");
  const rows = (value: unknown) =>
    Array.isArray(value)
      ? value.filter(isObject).flatMap((t) =>
          typeof t.tag_id === "string" &&
          /^urn:tag:[\w:-]+$/.test(t.tag_id) &&
          typeof t.name === "string"
            ? [
                {
                  id: t.tag_id,
                  name: cleanTagName(t.name),
                  ...(isObject(t.query) &&
                  typeof t.query.score === "number" &&
                  Number.isFinite(t.query.score)
                    ? { score: t.query.score }
                    : {}),
                },
              ]
            : [],
        )
      : [];
  const shared = [...new Map(rows(r.tags).map(row=>[row.name.toLowerCase(),row])).values()],
    ids = new Set(shared.map((t) => t.id));
  return {
    shared,
    aOnly: rows(r.a)
      .filter((t) => !ids.has(t.id))
      .slice(0, 5),
    bOnly: rows(r.b)
      .filter((t) => !ids.has(t.id))
      .slice(0, 5),
    recordedAt: new Date().toISOString(),
  };
}
export async function compareProfiles(
  a: string[],
  b: string[],
  signal?: AbortSignal,
) {
  if (
    !a.length ||
    !b.length ||
    a.length > 10 ||
    b.length > 5 ||
    [...a, ...b].some((id) => !/^[a-f0-9-]{36}$/i.test(id))
  )
    throw Error("Compare needs confirmed entity interests for both people.");
  return normalizeCompare(
    await request(
      "/v2/analysis/compare",
      {
        "a.signal.interests.entities": a.join(","),
        "b.signal.interests.entities": b.join(","),
        take: "10",
      },
      signal,
    ),
  );
}
