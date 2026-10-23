import { groundedModelIntent } from "../src/agent/conversation-grounding.ts";
import { interpret } from "../src/agent/intent.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
import { categoryLanguage } from "../src/agent/category-language.ts";
import { chatShortlist, chatReason, isShortlistRequest, requestedShortlistSections } from "../src/agent/chat-shortlist.ts";
import { isListRequest } from "../src/agent/answers.ts";
import { activeCategories } from "../src/passport/active-categories.ts";
import { reviewMatch, reviewMatches } from "../src/passport/matching.ts";
import { themeCategories, curatedThemes } from "../src/passport/taste-themes.ts";
import type { Card, Candidate } from "../src/passport/model.ts";

const card=(id:string,section:Card['section']):Card=>({id,name:id,section,types:[],detail:""});
const state=()=>normalizeSession({id:"regression",revision:3,expires:Date.now()+60000,city:"London",selected:[],tags:[],constraints:[],categoryConstraints:{},cards:[card("Returned dining","Eat"),card("Returned coffee","Coffee"),card("Returned artist","Music")],previous:[],feedback:[],notices:[],activeCategories:["Eat","Coffee","Music"],intent:{kind:"refine",sections:["Music"],seeds:[],concepts:[],constraints:[],strategy:"discover"}});
const forbidden={tools:async()=>{throw Error("Unexpected tools");},workflow:async()=>{throw Error("Unexpected MCP");},discover:async()=>{throw Error("Unexpected discovery");},provider:{interpret:async()=>{throw Error("Unexpected model");},choose:async()=>[]}};
test("yi preserves context; an explicit restaurant list overrides earlier Music without calling Gemini",async()=>{
 const initial=state();
 const typo=await runTurn(initial,{message:"yi"},forbidden);
 assert.deepEqual(typo.changed,[]);
 assert.deepEqual(typo.state.intent,initial.intent);
 assert.deepEqual(typo.state.cards,initial.cards);
 assert.match(typo.message,/didn’t catch/);
 for(const message of ["list restaurants","list restuarants","list resatureants"]){
  const output=await runTurn(typo.state,{message},forbidden);
  assert.deepEqual(output.changed,[]);
  assert.match(output.message,/Returned dining/);
  assert.doesNotMatch(output.message,/Returned artist/);
 }
});
test("bounded spelling correction never rewrites cultural names or treats constraints as an existing list",()=>{
 assert.equal(categoryLanguage("Interstellar A.R. Rahman"),"Interstellar A.R. Rahman");
 for(const q of ["list Indian restaurants","list cheaper restaurants","list vegetarian restaurants","list restaurants without chains","show three Indian restaurants","recommend three Indian restaurants"]){
  assert.equal(isListRequest(q),false,q);
  assert.equal(isShortlistRequest(q),false,q);
 }
});
test("a three-choice shortlist is diverse, read-only and supports exact ordinal follow-ups",async()=>{
 const initial=state();
 const result=await runTurn(initial,{message:"Pick three things across my interests"},forbidden);
 assert.deepEqual(result.changed,[]);
 assert.deepEqual(result.state.cards,initial.cards);
 assert.deepEqual(result.state.history?.at(-1)?.recommendationIds,initial.cards.map(c=>c.id));
 assert.equal(chatShortlist(initial).length,3);
 assert.deepEqual(requestedShortlistSections("pick three bookstores"),["Lifestyle"]);
 assert.deepEqual(requestedShortlistSections("pick three restaurants"),["Eat"]);
 const followup=await runTurn(result.state,{message:"What about the second one?"},forbidden);
 assert.match(followup.message,/Returned coffee/);
 const stale={...result.state,cards:result.state.cards.slice(1)};
 const removed=await runTurn(stale,{message:"Compare the first two"},forbidden);
 assert.match(removed.message,/no longer/);
});
test("sparse evidence stays honest and current categories omit unrelated and hidden outputs",()=>{
 assert.match(chatReason(card("A","Eat")),/isn’t enough returned evidence/);
 assert.deepEqual(activeCategories({activeCategories:["Eat","Music"],hiddenCategories:["Music"]},[card("B","Coffee")]),["Eat","Coffee"]);
});
const candidate=(id:string,name:string,detail=""):Candidate=>({id,name,detail,types:[]});
test("review suggestions reduce clicks without resolving ambiguous names or fabricating a match",()=>{
 const indian=candidate("urn:tag:cuisine:qloo:indian","Indian");
 assert.equal(reviewMatch("Indian cuisine",[indian,candidate("movie","Indian")]),indian.id);
 assert.equal(reviewMatch("Interstellar",[candidate("film","Interstellar")]),"film");
 assert.equal(reviewMatch("Interstelar",[candidate("film","Interstellar")]),"film");
 assert.equal(reviewMatch("Dune",[candidate("old","Dune","1984"),candidate("new","Dune","2021")]),undefined);
 assert.equal(reviewMatch("Dune 2021",[candidate("old","Dune","1984"),candidate("new","Dune","2021")]),"new");
 assert.equal(reviewMatch("unknown",[candidate("film","Interstellar")]),undefined);
 assert.deepEqual(reviewMatches([{query:"Indian cuisine",candidates:[indian]},{query:"Indian cuisine",candidates:[indian]}]),{0:indian.id});
});
test("returned cuisine themes lead to Dining rather than movies and preview includes multiple families",()=>{
 const indian={id:"urn:tag:cuisine:qloo:indian",name:"Indian"};
 const italian={id:"urn:tag:cuisine:qloo:italian",name:"Italian"};
 const film={id:"urn:tag:genre:media:sci_fi",name:"Sci-fi"};
 assert.deepEqual(themeCategories(indian,["Movies","Eat"]),["Eat"]);
 assert.deepEqual(themeCategories(film,["Movies","Eat"]),["Movies"]);
 assert.deepEqual(curatedThemes([indian,italian,film],2).map(t=>t.id),[indian.id,film.id]);
});

