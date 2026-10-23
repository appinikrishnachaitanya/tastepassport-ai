/** Opt-in live evaluation. Outputs aggregate metrics only, never API payloads or secrets. */
import { search, insights } from "../src/qloo/client.ts";
import { findTags } from "../src/qloo/lookups.ts";
import { candidates } from "../src/passport/model.ts";
import { validatedSection } from "../src/agent/validation.ts";
import { passport, seal } from "../src/passport/service.ts";
import { createSession } from "../src/agent/store.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import { agentDependencies } from "../src/agent/runtime.ts";
const counts = (cards: { section: string }[]) =>
  Object.fromEntries(
    ["Eat", "Coffee", "Culture", "Music"].map((s) => [
      s,
      cards.filter((c) => c.section === s).length,
    ]),
  );
async function main() {
  if (!process.env.QLOO_API_KEY) throw Error("Qloo credentials unavailable");
  const artist = (await search("A. R. Rahman")).find(
    (e) =>
      (e.subtype ?? e.type) === "urn:entity:artist" ||
      e.types?.includes("urn:entity:artist"),
  );
  const film =
    (await search("Interstellar")).find(
      (e) => e.properties?.release_year === 2014,
    ) ?? (await search("Interstellar"))[0];
  const indian = (await findTags("Indian")).find((t) => /indian/i.test(t.name));
  const other = (await search("Taylor Swift")).find(
    (e) =>
      (e.subtype ?? e.type) === "urn:entity:artist" ||
      e.types?.includes("urn:entity:artist"),
  );
  if (!artist || !film || !indian || !other)
    throw Error("Could not resolve evaluation seeds");
  const selected = [...candidates([artist]), ...candidates([film]), indian];
  const base = {
    "filter.type": "urn:entity:place",
    "filter.location.query": "Toronto",
    "filter.location.radius": "0",
    take: "20",
  };
  const profiles = [
    ["combined", [artist.entity_id, film.entity_id], true],
    ["cuisine-only", [], true],
    ["without-film", [artist.entity_id], true],
    ["different-profile", [other.entity_id], false],
  ] as const;
  const rows: { name: string; ids: string[] }[] = [];
  for (const [name, ids, cuisine] of profiles) {
    const params: Record<string, string> = {
      ...base,
      "filter.tags": "urn:tag:genre:place:restaurant",
    };
    if (ids.length) params["signal.interests.entities"] = ids.join(",");
    if (cuisine) params["signal.interests.tags"] = indian.id;
    const result = await insights(params);
    const valid = result.entities.filter((e) => validatedSection(e) === "Eat");
    rows.push({ name, ids: valid.map((e) => e.entity_id) });
    console.log(
      JSON.stringify({
        case: name,
        returned: result.entities.length,
        eligible: valid.length,
        categoryViolations: result.entities.length - valid.length,
      }),
    );
  }
  const baseline = rows[0].ids;
  for (const row of rows.slice(1))
    console.log(
      JSON.stringify({
        comparison: row.name,
        overlap: row.ids.filter((id) => baseline.includes(id)).length,
        rankChanges: row.ids.filter(
          (id, i) => baseline.includes(id) && baseline.indexOf(id) !== i,
        ).length,
      }),
    );
  const token = seal(
    selected.map((item) => ({ query: item.name, candidates: [item] })),
  );
  const result = await passport(
    "Toronto",
    token,
    selected.map((s) => s.id),
  );
  console.log(
    JSON.stringify({ case: "Toronto-initial", counts: counts(result.cards) }),
  );
  const state = createSession(result);
  const reply = await runTurn(
    state,
    {
      message:
        "Show me museums or art galleries in Toronto for the culture stop, not restaurants",
    },
    agentDependencies(),
  );
  console.log(
    JSON.stringify({
      case: "exact-refinement",
      mode: reply.mode,
      changed: reply.changed,
      counts: counts(reply.state.cards),
      pending: Boolean(reply.state.pending),
      unrelatedPreserved:
        JSON.stringify(state.cards.filter((c) => c.section !== "Culture")) ===
        JSON.stringify(
          reply.state.cards.filter((c) => c.section !== "Culture"),
        ),
    }),
  );
  for (const mode of ["balanced", "explore"] as const) {
    const compared = await runTurn(
      state,
      { familiarity: { section: "Eat", mode } },
      agentDependencies(),
    );
    const before = state.cards
      .filter((c) => c.section === "Eat")
      .map((c) => c.id);
    const after = compared.state.cards
      .filter((c) => c.section === "Eat")
      .map((c) => c.id);
    console.log(
      JSON.stringify({
        case: mode,
        returned: after.length,
        overlap: after.filter((id) => before.includes(id)).length,
        rankChanges: after.filter(
          (id, i) => before.includes(id) && before.indexOf(id) !== i,
        ).length,
      }),
    );
  }
}
main().catch(() => {
  console.error(
    "Live evaluation incomplete: inspect safe backend statuses; no provider payload printed.",
  );
  process.exitCode = 1;
});
