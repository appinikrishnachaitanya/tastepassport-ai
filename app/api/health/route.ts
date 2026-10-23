export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Process readiness only. Upstream outages must not restart healthy app instances. */
export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
