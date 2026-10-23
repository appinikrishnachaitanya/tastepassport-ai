import test from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
import { discoveryQueries } from "../src/agent/strategy.ts";
import type { AgentState } from "../src/agent/types.ts";
const indian={id:"urn:tag:cuisine:qloo:indian",name:"Indian",types:["urn:tag:cuisine:qloo"],detail:""};
const vegetarian={id:"urn:tag:dietary_option:qloo:vegetarian",name:"Vegetarian",types:["urn:tag:dietary_option:qloo"],detail:""};
function state():AgentState {
 return normalizeSession({id:"styles",revision:0,expires:Date.now()+60000,city:"Toronto",selected:[indian],tags:[indian,vegetarian],constraints:[],categoryConstraints:{},categoryTags:{Eat:[indian.id,vegetarian.id]},categoryConcepts:{Eat:["Indian cuisine","vegetarian"]},queryPreferences:{Eat:{priceMax:2,businessRatingMin:4.5}},cards:[{id:"music",name:"Keep this artist",section:"Music",types:["urn:entity:artist"],detail:""}],previous:[],feedback:[],notices:[]});
}
for(const mode of ["familiar","balanced","explore"] as const)test(`style ${mode} preserves explicitly refined cuisine, diet, budget and other categories`,async()=>{
 const original=state();let calls=0;
 const reply=await runTurn(original,{familiarity:{section:"Eat",mode}},{tools:async()=>[],workflow:async()=>({status:"ok",results:[]}),discover:async(current,section)=>{
  calls++;assert.equal(section,"Eat");assert.equal(current.queryPreferences!.Eat!.priceMax,2);assert.equal(current.queryPreferences!.Eat!.businessRatingMin,4.5);
  const base={"filter.type":"urn:entity:place","filter.tags":["urn:tag:genre:place:restaurant",...current.categoryTags!.Eat!].join(','),"operator.filter.tags":"intersection","filter.price_level.max":"2","filter.properties.business_rating.min":"4.5"};
  for(const query of discoveryQueries(base,current,section,mode)){
   assert.ok(query.params["filter.tags"].includes(indian.id));assert.ok(query.params["filter.tags"].includes(vegetarian.id));assert.equal(query.params["filter.price_level.max"],"2");assert.equal(query.params["filter.properties.business_rating.min"],"4.5");
  }
  return [{id:"food",name:"Eligible dining",section,types:["urn:entity:place"],detail:""}];
 }});
 assert.equal(calls,1);assert.deepEqual(reply.changed,["Eat"]);assert.deepEqual(reply.state.categoryConcepts!.Eat,original.categoryConcepts!.Eat);assert.deepEqual(reply.state.cards.filter(c=>c.section==="Music"),original.cards);
});
test("legacy Explore states cannot soften diet requirements even when concept context is missing",()=>{
 const original=state();original.categoryConcepts={};delete original.intent;
 const base={"filter.type":"urn:entity:place","filter.tags":["urn:tag:genre:place:restaurant",indian.id,vegetarian.id].join(','),"operator.filter.tags":"intersection"};
 const query=discoveryQueries(base,original,"Eat","explore")[0];
 assert.ok(query.params["filter.tags"].includes(vegetarian.id));assert.equal(query.params["operator.filter.tags"],"intersection");
});
