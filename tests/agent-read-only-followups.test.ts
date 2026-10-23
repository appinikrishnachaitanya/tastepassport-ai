import test from "node:test";
import assert from "node:assert/strict";
import { isReadOnlyFollowUp, readOnlyFollowUp } from "../src/agent/read-only.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
import type { AgentState } from "../src/agent/types.ts";
import type { Card } from "../src/passport/model.ts";

const card=(id:string,name:string,section:"Eat"|"Culture",rating?:number,price?:number):Card=>({
 id,name,section,detail:"",types:["urn:entity:place"],address:`${name} London`,
 intelligence:{quality:{businessRating:rating},commercial:{priceLevel:price}}
} as Card);
const fixture=():AgentState=>normalizeSession({
 id:"sample-session",revision:3,expires:Date.now()+60000,city:"London",selected:[],tags:[],constraints:[],
 categoryConstraints:{},notices:[],previous:[],feedback:[],
 cards:[card("eat-a","Kahani","Eat",4.59,3),card("eat-b","Black Salt Sheen","Eat",4.59,2),
        card("cul-a","Rivoli Ballroom","Culture",4.69,1),card("cul-b","Venue MOT Unit 18","Culture",4.3,2)],
 history:[{role:"agent",text:"Here are your 2 current culture suggestions in London:\n1. Rivoli Ballroom\n2. Venue MOT Unit 18"}],
 intent:{kind:"refine",strategy:"discover",sections:["Culture"],seeds:[],concepts:[],constraints:[]},
 queryPreferences:{Eat:{priceMax:3},Culture:{priceMax:2}}
});
const forbidden={
 tools:async()=>{throw Error("Qloo should not be called for read-only question");},
 workflow:async()=>{throw Error("MCP should not be called for read-only question");},
 discover:async()=>{throw Error("Refinement should not run for read-only question");},
 provider:{interpret:async()=>{throw Error("Gemini should not be called for read-only question");},choose:async()=>[]}
};
test("multi-turn ordinal references and comparisons never modify existing cards or filters",async()=>{
 const queries: Array<[string,RegExp]> = [
 ["Why did you recommend this?",/Which culture result do you mean|Rivoli Ballroom/],
 ["What about the second one?",/Venue MOT Unit 18/],
 ["Compare the first two venues and help me choose",/Rivoli Ballroom[\s\S]*Venue MOT Unit 18/],
 ["What rating is the second restaurant?",/Black Salt Sheen has a Qloo-reported business rating of 4.59\/5/],
 ["How much is the second venue?",/Moderate \(2\/4\)/],
 ];
 for(const [message,pattern] of queries){
  const before=fixture();const output=await runTurn(before,{message},forbidden);
  assert.deepEqual(output.changed,[],message);
  assert.deepEqual(output.state.cards,before.cards,message);
  assert.deepEqual(output.state.queryPreferences,before.queryPreferences,message);
  assert.match(output.message,pattern as RegExp,message);
  assert.equal(output.mode,"deterministic");
 }
});
test("read-only questions exclude explicit fresh-search and mutate instructions",()=>{
 for(const q of ["What rating is the second restaurant?","Why did you recommend this?","What about the second one?","Compare the first two","How much is the second venue?"])assert.equal(isReadOnlyFollowUp(q),true,q);
 for(const q of ["Find Indian restaurants","Make the second one cheaper","Show me more dining","Find me hidden gems","Update Coffee","Can you find cinema"])assert.equal(isReadOnlyFollowUp(q),false,q);
});
test("read-only comparison does not invent price or rating when metadata is missing",()=>{
 const x=fixture();x.cards[2].intelligence=undefined;
 const out=readOnlyFollowUp(x,"compare the first two venues");
 assert.match(out,/Business rating unavailable/);
 assert.match(out,/Price category unavailable/);
 assert.match(out,/don't establish a clear winner/);
});
