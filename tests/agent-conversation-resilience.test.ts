import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { runTurn, type AgentDependencies } from "../src/agent/orchestrator.ts";
import { interpret } from "../src/agent/intent.ts";
import { isDiscoveryGoalConcept, groundedModelIntent, isGreetingOrTypo } from "../src/agent/conversation-grounding.ts";
import { tagCandidates } from "../src/agent/validation.ts";
import { ConnectionExplorer } from "../app/components/passport-overview.tsx";
import type { AgentState } from "../src/agent/types.ts";
import type { Card } from "../src/passport/model.ts";
import type { Passport } from "../src/workspace/state.ts";

function state(): AgentState {
 return {
   id:"test-session",revision:0,expires:Date.now()+120000,city:"London",
   selected:[{id:"film-1",name:"Interstellar",types:["urn:entity:movie"],detail:""}],
   tags:[],constraints:[],categoryConstraints:{},cards:[
     {id:"food-1",name:"Existing Indian restaurant",section:"Eat",types:["urn:entity:place"],detail:""}
   ],previous:[],feedback:[],notices:[],
   pending:{query:"hidden-gems",request:"find hidden gems",sections:["Eat"],
     constraints:[],candidates:Array.from({length:5},(_,i)=>({
       id:"urn:tag:genre:place:hidden_gem_"+i,name:"Hidden Gems",types:["urn:tag"],detail:""
     }))},
 };
}
const noCalls:AgentDependencies={
 tools:async()=>{throw Error("No taxonomy lookups necessary");},
 workflow:async()=>{throw Error("No workflow necessary");},
 discover:async()=>{throw Error("No discovery necessary");},
};
test("Hj, Hi, Helli and Hello ignore an abandoned hidden-gems choice",async()=>{
 for(const msg of ["Hj","Hi","Helli","Hello","Hello bro"]) {
   assert.equal(isGreetingOrTypo(msg),true,msg);
   const reply=await runTurn(state(),{message:msg},noCalls);
   assert.equal(reply.state.pending,undefined,msg);
   assert.match(reply.message,/Hi! What would you like to explore in London/);
   assert.deepEqual(reply.changed,[]);
   assert.equal(reply.state.cards[0].name,"Existing Indian restaurant");
 }
});
test("cancel a stale taxonomy prompt safely without changing recommendations",async()=>{
 for(const msg of ["cancel","Skip this concept","never mind"]) {
   const reply=await runTurn(state(),{message:msg},noCalls);
   assert.equal(reply.state.pending,undefined,msg);
   assert.match(reply.message,/skipped that concept choice/);
   assert.deepEqual(reply.changed,[]);
   assert.equal(reply.state.cards.length,1);
 }
});
test("model hallucinated hidden-gems search concept cannot block nightclub discovery",async()=>{
 const baseline=state();let category="";
 const deps:AgentDependencies={
   ...noCalls,
   provider:{
     interpret:async()=>({
       kind:"refine",seeds:[],concepts:["hidden-gems"],constraints:[],
       sections:["Eat"],strategy:"discover",query:{goal:"hidden-gems"}
     }),
     choose:async()=>{throw Error("No taxonomy search for goal strings");}
   },
   discover:async(_state,section)=>{
     category=section;
     return [{id:"nightlife-1",name:"Returned nightclub",section,types:["urn:entity:place"],detail:""}];
   }
 };
 const reply=await runTurn(baseline,{message:"I want to go to night party"},deps);
 assert.equal(category,"Culture");
 assert.equal(reply.state.pending,undefined);
 assert.deepEqual(reply.changed,["Culture"]);
 assert.equal(reply.state.cards.find(c=>c.section==="Eat")?.name,"Existing Indian restaurant");
 assert.match(reply.message,/Returned nightclub/);
 assert.doesNotMatch(reply.message,/Choose the concept/i);
});
test("a discovery goal is never interpreted as a cultural tag to disambiguate",()=>{
 for(const name of ["hidden-gems","Hidden Gem","trending","safe bets","surprise me"])
   assert.equal(isDiscoveryGoalConcept(name),true,name);
 const request="Find hidden gems in dining";
 const explicit=interpret(request,"London");
 const model={...explicit,concepts:["hidden-gems","trending","unrelated gourmet label"],query:{goal:"hidden-gems" as const}};
 const grounded=groundedModelIntent(request,model,explicit);
 assert.deepEqual(grounded.concepts,[]);
 assert.equal(grounded.query?.goal,"hidden-gems");
});
test("duplicate Qloo display labels collapse to one meaningful tag and prefer place taxonomy",()=>{
 const results=tagCandidates({status:"ok",results:[
   {id:"urn:tag:genre:qloo:hidden_gems",name:"Hidden Gems",type:"urn:tag:genre"},
   {id:"urn:tag:genre:place:hidden_gems",name:"Hidden Gems",type:"urn:tag:genre:place"},
   {id:"urn:tag:genre:place:hidden_gem",name:"Hidden Gem",type:"urn:tag:genre:place"},
   {id:"urn:tag:genre:place:nightclubs",name:"Nightclubs",type:"urn:tag:genre:place"}
 ]},"nightlife");
 assert.equal(results.length,2);
 assert.match(results[0].id,/:place:/);
 assert.equal(results[1].name,"Nightclubs");
});
test("list Shows is a read-only chat action, without reopening an old prompt",async()=>{
 const s=state();
 s.cards.push({id:"show-1",name:"Star Trek: Picard",section:"Shows",types:["urn:entity:tv_show"],detail:""});
 const reply=await runTurn(s,{message:"List my current shows suggestions here"},noCalls);
 assert.equal(reply.state.pending,undefined);
 assert.deepEqual(reply.changed,[]);
 assert.match(reply.message,/Star Trek: Picard/);
 assert.doesNotMatch(reply.message,/Existing Indian restaurant/);
});
test("taste connections hide confusing generic tag chips and expose useful chat actions",()=>{
 const s=state();
 const card:Card={
   id:"show-1",name:"Star Trek: Picard",section:"Shows",types:["urn:entity:tv_show"],detail:"",
   evidence:{
     source:"Qloo",operation:"/v2/insights/",queryId:"evidence-1",recordedAt:"2026-10-20T00:00:00.000Z",
     destination:"London",locality:"audience-context",mode:"familiar",pool:"direct",
     inputs:[{id:"film-1",name:"Interstellar",role:"entity-signal",types:["urn:entity:movie"]}],
     params:{},result:{id:"show-1",type:"urn:entity:tv_show",
       tags:[{id:"urn:tag:genre:qloo:veteran_quiet",name:"Veteran quiet"},
       {id:"urn:tag:genre:qloo:sci_fi",name:"Sci fi"}]}
   }
 };
 const passport={...s,cards:[card]} as unknown as Passport;
 const html=renderToStaticMarkup(createElement(ConnectionExplorer,{passport,onAsk:()=>{},onExplore:()=>{}}));
 assert.match(html,/Star Trek: Picard/);
 assert.match(html,/Cultural suggestions, not local events/);
 assert.match(html,/Ask concierge about this/);
 assert.doesNotMatch(html,/List these in chat/);
 assert.match(html,/Why did this appear\?/);
 for(const term of ["Close to home","Veteran quiet","Matched together","City audience tastes"]) assert.ok(!html.includes(term),term);
});
