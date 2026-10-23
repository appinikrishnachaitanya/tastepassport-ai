import test from "node:test";
import assert from "node:assert/strict";
import { runTurn, type AgentDependencies } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
import { isExistingChoiceRequest } from "../src/agent/existing-choice.ts";
import type { Card } from "../src/passport/model.ts";
import { withEvidence } from "../src/passport/evidence.ts";
const club=(id:string,name:string,genre:string,rating?:number):Card=>withEvidence(
 [{id,name,section:"Culture",types:["urn:entity:place"],detail:""}],
 [{entity_id:id,name,type:"urn:entity:place",tags:[{id:`urn:tag:genre:place:${genre.replace(/ /g,"_")}`,name:genre,type:"urn:tag:genre:place"}],properties:{business_rating:rating,geocode:{city:"London"}}}],
 {"filter.type":"urn:entity:place","filter.location.query":"London"},[],"London")[0];
function initial() {
 return normalizeSession({id:"choose-existing",revision:0,expires:Date.now()+60000,city:"London",selected:[],tags:[],constraints:[],categoryConstraints:{},previous:[],feedback:[],notices:[],
 cards:[club("museum","Returned museum","Museum",4.9),club("first-club","First returned club","Night club",4.2),club("second-club","Second returned club","Night club",4.7)],
 history:[{role:"agent",text:"Here are three choices",recommendationIds:["museum","first-club","second-club"]}],
 pending:{query:"night club",candidates:[{id:"urn:tag:genre:place:night_club",name:"Night club",types:["urn:tag"],detail:""}],sections:["Culture"],constraints:[]},
 queryPreferences:{Culture:{priceMax:2},Music:{goal:"discover"}},activeCategories:["Culture"]});
}
const unexpected=async():Promise<never>=>{throw Error("Choosing existing results must not call Gemini, Qloo or MCP");};
const noTools:AgentDependencies={tools:unexpected,workflow:unexpected,discover:unexpected,provider:{interpret:unexpected,choose:unexpected}};
for(const message of ["From the above pick one best night club","From the above pick one best night club for mr","Pick one nightclub for me","Which nightclub should I choose?","Which one is best from those nightclubs?"])test(message,async()=>{
 const state=initial();const result=await runTurn(state,{message},noTools);
 assert.deepEqual(result.changed,[]);
 assert.equal(result.execution?.route,"current-results");
 assert.equal(result.state.pending,undefined);
 assert.deepEqual(result.state.cards,state.cards);
 assert.deepEqual(result.state.queryPreferences,state.queryPreferences);
 assert.match(result.message,/My pick.*First returned club/);
 assert.doesNotMatch(result.message,/Choose the concept|Updated Culture/);
 assert.deepEqual(result.state.history.at(-1)?.recommendationIds,["first-club"]);
});
test("skip then choose does not reopen the taxonomy loop",async()=>{
 const skipped=await runTurn(initial(),{message:"Skip this concept"},noTools);
 const result=await runTurn(skipped.state,{message:"From the above pick one best night club for mr"},noTools);
 assert.equal(result.state.pending,undefined);assert.deepEqual(result.changed,[]);
 assert.match(result.message,/First returned club/);
});
test("selection is limited to the shown options, including references after a full textual list",async()=>{
 const state=initial();state.history=[{role:"agent",text:"Only this club was shown",recommendationIds:["second-club"]}];
 const result=await runTurn(state,{message:"from above pick one nightclub"},noTools);
 assert.deepEqual(result.state.history.at(-1)?.recommendationIds,["second-club"]);
 const list=await runTurn(initial(),{message:"list culture here"},noTools);
 assert.equal(list.state.history.at(-1)?.referenceIds?.length,3);
 const choice=await runTurn(list.state,{message:"pick one best night club from above"},noTools);
 assert.match(choice.message,/First returned club/);
});
test("a museum is not substituted when no shown nightclub has genre evidence",async()=>{
 const state=initial();state.history=[{role:"agent",text:"Museum choice",recommendationIds:["museum"]}];
 const result=await runTurn(state,{message:"pick one best nightclub from above"},noTools);
 assert.deepEqual(result.changed,[]);assert.equal(result.state.pending,undefined);
 assert.match(result.message,/don’t see a verified nightclub among the choices above/);
 assert.equal(result.execution?.phase,"needs-input");
});
test("highest-rated is an explicit criterion, while best retains the existing taste order",async()=>{
 const result=await runTurn(initial(),{message:"Pick one highest rated night club from above"},noTools);
 assert.deepEqual(result.state.history.at(-1)?.recommendationIds,["second-club"]);
 assert.match(result.message,/highest returned business rating.*4.69|highest returned business rating.*4.7/);
});
test("which has the highest rating selects the highest rated shown place",async()=>{
 const result=await runTurn(initial(),{message:"Which has the highest rating?"},noTools);
 assert.equal(result.execution?.route,"current-results");
 assert.deepEqual(result.state.history.at(-1)?.recommendationIds,["museum"]);
 assert.match(result.message,/Returned museum/);
 assert.match(result.message,/4\.9\/5/);
});
test("an implicit highest-rating follow-up compares the last displayed choices",async()=>{
 const state=initial();
 state.cards.push({...club("music","Another discovery","Museum",5),section:"Music"});
 state.history=[{role:"agent",text:"Two places to compare",recommendationIds:["first-club","second-club"]}];
 const result=await runTurn(state,{message:"Which has the highest rating?"},noTools);
 assert.deepEqual(result.state.history.at(-1)?.recommendationIds,["second-club"]);
 assert.match(result.message,/4\.7\/5/);
});
test("unknown or unverified requirements cannot be silently ignored",async()=>{
 for(const message of ["Pick one wheelchair accessible nightclub from above","Pick one nightclub with jazz from above"]){
 const result=await runTurn(initial(),{message},noTools);
 assert.deepEqual(result.changed,[]);
 assert.deepEqual(result.state.history.at(-1)?.recommendationIds,[]);
 assert.equal(result.execution?.phase,"needs-input");
 }
});
test("fresh discovery and mutation requests retain the tool route",()=>{
 for(const query of ["Find new nightclubs","Pick one new nightclub","Update Culture","Find different clubs instead"])
 assert.equal(isExistingChoiceRequest(query),false);
});
test("a named comparison scopes the choice without another lookup",async()=>{
 const result=await runTurn(initial(),{message:"Pick one between First returned club and Second returned club"},noTools);
 assert.deepEqual(result.state.history.at(-1)?.recommendationIds,["first-club"]);
});
test("a preservation clause is not treated as a new venue requirement",async()=>{
 const result=await runTurn(initial(),{message:"Pick one best night club from above. Keep music unchanged."},noTools);
 assert.deepEqual(result.state.history.at(-1)?.recommendationIds,["first-club"]);
 assert.deepEqual(result.state.queryPreferences?.Music,initial().queryPreferences?.Music);
});
test("asking why after a choice follows the selected venue rather than stale category context",async()=>{
 const state=initial();state.intent={kind:"refine",sections:["Eat"],seeds:[],concepts:[],constraints:[],strategy:"discover"};
 const chosen=await runTurn(state,{message:"From above pick one best nightclub"},noTools);
 const why=await runTurn(chosen.state,{message:"Why did you recommend First returned club?"},noTools);
 assert.match(why.message,/First returned club/);
 assert.doesNotMatch(why.message,/Which category|Which .*result do you mean/);
 assert.deepEqual(why.changed,[]);
});
