import { nearbyOutingOptions } from "../src/passport/day-out.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { interpret } from "../src/agent/intent.ts";
import { refinementScope } from "../src/agent/scope.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
import type { AgentDependencies } from "../src/agent/orchestrator.ts";
import type { AgentState } from "../src/agent/types.ts";
import type { Card } from "../src/passport/model.ts";
const request="Find quieter Indian restaurants in London, moderate budget, minimum rating 4.5. Keep my music and movies unchanged.";
const id="00000000-0000-4000-8000-000000000001";
const cuisine={id:"urn:tag:cuisine:qloo:indian",name:"Indian",types:["urn:tag:cuisine:qloo"],detail:""};
function state() {
 return normalizeSession({id:"fixture",revision:0,expires:Date.now()+90000,city:"London",selected:[{id,name:"Artist",types:["urn:entity:artist"],detail:""},cuisine],tags:[cuisine,{id:"urn:tag:ambience:place:quiet",name:"Quiet",types:["urn:tag:ambience:place"],detail:""}],constraints:[],categoryConstraints:{Music:["mainstream"]},categoryTags:{Eat:[cuisine.id,"urn:tag:ambience:place:quiet"],Music:[],Movies:[]},queryPreferences:{Music:{popularityMax:.8},Movies:{goal:"safe-bets"}},cards:[{id:"music",name:"Saved artist",section:"Music",types:["urn:entity:artist"],detail:""},{id:"film",name:"Saved movie",section:"Movies",types:["urn:entity:movie"],detail:""}],previous:[],feedback:[],notices:[]} as AgentState);
}
test("judge request routes only to dining with explicit rating and budget",()=>{
 const intent=interpret(request,"London");
 assert.deepEqual(intent.sections,["Eat"]);
 assert.deepEqual(intent.activityGenres,[]);
 assert.equal(intent.query?.priceMax,2);
 assert.equal(intent.query?.businessRatingMin,4.5);
 assert.deepEqual(refinementScope(request).preserved,["Music","Movies"]);
});
for(const scenario of ["fallback","provider-error","model-overscope"] as const) test(`judge preservation is enforced during ${scenario}`,async()=>{
 const original=state();const called:string[]=[];
 const deps:AgentDependencies={tools:async()=>[],workflow:async()=>({status:"ok",results:[]}),discover:async(s,section)=>{called.push(section);assert.equal(s.queryPreferences?.Eat?.businessRatingMin,4.5);assert.equal(s.queryPreferences?.Eat?.priceMax,2);assert.equal(s.queryPreferences?.Eat?.tagOperator,undefined);assert.equal(s.queryPreferences?.Eat?.includeTags,undefined);return [{id:"new-food",name:"New eligible dining",section,types:["urn:entity:place"],detail:""}] as Card[];}};
 if(scenario!=="fallback")deps.provider={interpret:async()=>{if(scenario==="provider-error")throw Error("Fixture provider failure");return {kind:"refine",seeds:[],concepts:[],constraints:[],sections:["Eat","Music","Movies"],strategy:"discover",query:{businessRatingMin:1,tagOperator:"union",includeTags:["urn:tag:ambience:place:invented"]}};},choose:async()=>[]};
 const reply=await runTurn(original,{message:request},deps);
 assert.deepEqual(called,["Eat"]);assert.deepEqual(reply.changed,["Eat"]);
 for(const section of ["Music","Movies"] as const) {
  assert.deepEqual(reply.state.cards.filter(c=>c.section===section),original.cards.filter(c=>c.section===section));
  assert.deepEqual(reply.state.queryPreferences?.[section],original.queryPreferences?.[section]);
  assert.deepEqual(reply.state.categoryConstraints[section],original.categoryConstraints[section]);
 }
 assert.equal(reply.state.outingActivities,undefined);
});
test("preservation handles common wordings and leaves positive requests actionable",()=>{
 for(const text of ["Find cheaper dinner. Don't change music or movies.","Keep music unchanged, find dinner.","Find Indian food without changing my music and movies."]) {
  const parsed=interpret(text,"London");assert.deepEqual(parsed.sections,["Eat"]);
 }
});

test("cinema recovery preserves the existing dinner and cinema order",async()=>{
 const original=state();original.outingActivities=["Eat","Cinema"];
 const reply=await runTurn(original,{message:"Find local cinemas for this outing. Keep my dining, coffee, music and movies unchanged."},{tools:async()=>[],workflow:async()=>({status:"ok",results:[]}),discover:async(_s,section)=>[{id:"cinema",name:"Fixture cinema",section,types:["urn:entity:place"],detail:""}]});
 assert.deepEqual(reply.changed,["Culture"]);
 assert.deepEqual(reply.state.outingActivities,["Eat","Cinema"]);
 assert.deepEqual(reply.state.cards.filter(c=>c.section!=="Culture"),original.cards);
});

