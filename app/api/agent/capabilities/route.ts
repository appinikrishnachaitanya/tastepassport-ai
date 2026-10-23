import { debugRequest } from "../../../../src/agent/debug";
import {
  providerHealth,
  conciergeUnavailable,
} from "../../../../src/agent/health";
import { NextResponse } from "next/server";
import { configuredProvider } from "../../../../src/agent/provider";
async function handleGET() {
  let enabled = false;
  try {
    enabled = Boolean(configuredProvider());
  } catch {}
  return NextResponse.json(
    {
      mode: enabled ? "model-mcp" : "deterministic",
      health: providerHealth(enabled),
      refinement: true,
      notice: enabled
        ? "Taste Concierge is ready to try."
        : conciergeUnavailable,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function GET() {
  return debugRequest("agent.capabilities", () => handleGET());
}
