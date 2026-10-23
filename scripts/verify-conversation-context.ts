/** Live native Gemini conversation memory; emits status/counts, never transcripts or payloads. */
import assert from "node:assert/strict";
import { resolveCulturalSeeds, agentDependencies } from "../src/agent/runtime.ts";
import { passport, seal } from "../src/passport/service.ts";
import { createSession } from "../src/agent/store.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
try {
 const items=await resolveCulturalSeeds(["A.R. Rahman","Interstellar","Indian cuisine"]);
 const selected=items.map((item,index)=>item.candidates.find(c=>index===0?c.types.includes("urn:entity:artist"):index===1?c.types.includes("urn:entity:movie")&&c.detail.includes("2014"):c.id.includes(":cuisine:")&&c.name.toLowerCase()==="indian"));
 assert.ok(selected.every(Boolean));
 const initial=createSession(await passport("Toronto",seal(items),selected.map(c=>c!.id),[],["Eat","Music","Movies"]));
 const deps=agentDependencies();assert.ok(deps.provider);
 let reply=await runTurn(initial,{message:"Find vegetarian Indian restaurants, moderate budget, minimum rating 4.0. Keep music and movies unchanged."},deps);
 assert.equal(reply.state.providerHealth,"healthy");assert.deepEqual(reply.changed,["Eat"]);assert.equal(reply.state.pending,undefined);
 for(const [message,rating] of [["Raise that minimum to 4.6, leave everything else as it is.",4.6],["Actually make it 4.7 instead.",4.7]] as const) {
  reply=await runTurn(reply.state,{message},deps);
  assert.equal(reply.state.providerHealth,"healthy");assert.equal(reply.state.pending,undefined);
  assert.deepEqual(reply.changed,["Eat"],"Contextual refinement must complete rather than asking for a new scope");
  assert.equal(reply.state.queryPreferences?.Eat?.businessRatingMin,rating);assert.equal(reply.state.queryPreferences?.Eat?.priceMax,2);
  assert.ok(reply.state.categoryTags?.Eat?.some(id=>id.includes(":dietary_option:")));assert.ok(reply.state.categoryTags?.Eat?.includes("urn:tag:cuisine:qloo:indian"));
  const dining=reply.state.cards.filter(card=>card.section==="Eat");
  assert.ok(dining.length>0&&dining.every(card=>(card.intelligence?.quality.businessRating??0)>=rating));
  for(const section of ["Music","Movies"] as const)assert.deepEqual(reply.state.cards.filter(card=>card.section===section),initial.cards.filter(card=>card.section===section));
  console.log(JSON.stringify({check:"native-conversation-context",ratingMinimum:rating,dining:dining.length,preservedOtherCategories:true,pending:false}));
 }
} catch {console.error("Native context acceptance FAIL; transcripts, provider payloads and secrets withheld.");process.exitCode=1;}
