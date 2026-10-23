import test from "node:test";
import assert from "node:assert/strict";
import { decisionSummary } from "../src/agent/decision-summary.ts";
import { recommendationSummary, screenTasteConnection } from "../src/qloo/explanation.ts";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
import type { Card } from "../src/passport/model.ts";
import type { AgentState } from "../src/agent/types.ts";
const dining=(id:string,name:string,level?:number)=>({id,name,section:"Eat",types:["urn:entity:place"],detail:"",intelligence:{commercial:{priceLevel:level}}} as Card);
function state(cards:Card[],cap?:number):AgentState {
 const tag={id:"urn:tag:cuisine:qloo:indian",name:"Indian",types:["urn:tag:cuisine:qloo"],detail:""};
 return normalizeSession({id:"summary",revision:0,expires:Date.now()+60000,city:"Toronto",selected:[tag],tags:[tag],categoryTags:{Eat:[tag.id]},constraints:[],categoryConstraints:{},queryPreferences:{Eat:cap===undefined?{}:{priceMax:cap}},cards,previous:[],feedback:[],notices:[],intent:{kind:"refine",sections:["Eat"],seeds:[],concepts:[],constraints:[],strategy:"discover"}});
}
test("budget receipt reports actual cap change, retained cuisine and a verified lower-priced listing pair",()=>{
 const before=state([dining("old","Before restaurant",3)],3),after=state([dining("new","After restaurant",1)],2);
 const snapshots=JSON.stringify([before,after]);const text=decisionSummary(before,after,["Eat"]);
 assert.match(text,/3\/4 → 2\/4/);assert.match(text,/before: Before restaurant \(3\/4\); now: After restaurant \(1\/4\)/);assert.match(text,/Kept: Indian/);assert.match(text,/relative/);assert.equal(JSON.stringify([before,after]),snapshots);
});
for(const levels of [[undefined,1],[2,2],[1,2]] as const)test(`no invented savings for metadata ${levels}`,()=>{
 const text=decisionSummary(state([dining("old","Before",levels[0])],3),state([dining("new","After",levels[1])],2),["Eat"]);
 assert.match(text,/could not be verified/);assert.doesNotMatch(text,/Listing example/);
});
test("the same listing cannot be presented as a replacement at a lower price",()=>{
 const text=decisionSummary(state([dining("same","Same listing",3)],3),state([dining("same","Same listing",1)],2),["Eat"]);
 assert.doesNotMatch(text,/Listing example/);
});
test("successful agent replies include the decision receipt",async()=>{
 const reply=await runTurn(state([dining("old","Old listing",3)],3),{message:"cheaper"},{tools:async()=>[],workflow:async()=>({status:"ok",results:[]}),discover:async()=>[dining("new","New listing",1)]});
 assert.match(reply.message,/Updated Food suggestions/);assert.match(reply.message,/3\/4 → 2\/4/);assert.match(reply.message,/Old listing/);assert.match(reply.message,/New listing/);
});
test("movie explanations distinguish contributing artist taste from unsupported film similarity",()=>{
 const card={section:"Movies",evidence:{inputs:[{id:"artist",name:"A.R. Rahman",role:"entity-signal"},{id:"film",name:"Interstellar",role:"entity-signal"}],result:{tags:[{id:"urn:tag:genre:media:drama",name:"Drama"}]}},intelligence:{taste:{contributingSignals:[{id:"film",contribution:0},{id:"artist",contribution:0.4}]}}} as unknown as Card;
 const text=recommendationSummary(card)!;
 assert.match(text,/Drama/);assert.match(text,/Audience-taste association with A.R. Rahman/);assert.match(text,/does not establish a shared story or genre/);assert.doesNotMatch(text,/Interstellar/);
});
test("screen results without individual contributions disclose collective evidence",()=>{
 const card={section:"Movies",evidence:{inputs:[{id:"film",name:"Interstellar",role:"entity-signal"}],result:{tags:[]}}} as unknown as Card;
 assert.match(screenTasteConnection(card)!,/no individual supporting interest/i);
});
