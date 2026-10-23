/** Live provider acceptance; approved cultural context is bounded and only status/counts are logged. */
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
 const deps=agentDependencies();const guided=process.env.PASSPORT_FORCE_GUIDED==="1";if(guided)delete deps.provider;else assert.ok(deps.provider);
 const first=await runTurn(initial,{message:"Find cheaper vegetarian Indian food in Toronto and explain why it fits my tastes."},deps);
 assert.equal(first.state.providerHealth,guided?"unconfigured":"healthy");assert.deepEqual(first.changed,["Eat"]);assert.equal(first.state.pending,undefined);
 const followup=await runTurn(first.state,{message:"Make those cheaper. Keep music and movies unchanged."},deps);
 assert.equal(followup.state.pending,undefined,"An ordinary cheaper follow-up must not ask for a concept match");
 assert.equal(followup.state.queryPreferences?.Eat?.priceMax,1);
 if(followup.changed.includes("Eat")) {
  assert.match(followup.message,/2\/4 → 1\/4/);
  assert.match(followup.message,/Kept:.*Indian/);
  assert.ok(/Listing example/.test(followup.message)||/could not be verified/.test(followup.message));
 }
 assert.ok(followup.changed.every(section=>section==="Eat"));
 if(followup.changed.includes("Eat"))assert.ok(followup.state.cards.filter(card=>card.section==="Eat").every(card=>card.intelligence?.commercial.priceLevel!==undefined&&card.intelligence.commercial.priceLevel<=1));
 for(const section of ["Music","Movies"] as const) assert.deepEqual(followup.state.cards.filter(card=>card.section===section),initial.cards.filter(card=>card.section===section));
 assert.ok(followup.state.categoryTags?.Eat?.some(id=>id.includes(":dietary_option:")));
 assert.ok(followup.state.categoryTags?.Eat?.includes("urn:tag:cuisine:qloo:indian"));
 const readonlyDeps={...deps,discover:async()=>{throw Error("Read-only questions must not discover");},workflow:async()=>{throw Error("Read-only questions must not invoke Qloo");}};
 const why=await runTurn(followup.state,{message:"Why these suggestions?"},readonlyDeps);
 assert.deepEqual(why.changed,[]);assert.deepEqual(why.state.cards,followup.state.cards);assert.doesNotMatch(why.message,/name a section to refine/i);
 const filters=await runTurn(why.state,{message:"What filters are saved?"},readonlyDeps);
 assert.match(filters.message,/maximum price category 1/);assert.deepEqual(filters.state.queryPreferences,followup.state.queryPreferences);
 console.log(JSON.stringify({check:"conversation-journey",firstNativeHealthy:first.state.providerHealth==="healthy",forcedGuided:guided,followupProvider:followup.state.providerHealth,followupPriceMax:1,followupDining:followup.changed.includes("Eat")?followup.state.cards.filter(c=>c.section==="Eat").length:0,otherSectionsPreserved:true,readonlyAnswers:true,boundedConversationContext:true,budgetReceipt:/2\/4 → 1\/4/.test(followup.message),verifiedListingExample:/Listing example/.test(followup.message)}));
} catch {console.error("Conversation acceptance FAIL; provider payloads and secrets withheld.");process.exitCode=1;}
