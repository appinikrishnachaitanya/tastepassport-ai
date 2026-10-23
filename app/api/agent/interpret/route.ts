import { browserRequestError, readRequestText } from "../../../../src/http/request.ts";
import { debugRequest, debugEvent } from "../../../../src/agent/debug";
import { conciergeUnavailable } from "../../../../src/agent/health";
import { NextResponse } from "next/server";
import { configuredProvider } from "../../../../src/agent/provider";
import {
  culturalText,
  interpret,
  validateIntent,
} from "../../../../src/agent/intent";
async function handlePOST(request: Request) {
  const rejected = browserRequestError(request);
  if (rejected) return rejected;
  try {
    const raw = await readRequestText(request, 2000);
    if (raw.length > 2000) throw Error("Input is too long");
    const b = JSON.parse(raw);
    if (typeof b.message !== "string") throw Error("Invalid input");
    culturalText(b.message);
    let provider;
    try {
      provider = configuredProvider();
    } catch {}
    if (provider)
      try {
        return NextResponse.json(
          {
            intent: validateIntent(await provider.interpret(b.message)),
            mode: "model-mcp",
            health: "healthy",
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch {}
    debugEvent("agent.fallback", { mode: "deterministic" });
    return NextResponse.json(
      {
        intent: interpret(b.message, b.city),
        mode: "deterministic",
        health: provider ? "unavailable" : "unconfigured",
        notice: conciergeUnavailable,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Share cultural tastes only, without identifying or contact information.",
      },
      { status: 400 },
    );
  }
}

export function POST(request: Request) {
  return debugRequest("agent.interpret", () => handlePOST(request));
}
