import { browserRequestError, readRequestText } from "../../../../src/http/request.ts";
import { debugRequest } from "../../../../src/agent/debug";
import { NextResponse } from "next/server";
import { resolveCulturalSeeds } from "../../../../src/agent/runtime";
import { seal } from "../../../../src/passport/service";
export const runtime = "nodejs";
async function handlePOST(request: Request) {
  const rejected = browserRequestError(request);
  if (rejected) return rejected;
  try {
    const raw = await readRequestText(request, 3000);
    if (raw.length > 3000) throw Error("Input is too long.");
    const b = JSON.parse(raw);
    if (
      !Array.isArray(b.seeds) ||
      b.seeds.length < 1 ||
      b.seeds.length > 5 ||
      b.seeds.some(
        (s: unknown) => typeof s !== "string" || !s.trim() || s.length > 100,
      ) ||
      new Set(b.seeds.map((s: string) => s.trim().toLowerCase())).size !==
        b.seeds.length
    )
      throw Error("Enter one to five different cultural tastes.");
    const items = await resolveCulturalSeeds(
      b.seeds.map((s: string) => s.trim()),
      Array.isArray(b.concepts)
        ? b.concepts.filter(
            (c: unknown) => typeof c === "string" && b.seeds.includes(c),
          )
        : [],
    );
    return NextResponse.json(
      { items, token: seal(items) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not resolve the cultural inputs. Use one to five named tastes or cuisine concepts, without personal identifying information, and retry when Qloo is available.",
      },
      { status: 502 },
    );
  }
}

export function POST(request: Request) {
  return debugRequest("agent.resolve", () => handlePOST(request));
}