test("keyboard noise never changes the Passport even when a model would guess categories",async()=>{
 const initial=state();
 const output=await runTurn(initial,{message:"sdflmmnsdfklsndflknsdfks"},forbidden);
 assert.deepEqual(output.changed,[]);
 assert.deepEqual(output.state.cards,initial.cards);
 assert.deepEqual(output.state.intent,initial.intent);
 assert.match(output.message,/didn’t catch/);
});
test("unrecognized text cannot authorize a model-invented broad refresh",async()=>{
 const initial=state();
 let called=false;
 const output=await runTurn(initial,{message:"asdfasdf qwertyuiop"},{...forbidden,provider:{
  interpret:async()=>{called=true;return {kind:"refine",sections:["Eat","Coffee","Culture"],seeds:[],concepts:[],constraints:["expensive"],query:{priceMax:2},strategy:"discover"};},choose:async()=>[]
 }});
 assert.equal(called,true);
 assert.deepEqual(output.changed,[]);
 assert.deepEqual(output.state.cards,initial.cards);
 assert.deepEqual(output.state.queryPreferences,initial.queryPreferences);
 assert.match(output.message,/didn't catch/);
});

 test("a conservative spelling correction can ground noodles without inventing a different concept",()=>{
 const explicit=interpret("i want to eat noddles man","London");
 const model={...explicit,concepts:["noodles"]};
 assert.ok(groundedModelIntent("i want to eat noddles man",model,explicit).concepts.includes("noodles"));
 assert.ok(!groundedModelIntent("i want to eat noddles man",{...model,concepts:["seafood"]},explicit).concepts.includes("seafood"));
 });

test("a cancelled chicken clarification cannot block a new peaceful-seating request",async()=>{
 const initial=state();
 const quiet={id:"urn:tag:ambience:place:quiet",name:"Quiet",types:["urn:tag"],detail:""};
 initial.tags=[quiet];initial.categoryTags={Eat:[quiet.id]};
 initial.intent!.sections=["Eat"];
 initial.pending={query:"chicken",request:"i want to eat chicken man",sections:["Eat"],constraints:[],candidates:[{id:"urn:tag:specialty_dish:qloo:chicken",name:"Chicken",types:["urn:tag"],detail:""}]};
 const output=await runTurn(initial,{message:"i don't need any chicken , all i want to sit peacefully man"},{...forbidden,provider:{
  interpret:async()=>({kind:"refine",sections:["Eat"],seeds:[],concepts:["chicken","quiet atmosphere"],constraints:["crowded"],strategy:"discover"}),choose:async()=>[]
 },discover:async(current,section)=>{assert.equal(current.pending,undefined);return [card("Quiet returned place",section)];}});
 assert.equal(output.state.pending,undefined);
 assert.deepEqual(output.changed,["Eat"]);
 assert.ok(!output.state.categoryTags?.Eat?.some(id=>/chicken/.test(id)));
 assert.ok(output.state.categoryConstraints.Eat?.includes("crowded"));
});
