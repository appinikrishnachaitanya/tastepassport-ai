/** Opt-in real Qloo regression: discovery style must not relax explicit dietary/cuisine requirements. */
import assert from "node:assert/strict";
import { resolveCulturalSeeds, agentDependencies } from "../src/agent/runtime.ts";
import { passport, seal } from "../src/passport/service.ts";
import { createSession } from "../src/agent/store.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
try {
  const items = await resolveCulturalSeeds(["A.R. Rahman", "Interstellar", "Indian cuisine"]);
  const selected = items.map((item,index) => item.candidates.find(candidate => index===0
    ? candidate.types.includes("urn:entity:artist") : index===1
    ? candidate.types.includes("urn:entity:movie") && candidate.detail.includes("2014")
    : candidate.id.includes(":cuisine:") && candidate.name.toLowerCase()==="indian"));
  assert.ok(selected.every(Boolean));
  const initial = createSession(await passport("Toronto",seal(items),selected.map(candidate => candidate!.id),[],["Eat","Music","Movies"]));
  const deps = agentDependencies();delete deps.provider;
  const refined = await runTurn(initial,{message:"Find vegetarian Indian restaurants, moderate budget, minimum rating 4.0. Keep music and movies unchanged."},deps);
  assert.deepEqual(refined.changed,["Eat"]);assert.equal(refined.state.pending,undefined);
  for (const mode of ["familiar","balanced","explore"] as const) {
    const result = await runTurn(refined.state,{familiarity:{section:"Eat",mode}},deps);
    assert.deepEqual(result.changed,["Eat"]);
    assert.equal(result.state.queryPreferences?.Eat?.priceMax,2);
    assert.equal(result.state.queryPreferences?.Eat?.businessRatingMin,4);
    const dining = result.state.cards.filter(card => card.section==="Eat");
    assert.ok(dining.length>0);
    for (const card of dining) {
      const tags = card.evidence?.params["filter.tags"]?.split(",") ?? [];
      assert.ok(tags.includes("urn:tag:cuisine:qloo:indian"));
      assert.ok(tags.some(id => id.startsWith("urn:tag:dietary_option:")));
      assert.equal(card.evidence?.params["operator.filter.tags"],"intersection");
      assert.ok(card.intelligence?.commercial.priceLevel!==undefined && card.intelligence.commercial.priceLevel<=2);
      assert.ok((card.intelligence?.quality.businessRating ?? 0)>=4);
    }
    for (const section of ["Music","Movies"] as const)
      assert.deepEqual(result.state.cards.filter(card=>card.section===section),refined.state.cards.filter(card=>card.section===section));
    console.log(JSON.stringify({check:"live-style-preservation",mode,dining:dining.length,cuisineAndDietRequired:true,numericConstraintsVerified:true,otherCategoriesPreserved:true}));
  }
} catch {
  console.error("Live style preservation FAIL; provider payloads and credentials withheld.");
  process.exitCode=1;
}
