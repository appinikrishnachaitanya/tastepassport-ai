import { browserRequestError, readRequestText } from "../../../../src/http/request.ts";
import { debugRequest } from "../../../../src/agent/debug";
import { validSessionId } from "../../../../src/agent/session-lifetime.ts";
import { getSession } from "../../../../src/agent/store";
import { configuredProvider } from "../../../../src/agent/provider";
export const runtime = "nodejs";
const cache = new Map<
  string,
  { at: number; baseline: unknown; comparison: unknown }
>();
const running = new Set<string>();
async function handlePOST(request: Request) {
  const rejected = browserRequestError(request);
  if (rejected) return rejected;
  let id = "",
    acquired = false;
  try {
    const raw = await readRequestText(request, 200);
    if (raw.length > 200) throw Error();
    const body = JSON.parse(raw);
    if (!validSessionId(body.sessionId)) throw Error();
    id = body.sessionId;
    const state = getSession(id);
    const comparison = structuredClone(state.comparison);
    if (!comparison)
      return Response.json(
        {
          error:
            "Submit a cultural refinement before comparing the same request.",
        },
        { status: 409 },
      );
    const cacheKey = `${id}:${comparison.revision}`;
    const provider = configuredProvider();
    if (!provider?.baseline)
      return Response.json(
        { error: "Comparison unavailable." },
        { status: 503 },
      );
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < 120000)
      return Response.json(
        { baseline: cached.baseline, comparison: cached.comparison },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (running.has(id))
      return Response.json(
        { error: "Comparison already in progress." },
        { status: 429 },
      );
    running.add(id);
    acquired = true;
    const baseline = await provider.baseline(
      comparison.destination,
      comparison.tastes,
      comparison.request,
    );
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { at: Date.now(), baseline, comparison });
    return Response.json(
      { baseline, comparison },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Comparison unavailable." }, { status: 503 });
  } finally {
    if (acquired) running.delete(id);
  }
}

export function POST(request: Request) {
  return debugRequest("agent.comparison", () => handlePOST(request));
}
