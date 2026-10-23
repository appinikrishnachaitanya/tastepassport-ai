import type { QueryDiagnostics } from "./query-plan.ts";
const records = new Map<
  string,
  {
    at: number;
    endpoint: string;
    params: Record<string, string>;
    diagnostics: QueryDiagnostics;
    raw: unknown;
  }
>();
export function recordQuery(
  params: Record<string, string>,
  diagnostics: QueryDiagnostics,
  raw: unknown,
) {
  const id = crypto.randomUUID();
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.QLOO_DEBUG_UI !== "1"
  )
    return id;
  let json = JSON.stringify(raw);
  for (const key of [
    "QLOO_API_KEY",
    "GEMINI_API_KEY",
    "AGENT_MODEL_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ])
    if (process.env[key])
      json = json.replaceAll(process.env[key]!, "[REDACTED]");
  if (records.size >= 40) records.delete(records.keys().next().value!);
  records.set(id, {
    at: Date.now(),
    endpoint: "/v2/insights/",
    params,
    diagnostics,
    raw:
      json.length <= 100000
        ? JSON.parse(json)
        : { omitted: "Response exceeds private debug limit" },
  });
  return id;
}
export function queryRecord(id: string) {
  const value = records.get(id);
  return value && Date.now() - value.at < 900000 ? value : undefined;
}
