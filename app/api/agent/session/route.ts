import { browserRequestError, readRequestText } from "../../../../src/http/request.ts";
import { debugRequest, debugEvent } from "../../../../src/agent/debug";
import { normalizeSession } from "../../../../src/agent/session";
import { passportView } from "../../../../src/workspace/state";
import { validSessionId } from "../../../../src/agent/session-lifetime";
import { sameOrigin, privateJson } from "../../../../src/account/server";
import { loadSession, discardSession } from "../../../../src/agent/store";
export const runtime = "nodejs";
async function handleDELETE(request: Request) {
  const rejected = browserRequestError(request);
  if (rejected) return rejected;
  try {
    const raw = await readRequestText(request, 200);
    if (raw.length > 200) throw Error();
    const body = JSON.parse(raw);
    if (!validSessionId(body.sessionId)) throw Error();
    await discardSession(body.sessionId);
    debugEvent("session.reset", { action: "new-passport" });
    return Response.json(
      { cleared: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not clear session." },
      { status: 400 },
    );
  }
}

export function DELETE(request: Request) {
  return debugRequest("agent.session", () => handleDELETE(request));
}

/** A recovery check reads trusted server state; browser backups cannot create a session. */
export function POST(request: Request) {
  return debugRequest("agent.session", async () => {
    if (!sameOrigin(request)) return privateJson({ error: "Please use this app." }, 403);
    let sessionId: string;
    try {
      const raw = await readRequestText(request, 200);
      if (raw.length > 200) throw Error();
      const body = JSON.parse(raw);
      if (!validSessionId(body.sessionId)) throw Error();
      sessionId = body.sessionId;
    } catch { return privateJson({ error: "Invalid Passport." }, 400); }
    try {
      const session = normalizeSession(await loadSession(sessionId));
      return privateJson({ passport: passportView(session, "Your discoveries are ready to explore.") });
    } catch (error) {
      const expired = error instanceof Error && /expired|session is no longer available/.test(error.message);
      return privateJson({ error: expired ? "Refresh with your tastes to continue." : "Could not reconnect right now." }, expired ? 410 : 503);
    }
  });
}
