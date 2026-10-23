import { debugEvent } from "../agent/debug.ts";
import { fetchWithRetry, paced } from "./transport.ts";
import { parseEntities } from "./types.ts";
import type { Entity, JsonObject } from "./types.ts";
import { validateInsightParams } from "./query-plan.ts";
import { recordQuery } from "./diagnostics.ts";
import { verifyResult } from "./verify-result.ts";
export type QlooEndpoint =
  | "/search"
  | "/v2/insights/"
  | "/v2/tags"
  | "/v2/tags/types"
  | "/entities"
  | "/v2/analysis/compare"
  | "/v2/trending";
export class QlooError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
export function safeText(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  const key = process.env.QLOO_API_KEY;
  return key ? text.replaceAll(key, "[REDACTED]") : text;
}
export async function request(
  path: QlooEndpoint,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const key = process.env.QLOO_API_KEY;
  if (!key?.trim())
    throw new QlooError(
      "Missing QLOO_API_KEY. Supply it securely through environment settings or an ignored .env file.",
    );
  const base =
    process.env.QLOO_API_BASE_URL ??
    process.env.QLOO_BASE_URL ??
    "https://hackathon.api.qloo.com";
  if (
    !["https://hackathon.api.qloo.com", "https://api.qloo.com"].includes(
      base.replace(/\/$/, ""),
    )
  )
    throw new QlooError("Unsupported Qloo API base URL");
  const url = new URL(path, base);
  // Live hackathon Insights accepts videogame; docs/app use video_game.
  const wireParams = path === "/v2/insights/" && params["filter.type"] === "urn:entity:video_game"
    ? {...params,"filter.type":"urn:entity:videogame"} : params;
  url.search = new URLSearchParams(wireParams).toString();
  const requestSignal = signal ?? AbortSignal.timeout(30_000);
  return paced(
    `${key}:${url}`,
    async () => {
      if (requestSignal.aborted) throw new QlooError("Qloo request cancelled");
      debugEvent("qloo.request", { endpoint: endpointName(path) });
      let response: Response;
      try {
        response = await fetchWithRetry(url, {
          headers: { "X-Api-Key": key, Accept: "application/json" },
          signal: requestSignal,
          redirect: "error",
        });
      } catch {
        debugEvent("qloo.failed");
        throw new QlooError(
          "Qloo network/TLS/proxy failure or 30-second timeout. No fallback data used.",
        );
      }
      debugEvent("qloo.response", { status: response.status });
      if (!response.ok) {
        // Never log response bodies: they may echo request credentials.
        const reason =
          response.status === 401 || response.status === 403
            ? "Authentication or access denied"
            : response.status === 429
              ? "Rate limit exceeded; wait before rerunning"
              : response.status === 400
                ? "Invalid parameters, entity type, signal, or locality; verify documented query"
                : response.status === 404
                  ? "No results or endpoint unavailable"
                  : "API failure";
        throw new QlooError(
          `${reason} (HTTP ${response.status})`,
          response.status,
        );
      }
      try {
        return await response.json();
      } catch {
        throw new QlooError("Qloo returned invalid JSON");
      }
    },
    path === "/v2/trending"
      ? 60_000
      : ["/search", "/v2/tags", "/v2/tags/types", "/entities"].includes(path)
        ? 3_600_000
        : 300_000,
    requestSignal,
  );
}
export function endpointName(path: QlooEndpoint) {
  return (
    {
      "/search": "search",
      "/v2/insights/": "insights",
      "/v2/tags": "tags",
      "/v2/tags/types": "tag-types",
      "/entities": "entities",
      "/v2/analysis/compare": "compare",
      "/v2/trending": "trending",
    } as const
  )[path];
}
export async function search(query: string, signal?: AbortSignal): Promise<Entity[]> {
  const entities = parseEntities(
    await request("/search", { query, take: "10" }, signal),
    "search",
  );
  debugEvent("qloo.entities", { endpoint: "search", count: entities.length });
  return entities;
}
export async function insights(
  input: Record<string, string>,
  signal?: AbortSignal,
) {
  const { params, diagnostics } = validateInsightParams({
    ...input,
    "feature.explainability": "true",
  });
  debugEvent("qloo.validated", {
    count: diagnostics.applied.length,
    droppedCount: diagnostics.dropped.length,
    parameters: diagnostics.dropped.map((d) => d.parameter),
  });
  const body = await request("/v2/insights/", params, signal);
  const parsed = parseEntities(body, "insights");
  const checked = parsed.map((entity) => ({
    entity,
    check: verifyResult(entity, params),
  }));
  const entities = checked
    .filter((row) => row.check.eligible)
    .map((row) => row.entity);
  diagnostics.unverified = [
    ...new Set(
      checked
        .filter((row) => row.check.eligible)
        .flatMap((row) => row.check.unverified),
    ),
  ];
  debugEvent("qloo.entities", { endpoint: "insights", count: entities.length });
  return {
    entities,
    body,
    params,
    diagnostics,
    traceId: recordQuery(params, diagnostics, body),
  };
}
export function insightParams(
  ids: string[],
  type: string,
  local: boolean,
): Record<string, string> {
  const supported = ["place", "artist", "book", "brand", "movie", "podcast", "tv_show", "video_game", "person", "destination"];
  if (!supported.includes(type))
    throw new QlooError("Unsupported experiment output type");
  if (!ids.length) throw new QlooError("No resolved entities available");
  const params: Record<string, string> = {
    "filter.type": `urn:entity:${type}`,
    "signal.interests.entities": ids.join(","),
    take: "5",
  };
  if (local) {
    if (type !== "place")
      throw new QlooError(
        "Physical location filtering is only configured for places",
      );
    params["filter.location.query"] = "New York City";
    params["filter.location.radius"] = "0";
  } else params["signal.location.query"] = "New York City";
  return params;
}
export function metadata(entity: Entity): JsonObject {
  return {
    type: entity.types ?? entity.subtype ?? entity.type,
    properties: Object.fromEntries(
      Object.entries(entity.properties ?? {}).filter(([k]) =>
        [
          "address",
          "geocode",
          "release_year",
          "short_description",
          "description",
        ].includes(k),
      ),
    ),
    ...(typeof entity.query?.affinity === "number"
      ? {
          "affinity (raw API relevance; not a probability)":
            entity.query.affinity,
        }
      : {}),
    ...(entity.scores !== undefined
      ? { "raw scores (not rescaled)": entity.scores }
      : {}),
  };
}
