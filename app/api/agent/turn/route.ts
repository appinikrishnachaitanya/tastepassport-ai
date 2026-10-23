import { browserRequestError, readRequestText } from "../../../../src/http/request.ts";
import { turnFailure } from "../../../../src/agent/turn-failure";
import { validSessionId } from "../../../../src/agent/session-lifetime.ts";
import { debugRequest, debugEvent } from "../../../../src/agent/debug";
import { inSession } from "../../../../src/agent/store";
import { TurnGuard } from "../../../../src/agent/guard";
import { runTurn } from "../../../../src/agent/orchestrator";
import { agentDependencies } from "../../../../src/agent/runtime";
import { sectionOrder } from "../../../../src/workspace/state";
import { familiarities } from "../../../../src/passport/evidence";
import { reasons } from "../../../../src/agent/types";
import type { AgentInput } from "../../../../src/agent/types";
import { validatePreferences } from "../../../../src/qloo/query-plan";
export const runtime = "nodejs";
async function handlePOST(request: Request) {
  const rejected = browserRequestError(request);
  if (rejected) return rejected;
  let body: Record<string, unknown>;
  try {
    const raw = await readRequestText(request, 4000);
    if (raw.length > 4000) throw Error();
    body = JSON.parse(raw);
    if (
      !validSessionId(body.sessionId) ||
      !Number.isSafeInteger(body.revision) || Number(body.revision) < 0 ||
      typeof body.input !== "object" ||
      !body.input
    )
      throw Error();
    const input = body.input as AgentInput;
    if (
      input.message !== undefined &&
      (typeof input.message !== "string" || input.message.length > 1000)
    )
      throw Error();
    if (
      input.feedback?.clear !== undefined &&
      typeof input.feedback.clear !== "boolean"
    )
      throw Error();
    if (
      input.feedback &&
      (typeof input.feedback.id !== "string" ||
        typeof input.feedback.accepted !== "boolean" ||
        (!input.feedback.accepted && !reasons.includes(input.feedback.reason!)))
    )
      throw Error();
    const actions = [
      input.message,
      input.feedback,
      input.tagChoice,
      input.guided,
      input.recovery,
      input.reset,
      input.familiarity,
      input.discovery,
    ].filter((x) => x !== undefined);
    if (actions.length !== 1) throw Error();
    if (input.discovery) {
      if (!sectionOrder.includes(input.discovery.section)) throw Error();
      input.discovery.preferences = validatePreferences(
        input.discovery.preferences,
      );
    }
    if (
      input.familiarity &&
      (!familiarities.includes(input.familiarity.mode) ||
        !sectionOrder.includes(input.familiarity.section))
    )
      throw Error();
    if (input.reset !== undefined && input.reset !== "conversation")
      throw Error();
    if (
      input.guided &&
      (!sectionOrder.includes(input.guided.section) ||
        !Array.isArray(input.guided.constraints) ||
        input.guided.constraints.length > 5 ||
        input.guided.constraints.some(
          (c) =>
            ![
              "touristy",
              "crowded",
              "mainstream",
              "expensive",
              "atmosphere",
            ].includes(c),
        ))
    )
      throw Error();
    if (
      input.recovery &&
      (!sectionOrder.includes(input.recovery.section) ||
        !["keep-concept", "relax-quiet", "allow-popular", "closest", "retry"].includes(
          input.recovery.action,
        ))
    )
      throw Error();
    if (input.tagChoice !== undefined && typeof input.tagChoice !== "string")
      throw Error();
  } catch {
    return Response.json(
      { error: "Invalid refinement request." },
      { status: 400 },
    );
  }
  const cancellation = new AbortController();
  const deadline = AbortSignal.any([
    cancellation.signal,
    request.signal,
    AbortSignal.timeout(95_000),
  ]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    cancel() {
      cancellation.abort();
    },
    async start(controller) {
      const send = (value: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
        } catch {}
      };
      try {
        const reply = await inSession(
          body.sessionId as string,
          body.revision as number,
          async (state) => {
            const value = await runTurn(
              state,
              body.input as AgentInput,
              agentDependencies(),
              (event) => send({ type: "activity", event }),
              new TurnGuard(8, 90_000, deadline),
            );
            return { state: value.state, value };
          },
          deadline,
        );
        debugEvent("agent.completed", {
          mode: reply.mode,
          sections: reply.changed,
          count: reply.state.cards.length,
        });
        send({ type: "result", reply });
      } catch (error) {
        debugEvent("api.failed", { route: "agent.turn" });
        send({ type: "error", ...turnFailure(error, deadline.aborted) });
      }
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function POST(request: Request) {
  return debugRequest("agent.turn", () => handlePOST(request));
}
