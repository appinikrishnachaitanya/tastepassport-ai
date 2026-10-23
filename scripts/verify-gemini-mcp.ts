/** Optional, controlled live acceptance probe. No credentials are logged or saved. */
import { configuredProvider } from "../src/agent/provider.ts";
import {
  agentDependencies,
  resolveCulturalSeeds,
} from "../src/agent/runtime.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
process.env.AGENT_DEBUG ??= "1";
const provider = configuredProvider();
if (!provider) {
  console.error(
    "Live model/MCP acceptance UNRUN: configure a Vertex Express Mode key as GEMINI_API_KEY or GOOGLE_API_KEY, and set GEMINI_MODEL.",
  );
  process.exit(2);
}
let stage = "resolve-confirmed-tastes";
try {
  const items = await resolveCulturalSeeds([
    "A.R. Rahman",
    "Interstellar",
    "Indian cuisine",
  ]);
  const selected = items.map((item, i) =>
    i === 0
      ? item.candidates.find((c) => c.types.includes("urn:entity:artist"))
      : i === 1
        ? item.candidates.find(
            (c) =>
              c.types.includes("urn:entity:movie") && c.detail.includes("2014"),
          )
        : item.candidates.find((c) => c.id === "urn:tag:cuisine:qloo:indian"),
  );
  if (selected.some((c) => !c)) throw Error();
  const state = normalizeSession({
    id: "acceptance-probe",
    revision: 0,
    expires: Date.now() + 90000,
    city: "Toronto",
    selected: selected.filter((c) => Boolean(c)) as NonNullable<
      (typeof selected)[number]
    >[],
    tags: [],
    constraints: [],
    categoryConstraints: {},
    cards: [],
    previous: [],
    feedback: [],
    notices: [],
  });
  state.tags = state.selected.filter((c) => c.id.startsWith("urn:tag:"));
  state.categoryTags = { Eat: state.tags.map((c) => c.id) };
  const request =
    "Find independent contemporary art in Toronto connected to my film tastes.";
  const deps = agentDependencies();
  const native = deps.workflow;
  const operations: { name: string; status: string; count: number }[] = [];
  deps.workflow = async (mode, name, args, signal) => {
    const result = await native(mode, name, args, signal);
    if (mode === "mcp")
      operations.push({
        name,
        status: result.status,
        count: Array.isArray(result.results) ? result.results.length : 0,
      });
    return result;
  };
  stage = "native-model-tool-selection-and-mcp";
  const reply = await runTurn(state, { message: request }, deps);
  if (!operations.length || !operations.some((o) => o.status === "ok"))
    throw Error();
  console.log(
    JSON.stringify({
      check: "native-model-mcp",
      operations,
      section: reply.state.intent?.sections,
      confirmationRequired: Boolean(reply.state.pending),
      changed: reply.changed,
    }),
  );
  stage = "same-request-model-baseline";
  const baseline = await provider.baseline?.(
    "Toronto",
    state.selected.map((c) => c.name),
    request,
  );
  if (!baseline || baseline.request !== request) throw Error();
  console.log(
    "Same-request model-only baseline generated without Qloo tools; contents not logged.",
  );
} catch {
  console.error(JSON.stringify({ acceptance: "failed", stage }));
  console.error(
    "Live model/MCP acceptance FAILED or selected no usable MCP operation. Existing guided Qloo behavior remains available.",
  );
  process.exitCode = 1;
}
