import { destinationCatalog } from "../../../src/workspace/destinations";
import { debugRequest } from "../../../src/agent/debug";
export function GET() {
  return debugRequest("destinations", async () => {
    try {
      return Response.json({ destinations: await destinationCatalog() }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "Destinations are temporarily unavailable. Please retry." }, { status: 503 });
    }
  });
}
