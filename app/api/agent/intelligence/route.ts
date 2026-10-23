import { browserRequestError, readRequestText } from "../../../../src/http/request.ts";
import { relevantThemes } from "../../../../src/passport/taste-themes";
import { validSessionId } from "../../../../src/agent/session-lifetime.ts";
import { trending } from "../../../../src/qloo/trending";
import { loadSession } from "../../../../src/agent/store";
import { unseal } from "../../../../src/passport/service";
import { compareProfiles } from "../../../../src/qloo/compare";
import { entityDetails, tagTypes } from "../../../../src/qloo/lookups";
import { normalizeEntity } from "../../../../src/qloo/normalizer";
import { queryRecord } from "../../../../src/qloo/diagnostics";
import { sectionOrder } from "../../../../src/workspace/state";
import type { Section } from "../../../../src/passport/model";
import { configuredProvider } from "../../../../src/agent/provider";
import { evidenceFacts } from "../../../../src/qloo/explanation";
import { debugRequest } from "../../../../src/agent/debug";
import { discoverSection } from "../../../../src/agent/runtime";
import { analyze, selectAnalysisSignals, type AnalysisKind } from "../../../../src/qloo/analysis";
export const runtime = "nodejs";
const running = new Set<string>();
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
async function handlePOST(request: Request) {
  const rejected = browserRequestError(request);
  if (rejected) return rejected;
  let id = "",
    acquired = false;
  try {
    const raw = await readRequestText(request, 20000);
    if (raw.length > 20000)
      return json({ error: "Request is too large." }, 400);
    const b = JSON.parse(raw);
    if (!validSessionId(b.sessionId) || !Number.isSafeInteger(b.revision) || b.revision < 0)
      return json({ error: "Build a Passport first." }, 400);
    const state = await loadSession(b.sessionId);
    id = state.id;
    if (b.revision !== state.revision)
      return json(
        { error: "Your Passport changed. Retry with the latest version." },
        409,
      );
    const signal = AbortSignal.timeout(60000);
    const selectedCard =
      state.cards.find((c) => c.id === b.entityId) ??
      state.savedCards?.find((c) => c.id === b.entityId);
    if (b.action === "debug") {
      if (
        process.env.NODE_ENV !== "development" ||
        process.env.QLOO_DEBUG_UI !== "1"
      )
        return json({ error: "Not found." }, 404);
      const records = [
        ...new Set(state.cards.map((c) => c.evidence?.queryId).filter(Boolean)),
      ]
        .map((q) => queryRecord(q!))
        .filter(Boolean);
      return json({
        plans: state.queryPreferences,
        records,
        normalized: state.cards.map((c) => c.intelligence),
        tagTypes: await tagTypes(),
      });
    }
    if (running.has(id))
      return json(
        { error: "A taste lookup is already running. Please wait." },
        429,
      );
    running.add(id);
    acquired = true;
    if (b.action === "analysis") {
      if (!["taste","heatmap","demographics"].includes(b.kind)) return json({error:"Choose a supported analysis."},400);
      let interests;
      try { interests=selectAnalysisSignals(state.selected,b.interestIds); }
      catch { return json({error:"Choose one to five confirmed interests to explore."},400); }
      const analysis = await analyze(b.kind as AnalysisKind, interests, state.city, signal);
      if (analysis.kind === "taste") analysis.tags = relevantThemes(analysis.tags, state.selected.filter(interest => b.interestIds.includes(interest.id)));
      return json({analysis});
    }
    if (b.action === "trends") {
      if (!selectedCard) return json({error:"Choose a current discovery."},400);
      const type=selectedCard.section === "Music" ? "urn:entity:artist" : ["Eat","Coffee","Culture","Lifestyle"].includes(selectedCard.section) ? "urn:entity:place" : undefined;
      if (!type) return json({error:"History is available only for artists and places."},400);
      try { return json({trend:await trending(selectedCard.id,type,signal)}); }
      catch { return json({error:"Historical trends are unavailable for this discovery. Your recommendations are unchanged."},503); }
    }
    if (b.action === "explain") {
      if (!selectedCard)
        return json({ error: "Choose a current discovery." }, 400);
      const facts = evidenceFacts(selectedCard);
      try {
        const provider = configuredProvider();
        if (!provider?.explain) throw Error();
        const indices = await provider.explain(facts);
        return json({
          sentences: indices.length
            ? indices.map((i) => facts[i])
            : facts.slice(0, 3),
          mode: "model-grounded",
        });
      } catch {
        return json({ sentences: facts.slice(0, 3), mode: "guided-evidence" });
      }
    }
    if (b.action === "details") {
      if (!selectedCard)
        return json({ error: "Choose a current discovery." }, 400);
      const entities = await entityDetails([selectedCard.id], signal);
      const entity = entities.find((e) => e.entity_id === selectedCard.id);
      return entity
        ? json({ details: normalizeEntity(entity) })
        : json({ error: "More details are unavailable." }, 404);
    }
    if (
      b.action !== "together" ||
      typeof b.token !== "string" ||
      !Array.isArray(b.ids) ||
      b.ids.length < 1 ||
      b.ids.length > 5 ||
      new Set(b.ids).size !== b.ids.length ||
      !sectionOrder.includes(b.section)
    )
      return json(
        { error: "Confirm the other person’s interests first." },
        400,
      );
    const choices = unseal(b.token);
    const partner = choices.flatMap((item) =>
      item.candidates.filter(
        (c) => b.ids.includes(c.id) && !c.id.startsWith("urn:tag:"),
      ),
    );
    if (partner.length !== b.ids.length)
      return json(
        { error: "Choose returned entity matches for the comparison." },
        400,
      );
    const a = state.selected
      .filter((c) => !c.id.startsWith("urn:tag:"))
      .map((c) => c.id);
    if (!a.length) return json({ error: "Add a named artist, film, book or brand to your Passport before comparing. Cuisine concepts alone cannot form an entity profile." }, 400);
    const comparison = await compareProfiles(
      a,
      partner.map((c) => c.id),
      signal,
    );
    if (!comparison.shared.length)
      return json({
        comparison,
        cards: [],
        notice:
          "No shared cultural tags were returned. Your existing Passport is preserved.",
      });
    const section = b.section as Section;
    const rejected = state.feedback.filter((f) => !f.accepted).map((f) => f.id);
    try {
      const tags = comparison.shared.map((t) => ({
        id: t.id,
        name: t.name,
        types: ["urn:tag"],
        detail: "Returned common ground",
      }));
      const joint = structuredClone(state);
      joint.selected = [...new Map([...state.selected, ...partner].map(c => [c.id,c])).values()];
      joint.tags = [...new Map([...state.tags, ...tags].map(c => [c.id,c])).values()];
      joint.categoryTags ??= {};
      joint.categoryTags[section] = [...new Set([...(joint.categoryTags[section] ?? []), ...tags.map(t => t.id)])];
      const cards = (await discoverSection(joint, section, state.categoryConstraints[section] ?? [], [...a, ...partner.map(c => c.id), ...rejected], false, signal)).slice(0,6);
      return json({
        comparison,
        partner: partner.map((p) => p.name),
        cards,
        notice: cards.length
          ? "Suggestions use both profiles and the shared tags returned by the comparison. This does not guarantee both people will like every result."
          : "No matching places for your shared tastes and current filters. Your Passport is preserved.",
      });
    } catch {
      return json({
        comparison,
        cards: [],
        notice:
          "Your shared tastes are available, but recommendations are temporarily unavailable. Your Passport is preserved.",
      });
    }
  } catch {
    return json(
      {
        error:
          "This taste lookup is temporarily unavailable. Your Passport is preserved.",
      },
      502,
    );
  } finally {
    if (acquired) running.delete(id);
  }
}
export function POST(request: Request) {
  return debugRequest("agent.intelligence", () => handlePOST(request));
}
