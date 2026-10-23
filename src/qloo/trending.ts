import { request } from "./client.ts";
import { isObject } from "./types.ts";
export interface TrendPoint {
  date: string;
  populationPercentile?: number;
  rank?: number;
  velocity?: number;
  velocityFoldChange?: number;
  populationPercentDelta?: number;
}
export interface TrendResult {
  entityId: string;
  startDate: string;
  endDate: string;
  points: TrendPoint[];
  status?: "established" | "rising" | "cooling";
  recordedAt: string;
}
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
/** Rank velocity sign is not documented. Use documented population delta, not an assumed sign. */
export function trendStatus(point: TrendPoint): TrendResult["status"] {
  if (point.populationPercentDelta !== undefined) {
    if (point.populationPercentDelta > 0) return "rising";
    if (point.populationPercentDelta < 0) return "cooling";
    if (
      point.populationPercentile !== undefined &&
      point.populationPercentile >= 80
    )
      return "established";
  }
  return undefined;
}
export function normalizeTrend(
  body: unknown,
  id: string,
  startDate: string,
  endDate: string,
): TrendResult {
  const rows =
    isObject(body) && isObject(body.results)
      ? body.results.trending
      : undefined;
  if (!Array.isArray(rows)) throw Error("Unexpected Qloo trend response.");
  const points = rows
    .filter(isObject)
    .flatMap((p) =>
      typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
        ? [
            {
              date: p.date,
              populationPercentile: num(p.population_percentile),
              rank: num(p.population_rank),
              velocity: num(p.population_rank_velocity),
              velocityFoldChange: num(p.velocity_fold_change),
              populationPercentDelta: num(p.population_percent_delta),
            },
          ]
        : [],
    )
    .filter((p) => p.date >= startDate && p.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    entityId: id,
    startDate,
    endDate,
    points,
    status: points.length ? trendStatus(points.at(-1)!) : undefined,
    recordedAt: new Date().toISOString(),
  };
}
export async function trending(
  id: string,
  type: string,
  signal?: AbortSignal,
): Promise<TrendResult> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error("Invalid trend entity.");
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  const startDate = start.toISOString().slice(0, 10),
    endDate = end.toISOString().slice(0, 10);
  return normalizeTrend(
    await request(
      "/v2/trending",
      {
        "filter.type": type,
        "signal.interests.entities": id,
        "filter.start_date": startDate,
        "filter.end_date": endDate,
        take: "50",
      },
      signal,
    ),
    id,
    startDate,
    endDate,
  );
}
