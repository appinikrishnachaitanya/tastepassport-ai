import test from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
import { isListRequest, listPassportResults } from "../src/agent/answers.ts";
import type { AgentState } from "../src/agent/types.ts";
import type { Card } from "../src/passport/model.ts";

const venue=(i:number,section:"Eat"|"Coffee"="Eat"):Card=>({
 id:"returned-"+i,name:"Returned venue "+i,section,
 types:["urn:entity:place"],detail:"",address:"Venue "+i+" Road",
 intelligence:{quality:{businessRating:i===2?4.96:undefined}},
} as Card);
function fixture():AgentState {
 return normalizeSession({
  id:"fixture-session",revision:3,expires:Date.now()+90_000,city:"London",
  selected:[{id:"one",name:"Indian cuisine",detail:"",types:["urn:tag"]}],
  tags:[],constraints:[],categoryConstraints:{},
  cards:[...Array.from({length:18},(_,i)=>venue(i+1)),venue(19,"Coffee")],
  previous:[],feedback:[],notices:[],
  intent:{kind:"refine",sections:["Eat"],seeds:[],concepts:["Indian cuisine"],constraints:[],strategy:"discover"},
 });
}
test("user can list all 18 returned Dining venues in chat without a model or API lookup",async()=>{
 let apiCalls=0;
 const original=fixture();
 const result=await runTurn(original,{message:"List here"},{
  tools:async()=>{apiCalls++;throw Error("not expected");},
  workflow:async()=>{apiCalls++;throw Error("not expected");},
  discover:async()=>{apiCalls++;throw Error("not expected");},
  provider:{interpret:async()=>{apiCalls++;throw Error("not expected");},choose:async()=>[]}
 });
 assert.equal(apiCalls,0);
 assert.deepEqual(result.changed,[]);
 assert.equal(result.mode,"deterministic");
 assert.match(result.message,/18 current food suggestions/);
 assert.match(result.message,/1\. Returned venue 1/);
 assert.match(result.message,/18\. Returned venue 18/);
 assert.doesNotMatch(result.message,/Returned venue 19/);
 assert.match(result.message,/4\.96\/5/);
 assert.equal(result.state.cards.length,19);
 assert.deepEqual(result.state.cards,original.cards);
 assert.deepEqual(result.state.queryPreferences,original.queryPreferences);
 assert.equal(result.state.revision,original.revision);
});
test("read-only list requests differ from a fresh Indian restaurant search",()=>{
 for(const message of ["list here","list the restaurants here","show me those suggestions here","what did you find?","list coffee"]) {
   assert.equal(isListRequest(message),true,message);
 }
 for(const message of ["show me Indian restaurants","find Indian restaurants","list new restaurants","give me more restaurants","show me new cafes"]) {
   assert.equal(isListRequest(message),false,message);
 }
});
test("asking to list Coffee only includes Coffee and preserves other categories",()=>{
 const state=fixture();
 const output=listPassportResults(state,"list coffee");
 assert.match(output,/Returned venue 19/);
 assert.doesNotMatch(output,/Returned venue 1 \(/);
});

test("a refinement reply previews returned venues instead of only saying suggestions were updated",async()=>{
 const original=fixture();
 original.queryPreferences={Eat:{priceMax:3}};
 const result=await runTurn(original,{message:"cheaper"},{
   tools:async()=>[],
   workflow:async()=>({status:"ok",results:[]}),
   discover:async(_state,section)=>[
     {id:"real-result-1",name:"Verified Indian Venue",types:["urn:entity:place"],detail:"",section,address:"London street"},
     {id:"real-result-2",name:"Second Indian Venue",types:["urn:entity:place"],detail:"",section},
   ],
 });
 assert.deepEqual(result.changed,["Eat"]);
 assert.match(result.message,/Verified Indian Venue/);
 assert.match(result.message,/Second Indian Venue/);
 assert.match(result.message,/list them here/);
 assert.doesNotMatch(result.message,/Returned venue 19/);
});
