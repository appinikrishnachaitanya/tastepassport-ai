import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { sectionTypes } from "../passport/model.ts";

const context = new AsyncLocalStorage<string>();
const sections = Object.keys(sectionTypes);
const routes = [
  "resolve",
  "agent.resolve",
  "agent.interpret",
  "passport",
  "agent.turn",
  "agent.session",
  "agent.comparison",
  "agent.intelligence",
  "account",
  "account.passports",
  "account.plans",
  "account.preferences",
  "destinations",
  "auth.callback",
  "agent.capabilities",
] as const;
type DebugEvent =
  | "gemini.request"
  | "gemini.tool_selected"
  | "gemini.result"
  | "gemini.failed"
  | "qloo.invoked"
  | "qloo.result"
  | "qloo.failed"
  | "qloo.request"
  | "qloo.response"
  | "qloo.cache_hit"
  | "qloo.retry"
  | "qloo.entities"
  | "qloo.validated"
  | "qloo.enrichment"
  | "api.started"
  | "api.completed"
  | "api.failed"
  | "resolution.started"
  | "resolution.candidates"
  | "resolution.completed"
  | "passport.started"
  | "passport.pool"
  | "passport.completed"
  | "discovery.started"
  | "discovery.pool"
  | "discovery.completed"
  | "discovery.failed"
  | "agent.route"
  | "agent.check_failed"
  | "agent.response"
  | "agent.started"
  | "agent.intent"
  | "agent.completed"
  | "agent.fallback"
  | "feedback.recorded"
  | "session.reset"
  | "session.created"
  | "session.updated"
  | "session.missing"
  | "session.expired"
  | "service.invoked"
  | "service.response"
  | "service.failed";
interface DebugMeta {
  service?: "supabase-auth" | "supabase-storage";
  trace?: string;
  operation?: "interpret" | "choose" | "baseline" | "explain" | "observe-tools" | "compose";
  tool?: string;
  transport?: "exec" | "mcp";
  count?: number;
  status?: number;
  route?: (typeof routes)[number];
  endpoint?:
    | "search"
    | "insights"
    | "tags"
    | "tag-types"
    | "entities"
    | "compare"
    | "trending";
  droppedCount?: number;
  parameters?: string[];
  city?: string;
  section?: string;
  sections?: string[];
  mode?: string;
  kind?: string;
  pool?: string;
  action?: string;
  signalCount?: number;
  excludedCount?: number;
  keptCount?: number;
  seedIndex?: number;
  elapsedMs?: number;
  attempt?: number;
  delayMs?: number;
}
/** Strict metadata allowlist. Never log bodies, cache keys, tokens, arguments or errors. */
export function debugEvent(event: DebugEvent, meta: DebugMeta = {}) {
  const error =
    event.endsWith(".failed") ||
    (event === "session.expired" || event === "session.missing") ||
    (typeof meta.status === "number" && meta.status >= 400);
  const primary = ![
    "qloo.cache_hit",
    "discovery.pool",
    "resolution.candidates",
  ].includes(event);
  if (!error && !primary && process.env.AGENT_DEBUG !== "1") return;
  if (!error && process.env.LOG_LEVEL === "error") return;
  const allowed = (value: unknown, values: readonly string[]) =>
    typeof value === "string" && values.includes(value) ? value : undefined;
  const number = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : undefined;
  const write = error ? console.error : console.info;
  write(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      level: error ? "error" : "info",
      service: allowed(meta.service, ["supabase-auth", "supabase-storage"]),
      requestTrace: context.getStore(),
      trace:
        meta.trace && /^[a-f0-9-]{36}$/.test(meta.trace)
          ? meta.trace
          : undefined,
      operation: allowed(meta.operation, [
        "interpret",
        "choose",
        "observe-tools", "compose",
        "baseline",
        "explain",
      ]),
      tool: allowed(meta.tool, [
        "interpret_cultural_intent",
        "explain_qloo_evidence",
        "qloo_find_tags",
        "qloo_rank",
      ]),
      transport: allowed(meta.transport, ["exec", "mcp"]),
      route: allowed(meta.route, routes),
      endpoint: allowed(meta.endpoint, [
        "search",
        "insights",
        "tags",
        "tag-types",
        "entities",
        "compare",
        "trending",
      ]),
      droppedCount: number(meta.droppedCount),
      parameters: meta.parameters?.filter((p) =>
        /^(?:bias\.(?:content_based|quality|trends)|filter\.(?:rating\.(?:min|max)|price_level\.(?:min|max)|external\.resy\.[a-z_.]+|properties\.exists|geocode\.metro)|signal\.location\.query|diversify\.(?:by|take))$/.test(
          p,
        ),
      ),
      city: allowed(meta.city, [
        "Toronto",
        "New York City",
        "London",
        "Paris",
        "Tokyo",
      ]),
      section: allowed(meta.section, sections),
      sections: Array.isArray(meta.sections)
        ? meta.sections.filter((s) => sections.includes(s))
        : undefined,
      mode: allowed(meta.mode, [
        "familiar",
        "balanced",
        "explore",
        "deterministic",
        "model-mcp",
      ]),
      kind: allowed(meta.kind, ["onboard", "refine", "hide", "unknown"]),
      pool: allowed(meta.pool, ["direct", "adjacent", "place", "artist"]),
      action: allowed(meta.action, [
        "interpret", "action", "clarification", "current-results",
        "completed", "needs-input", "partial", "blocked", "cancelled", "failed",
        "conversation",
        "new-passport",
        "feedback",
        "accepted",
        "rejected",
        "cleared",
        "guided",
        "recovery",
        "familiarity",
        "tag-choice",
        "message",
      ]),
      status:
        number(meta.status) !== undefined &&
        meta.status! >= 100 &&
        meta.status! <= 599
          ? meta.status
          : undefined,
      count: number(meta.count),
      signalCount: number(meta.signalCount),
      excludedCount: number(meta.excludedCount),
      keptCount: number(meta.keptCount),
      seedIndex: number(meta.seedIndex),
      elapsedMs: number(meta.elapsedMs),
      attempt: number(meta.attempt),
      delayMs: number(meta.delayMs),
    }),
  );
}
/** Correlate all async backend operations without logging or exposing the session token. */
export function debugRequest(
  route: (typeof routes)[number],
  run: () => Promise<Response>,
): Promise<Response> {
  return context.run(randomUUID(), async () => {
    const started = Date.now();
    debugEvent("api.started", { route });
    try {
      const response = await run();
      debugEvent(response.status < 400 ? "api.completed" : "api.failed", {
        route,
        status: response.status,
        elapsedMs: Date.now() - started,
      });
      return response;
    } catch (error) {
      debugEvent("api.failed", { route, elapsedMs: Date.now() - started });
      throw error;
    }
  });
}