test("tool-catalog failure does not incorrectly mark a working model unavailable",async()=>{
 const original=state();
 const message="Find museums. Keep my music unchanged.";
 const reply=await runTurn(original,{message},{provider:{interpret:async()=>({...interpret(message),concepts:["museum"]}),choose:async()=>{throw Error("must not choose without tools");}},tools:async()=>{throw Error("Fixture MCP outage");},workflow:async()=>({status:"ok",results:[{id:"urn:tag:genre:place:museum",name:"Museum",type:"urn:tag:genre:place"}]}),discover:async(_s,section)=>[{id:"new",name:"Museum",section,types:["urn:entity:place"],detail:""}]});
 assert.deepEqual(reply.changed,["Culture"]);
 assert.equal(reply.state.providerHealth,"healthy");
 // No taxonomy tool is needed for the generic venue request, so don't
 // falsely report a provider or catalog outage.
 assert.doesNotMatch(reply.message,/tool connection is unavailable/);
 assert.doesNotMatch(reply.message,/Taste Concierge is temporarily unavailable/);
});
test("a pending confirmation from an older session still honors protected sections",async()=>{
 const original=state();const quiet=original.tags.find(tag=>tag.name==="Quiet")!;
 original.pending={query:"quiet",candidates:[quiet],request,sections:["Eat","Music","Movies"],conceptSections:["Eat","Music"],constraints:["crowded"]};
 const called:string[]=[];
 const reply=await runTurn(original,{tagChoice:quiet.id},{tools:async()=>[],workflow:async()=>({status:"ok",results:[]}),discover:async(_s,section)=>{called.push(section);return [{id:"new",name:"Dining",section,types:["urn:entity:place"],detail:""}];}});
 assert.deepEqual(called,["Eat"]);
 assert.deepEqual(reply.state.categoryTags?.Music,original.categoryTags?.Music);
 assert.deepEqual(reply.state.cards.filter(c=>c.section!=="Eat"),original.cards);
});
test("outing choices favor a closer known venue while retaining unknown locations",()=>{
 const card=(id:string,latitude?:number,longitude?:number)=>({id,name:id,section:"Eat",types:["urn:entity:place"],detail:"",intelligence:{location:{latitude,longitude}}} as Card);
 const anchor=card("anchor",51.5,-.1),far=card("far",51.3,.2),near=card("near",51.501,-.101),unknown=card("unknown");
 assert.deepEqual(nearbyOutingOptions([far,unknown,near],anchor).map(c=>c.id),["near","far","unknown"]);
 assert.deepEqual(nearbyOutingOptions([far,unknown,near]).map(c=>c.id),["far","unknown","near"]);
});

test("a known quietness lookup does not require another model planning call",async()=>{
 const original=state();original.tags=original.tags.filter(tag=>tag.name!=="Quiet");original.categoryTags!.Eat=[cuisine.id];
 let planned=0;
 const reply=await runTurn(original,{message:request},{provider:{interpret:async()=>interpret(request),choose:async()=>{planned++;throw Error("unnecessary planning");}},tools:async()=>[],workflow:async(_mode,_name,args)=>{assert.equal(args.query,"quiet atmosphere");return {status:"ok",results:[{id:"urn:tag:ambience:place:quiet",name:"Quiet",type:"urn:tag:ambience:place"}]};},discover:async(_s,section)=>[{id:"new",name:"Dining",section,types:["urn:entity:place"],detail:""}]});
 assert.equal(planned,0);assert.deepEqual(reply.changed,["Eat"]);assert.equal(reply.state.providerHealth,"healthy");
});

test("vegetarian options resolve without homonym confirmation and retain cuisine and other categories",async()=>{
 for(const native of [false,true]) {
  const original=state();original.city="Toronto";
  const message="Find cheaper vegetarian Indian food in Toronto and explain why it fits my tastes.";
  const diet="urn:tag:dietary_option:qloo:vegetarian";
  let planned=0;
  const deps:AgentDependencies={tools:async()=>[],workflow:async()=>({status:"ok",results:[
   {id:"urn:tag:target_audience:qloo:vegetarian",name:"Vegetarian"},
   {id:"urn:tag:cuisine:qloo:vegetarian",name:"Vegetarian"},
   {id:diet,name:"Vegetarian"},
  ]}),discover:async(s,section)=>{
   assert.equal(section,"Eat");assert.ok(s.categoryTags!.Eat!.includes(cuisine.id));assert.ok(s.categoryTags!.Eat!.includes(diet));assert.equal(s.queryPreferences!.Eat!.priceMax,2);
   return [{id:"eligible",name:"Dining",section,types:["urn:entity:place"],detail:""}];
  }};
  if(native)deps.provider={interpret:async()=>interpret(message),choose:async()=>{planned++;return [];}};
  const reply=await runTurn(original,{message},deps);
  assert.equal(planned,0);assert.equal(reply.state.pending,undefined);assert.deepEqual(reply.changed,["Eat"]);
  assert.deepEqual(reply.state.cards.filter(c=>c.section!=="Eat"),original.cards);
 }
});

test("missing dietary-option evidence preserves results instead of silently relaxing it",async()=>{
 const original=state();
 const reply=await runTurn(original,{message:"Find vegetarian Indian food"},{tools:async()=>[],workflow:async()=>({status:"ok",results:[{id:"urn:tag:target_audience:qloo:vegetarian",name:"Vegetarian"}]}),discover:async()=>{throw Error("must not discover without verified diet");}});
 assert.deepEqual(reply.state.cards,original.cards);assert.deepEqual(reply.changed,[]);assert.match(reply.message,/could not verify vegetarian/i);
});
