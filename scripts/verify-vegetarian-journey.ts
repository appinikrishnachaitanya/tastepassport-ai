/** Exact judge regression against live providers. Outputs counts/status only. */
import assert from "node:assert/strict";
import { resolveCulturalSeeds, agentDependencies } from "../src/agent/runtime.ts";
import { passport, seal } from "../src/passport/service.ts";
import { createSession } from "../src/agent/store.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
const text="Find cheaper vegetarian Indian food in Toronto and explain why it fits my tastes.";
try {
 const items=await resolveCulturalSeeds(["A.R. Rahman","Interstellar","Indian cuisine"]);
 const selected=items.map((item,index)=>item.candidates.find(c=>index===0?c.types.includes("urn:entity:artist"):index===1?c.types.includes("urn:entity:movie")&&c.detail.includes("2014"):c.id.includes(":cuisine:")&&c.name.toLowerCase()==="indian"));
 assert.ok(selected.every(Boolean));
 const initial=await passport("Toronto",seal(items),selected.map(c=>c!.id),[],["Eat","Music","Movies"]);
 assert.ok(initial.cards.some(c=>c.section==="Eat")&&initial.cards.some(c=>c.section==="Music")&&initial.cards.some(c=>c.section==="Movies"));
 const original=createSession(initial);
 for(const mode of ["native","forced-fallback"] as const) {
  const deps=agentDependencies();if(mode==="forced-fallback")delete deps.provider;
  let reply=await runTurn(original,{message:text},deps);
  if(reply.state.pending) {
   const query=reply.state.pending.query.toLowerCase();
   const exact=reply.state.pending.candidates.filter(c=>c.name.toLowerCase()===query);
   if(exact.length===1)reply=await runTurn(reply.state,{tagChoice:exact[0].id},deps);
  }
  for(const section of ["Music","Movies"] as const) {
   assert.deepEqual(reply.state.cards.filter(c=>c.section===section),original.cards.filter(c=>c.section===section));
   assert.deepEqual(reply.state.queryPreferences?.[section],original.queryPreferences?.[section]);
  }
  assert.ok(reply.changed.every(section=>section==="Eat"));
  assert.equal(reply.state.queryPreferences?.Eat?.priceMax,2);

  assert.equal(reply.state.pending,undefined,"Dietary requirements must not trigger cultural disambiguation");
  const changed=reply.changed.includes("Eat");
  const dining=reply.state.cards.filter(c=>c.section==="Eat");
  if(changed)assert.ok(dining.every(card=>card.intelligence?.commercial.priceLevel!==undefined&&card.intelligence.commercial.priceLevel<=2));
  if(changed)assert.ok(dining.every(card=>card.evidence?.params["filter.tags"]?.split(",").includes("urn:tag:cuisine:qloo:indian")),"Indian cuisine must remain required");
  if(changed)assert.ok(dining.every(card=>(card.evidence?.params["operator.filter.tags"] ?? "intersection")==="intersection"),"The exact request must satisfy cuisine AND vegetarian options, not union them");
  if(changed)assert.ok(dining.every(card=>card.evidence?.params["filter.tags"]?.split(",").some(tag=>tag.includes(":dietary_option:"))),"Vegetarian options must be applied as a filter, not silently omitted");
  console.log(JSON.stringify({check:"exact-judge-request",mode,execution:reply.mode,providerHealth:reply.state.providerHealth,changed:reply.changed,pending:Boolean(reply.state.pending),eligibleDining:changed?dining.length:0,preservedMusicAndMovies:true,recovery:reply.state.recovery}));
  if(mode==="native")assert.equal(reply.state.providerHealth,"healthy","Native provider must succeed rather than quietly fall back");
  assert.ok(changed&&!reply.state.pending,"Exact judge request must complete or be investigated as an unresolved failure");
 }
} catch {console.error("Vegetarian journey acceptance FAIL; payloads and credentials withheld.");process.exitCode=1;}
