import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runTurn, type AgentDependencies } from "../src/agent/orchestrator.ts";
import { normalizeSession, resetConversation } from "../src/agent/session.ts";
import { conversationContext, RECENT_CONTEXT_CHARACTERS, RECENT_CONTEXT_MESSAGES } from "../src/agent/context.ts";
import { compactConversationMemory, conversationSummary } from "../src/agent/memory.ts";
import { compactActiveSession, parseActiveSession } from "../src/agent/session-lifetime.ts";
import type { AgentState } from "../src/agent/types.ts";
const initial=()=>normalizeSession({id:randomUUID(),revision:0,expires:Date.now()+60000,city:"London",selected:[],tags:[],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[],activeCategories:["Eat","Culture"],queryPreferences:{Eat:{priceMax:3},Culture:{priceMax:3}}});
const forbidden=async():Promise<never>=>{throw Error("No external operation authorized");};
const noCalls:AgentDependencies={tools:forbidden,workflow:forbidden,discover:forbidden};
const discovery:AgentDependencies={...noCalls,discover:async(_state,section)=>[{id:randomUUID(),name:"Returned eligible venue",section,types:["urn:entity:place"],detail:""}]};
async function olderConversation(state:AgentState){
 for(let turn=0;turn<10;turn++) state=(await runTurn(state,{message:"Hi"},noCalls)).state;
 return normalizeSession(state);
}

test("validated decisions survive beyond the recent transcript and durable history window",async()=>{
 const first=await runTurn(initial(),{message:"Make food cheaper. Keep music unchanged."},discovery);
 const state=await olderConversation(first.state);
 const context=conversationContext(state);
 assert.ok(!context.history?.some(turn=>turn.text.includes("Make food cheaper")));
 assert.equal(context.summary?.lastSuccessfulTask?.request,"Make food cheaper. Keep music unchanged.");
 assert.deepEqual(context.summary?.lastSuccessfulTask?.sections,["Eat"]);
 assert.equal(context.categories?.find(category=>category.section==="Eat")?.preferences.priceMax,2);
 assert.deepEqual(context.summary?.lastPreservedSections,["Music"]);
 const persisted=JSON.parse(JSON.stringify(compactActiveSession({...state,history:[]})));
 const restored=parseActiveSession(persisted,state.id)!;
 assert.equal(conversationContext(restored).summary?.lastSuccessfulTask?.request,context.summary?.lastSuccessfulTask?.request);
});
test("failed retrieval is remembered as blocked, never as a successfully applied task",async()=>{
 const state=(await runTurn(initial(),{guided:{section:"Eat",constraints:[]}},discovery)).state;
 const originalTask=structuredClone(state.conversationMemory?.lastSuccessfulTask);
 const failed=await runTurn(state,{message:"Make Culture cheaper"},{...noCalls,discover:async()=>[]});
 assert.deepEqual(failed.changed,[]);
 assert.deepEqual(failed.state.conversationMemory?.lastSuccessfulTask,originalTask);
 assert.equal(conversationSummary(failed.state).lastAction?.outcome,"blocked");
 assert.ok(!conversationSummary(failed.state).recentChanges.some(change=>change.section==="Culture"));
});
test("dismissed clarifications survive compaction without becoming dietary exclusions",async()=>{
 const state=initial();state.pending={query:"chicken",sections:["Eat"],constraints:[],candidates:[{id:"urn:tag:specialty_dish:place:chicken",name:"Chicken",types:["urn:tag"],detail:""}]};
 const cancelled=await runTurn(state,{message:"Skip this concept"},noCalls);
 const later=await olderConversation(cancelled.state);
 assert.equal(later.pending,undefined);
 assert.equal(conversationSummary(later).dismissedClarifications[0]?.query,"chicken");
 assert.equal(later.queryPreferences?.Eat?.excludeTags,undefined);
 assert.deepEqual(later.categoryTags, state.categoryTags);
});
test("a selected result establishes focus for relative refinements despite an older category intent",async()=>{
 const state=initial();state.intent={kind:"refine",sections:["Eat"],seeds:[],concepts:[],constraints:[],strategy:"discover"};
 state.cards=[{id:"club",name:"Returned Club",section:"Culture",types:["urn:entity:place"],detail:""}];
 state.history=[{role:"agent",text:"Here is your Culture choice",recommendationIds:["club"]}];
 const chosen=await runTurn(state,{message:"Pick one from above"},noCalls);
 assert.deepEqual(chosen.state.conversationMemory?.focusSections,["Culture"]);
 let target="";
 const refined=await runTurn(chosen.state,{message:"Make it cheaper"},{...discovery,discover:async(current,section,...args)=>{target=section;return discovery.discover(current,section,...args);}});
 assert.equal(target,"Culture");assert.deepEqual(refined.changed,["Culture"]);
 assert.equal(refined.state.queryPreferences?.Eat?.priceMax,3);
});
test("displayed IDs remain usable for a choice after raw transcript eviction",async()=>{
 const state=initial();state.cards=[{id:"club",name:"Returned Club",section:"Culture",types:["urn:entity:place"],detail:""}];
 state.history=[{role:"agent",text:"Shown choice",recommendationIds:["club"]}];
 const chosen=await runTurn(state,{message:"Pick one from above"},noCalls);
 chosen.state.history=[];
 const pickedAgain=await runTurn(chosen.state,{message:"Pick one from above"},noCalls);
 assert.match(pickedAgain.message,/Returned Club/);
 assert.deepEqual(pickedAgain.changed,[]);
});
test("reset clears summary, focus, dismissals and displayed references",async()=>{
 const state=(await runTurn(initial(),{guided:{section:"Eat",constraints:[]}},discovery)).state;
 assert.ok(state.conversationMemory);
 const reset=resetConversation(state);
 assert.equal(reset.conversationMemory,undefined);
 const context=conversationContext(reset);
 assert.deepEqual(context.summary?.recentChanges,[]);assert.deepEqual(context.summary?.shownChoices,[]);
});
test("memory is bounded, whitelisted and excludes unsafe free text",()=>{
 const memory=compactConversationMemory({version:1,focusSections:["Eat","unsupported"],lastSuccessfulTask:{request:"contact me at private@example.com",sections:["Eat"]},recentChanges:Array.from({length:20},()=>({section:"Eat",resultCount:900})),dismissedConcepts:Array.from({length:20},(_,i)=>({query:`Cuisine ${i}`,sections:["Eat"]})),lastPresentedIds:Array.from({length:100},(_,i)=>`card-${i}`),lastPreservedSections:[],account:{email:"private@example.com"},secret:"private-token"})!;
 assert.deepEqual(memory.focusSections,["Eat"]);assert.equal(memory.lastSuccessfulTask?.request,undefined);
 assert.equal(memory.recentChanges.length,6);assert.equal(memory.dismissedConcepts.length,3);assert.equal(memory.lastPresentedIds?.length,40);
 assert.ok(!JSON.stringify(memory).includes("private"));
});
test("recent transcript uses complete messages within an explicit character budget",()=>{
 const state=initial();state.history=Array.from({length:20},(_,i)=>({role:i%2?"agent" as const:"user" as const,text:`${i} `+"word ".repeat(150)}));
 const context=conversationContext(state);
 assert.ok(context.history!.length<=RECENT_CONTEXT_MESSAGES);
 assert.ok(context.history!.reduce((count,message)=>count+message.text.length,0)<=RECENT_CONTEXT_CHARACTERS);
 assert.ok(context.history!.every(message=>/word$/.test(message.text)));
});
