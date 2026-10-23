/** Exact judge regression against live providers. Outputs counts/status only. */
import assert from "node:assert/strict";
import { resolveCulturalSeeds, agentDependencies } from "../src/agent/runtime.ts";
import { passport, seal } from "../src/passport/service.ts";
import { createSession } from "../src/agent/store.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
const text="Find quieter Indian restaurants in London, moderate budget, minimum rating 4.5. Keep my music and movies unchanged.";
try {
 const items=await resolveCulturalSeeds(["A.R. Rahman","Interstellar","Indian cuisine"]);
 const selected=items.map((item,index)=>item.candidates.find(c=>index===0?c.types.includes("urn:entity:artist"):index===1?c.types.includes("urn:entity:movie")&&c.detail.includes("2014"):c.id.includes(":cuisine:")&&c.name.toLowerCase()==="indian"));
 assert.ok(selected.every(Boolean));
 const initial=await passport("London",seal(items),selected.map(c=>c!.id),[],["Eat","Music","Movies"]);
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
  assert.equal(reply.state.queryPreferences?.Eat?.businessRatingMin,4.5);
  const changed=reply.changed.includes("Eat");
  const dining=reply.state.cards.filter(c=>c.section==="Eat");
  if(changed)assert.ok(dining.every(card=>card.intelligence?.commercial.priceLevel!==undefined&&card.intelligence.commercial.priceLevel<=2&&(card.intelligence?.quality.businessRating??0)>=4.5));
  if(changed)assert.ok(dining.every(card=>(card.evidence?.params["operator.filter.tags"] ?? "intersection")==="intersection"),"The exact request must satisfy cuisine AND quietness, not union them");
  if(changed)assert.ok(dining.every(card=>card.evidence?.params["filter.tags"]?.split(",").some(tag=>tag.includes(":ambience:"))),"Quietness must be applied as a filter, not silently omitted");
  console.log(JSON.stringify({check:"exact-judge-request",mode,execution:reply.mode,providerHealth:reply.state.providerHealth,changed:reply.changed,pending:Boolean(reply.state.pending),eligibleDining:changed?dining.length:0,preservedMusicAndMovies:true,recovery:reply.state.recovery}));
  if(mode==="native")assert.equal(reply.state.providerHealth,"healthy","Native provider must succeed rather than quietly fall back");
  assert.ok(changed&&!reply.state.pending,"Exact judge request must complete or be investigated as an unresolved failure");
 }
 const deps=agentDependencies();delete deps.provider;
 const planned=structuredClone(original);planned.outingActivities=["Eat","Cinema"];
 const dinner=planned.cards.filter(card=>card.section==="Eat");
 const cinema=await runTurn(planned,{message:"Find local cinemas for this outing. Keep my dining, coffee, music and movies unchanged."},deps);
 assert.deepEqual(cinema.state.cards.filter(card=>card.section==="Eat"),dinner);
 assert.deepEqual(cinema.state.outingActivities,["Eat","Cinema"]);
 const venues=cinema.state.cards.filter(card=>card.section==="Culture"&&card.evidence?.result.tags.some(tag=>/cinema|movie theater|movie theatre/i.test(tag.name)));
 assert.ok(venues.length>0,"Planner needs actual local cinema venues");
 console.log(JSON.stringify({check:"planner-cinema-recovery",cinemas:venues.length,dinnerPreserved:true,orderPreserved:true}));
} catch {console.error("Judge journey acceptance FAIL; request payloads and credentials withheld.");process.exitCode=1;}
