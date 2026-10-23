import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { discoveryQueries, mixPools } from "../src/agent/strategy.ts";
import { sectionTypes, diversifyCards, type Card, type Section } from "../src/passport/model.ts";
import { normalizeSession } from "../src/agent/session.ts";
import { withEvidence } from "../src/passport/evidence.ts";
import { threeChoices } from "../src/passport/shortlist.ts";
const artist={id:"artist",name:"Artist",types:["urn:entity:artist"],detail:""};
const cuisine={id:"urn:tag:cuisine:qloo:indian",name:"Indian",types:["urn:tag"],detail:""};
function state(section: Section) {
 return normalizeSession({id:"ranking",revision:0,expires:Date.now()+60000,city:"Toronto",selected:[artist,{id:"anchor",name:"Anchor",types:[`urn:entity:${sectionTypes[section]}`],detail:""},cuisine],tags:[cuisine],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[]});
}
for(const section of ["Movies","Books","Shows","Podcasts","Games"] as const) test(`${section} familiar search anchors its own seed, while Explore retains cross-domain taste`,()=>{
 const original=state(section);
 const base={"filter.type":`urn:entity:${sectionTypes[section]}`,"signal.interests.entities":"artist,anchor","signal.interests.tags":cuisine.id,"filter.exclude.entities":"rejected","filter.rating.min":"4"};
 const [direct,adjacent]=discoveryQueries(base,original,section,"balanced");
 assert.equal(direct.params["signal.interests.entities"],"anchor");
 assert.equal(direct.params["signal.interests.tags"],undefined);
 assert.equal(adjacent.params["signal.interests.entities"],"artist,anchor");
 assert.equal(adjacent.params["signal.interests.tags"],undefined,"Food tags must not swamp broader content retrieval either");
 for(const query of [direct,adjacent]) {assert.equal(query.params["filter.exclude.entities"],"rejected");assert.equal(query.params["filter.rating.min"],"4");}
 assert.equal(base["signal.interests.entities"],"artist,anchor");
});
test("explicit content refinement survives same-domain routing",()=>{
 const current=state("Movies");current.categoryTags={Movies:["urn:tag:genre:media:thriller"]};
 const query=discoveryQueries({"filter.type":"urn:entity:movie","signal.interests.entities":"artist,anchor","signal.interests.tags":`${cuisine.id},urn:tag:genre:media:thriller`},current,"Movies","familiar")[0];
 assert.equal(query.params["signal.interests.tags"],"urn:tag:genre:media:thriller");
});
test("a selected media genre survives routing and a tag-only profile stays grounded",()=>{
 const current=state("Movies");
 const media="urn:tag:genre:media:sci_fi";
 const base={"filter.type":"urn:entity:movie","signal.interests.entities":"artist,anchor","signal.interests.tags":`${cuisine.id},${media}`};
 assert.equal(discoveryQueries(base,current,"Movies","familiar")[0].params["signal.interests.tags"],media);
 current.selected=[cuisine];current.tags=[cuisine];
 const queries=discoveryQueries({"filter.type":"urn:entity:movie","signal.interests.tags":cuisine.id},current,"Movies","balanced");
 assert.ok(queries.every(query=>query.params["signal.interests.tags"]===cuisine.id));
});
test("stored category requirements survive Explore even after another category's turn",()=>{
 const current=state("Movies");
 current.categoryConcepts={Eat:["Indian cuisine"]};
 current.intent={kind:"refine",sections:["Movies"],seeds:[],concepts:[],constraints:[],strategy:"discover"};
 const query=discoveryQueries({"filter.type":"urn:entity:place","signal.interests.entities":"artist","filter.tags":cuisine.id,"operator.filter.tags":"intersection"},current,"Eat","explore")[0];
 assert.equal(query.params["filter.tags"],cuisine.id);
 assert.equal(query.params["operator.filter.tags"],"intersection");
});
function card(id:string,pool:"direct"|"adjacent",affinity:number):Card {
 return withEvidence([{id,name:id,types:["urn:entity:movie"],section:"Movies",detail:""}],[{entity_id:id,name:id,types:["urn:entity:movie"],query:{affinity}}],{"filter.type":"urn:entity:movie","signal.interests.entities":"anchor"},[],"Toronto","balanced",pool)[0];
}
test("fusion preserves direct provenance, deduplicates and reserves broader discoveries without comparing affinity",()=>{
 const direct=Array.from({length:20},(_,i)=>card(`direct-${i}`,"direct",0.01));
 const adjacent=Array.from({length:20},(_,i)=>card(`adjacent-${i}`,"adjacent",0.99));
 adjacent.unshift({...direct[0],evidence:{...direct[0].evidence!,pool:"adjacent"}});
 const result=mixPools([direct,adjacent]);
 assert.equal(result.length,20);assert.equal(new Set(result.map(c=>c.id)).size,20);
 assert.equal(result[0].id,direct[0].id);assert.equal(result[0].evidence?.pool,"direct");
 assert.equal(result[0].evidence?.fusion?.sources.length,2);
 assert.equal(result.filter(c=>c.evidence?.pool==="adjacent").length,4);
 assert.equal(threeChoices(result)[0].card.id,direct[0].id);
 assert.ok(threeChoices(result).some(choice=>choice.card.evidence?.pool==="adjacent"));
 assert.equal(direct[0].evidence?.fusion,undefined,"Input evidence stays immutable");
});
test("a failed/empty pool leaves the surviving provider ranking intact",()=>{
 const adjacent=[card("a","adjacent",0.5),card("b","adjacent",0.6)];
 assert.deepEqual(mixPools([[],adjacent]),adjacent);
 assert.equal(threeChoices(adjacent)[0].card.id,"a");
});
test("multiple Explore activity pools preserve the fused leader without a Familiar quota",()=>{
 const first=[card("leading","adjacent",0.5),card("second","adjacent",0.4)];
 const result=mixPools([first,[card("other","adjacent",0.9)]]);
 assert.equal(result[0].id,"leading");
 assert.equal(result.length,3);
});
test("dining caps repeated business names without treating a shared cuisine word as a chain",()=>{
 const named=(id:string,name:string)=>({...card(id,"direct",0.5),name,section:"Eat" as const});
 const restaurants=[named("a","Piano Piano"),named("b","Piano Piano Restaurant"),named("c","Piano Piano"),named("d","Indian Street Food Co."),named("e","Indian Roti House"),named("f","Indian Spice Room")];
 assert.deepEqual(diversifyCards(restaurants,"Eat").map(card=>card.id),["a","b","d","e","f"]);
 assert.deepEqual(threeChoices(restaurants).map(choice=>choice.card.id),["a","d","e"]);
});
test("an explicit budget overrides the legacy cheap flag, including clearing to Any budget",()=>{
 const output=execFileSync(process.execPath,["--conditions=react-server","--import","tsx","--input-type=module","-e",`
 import assert from 'node:assert/strict';
 import { discoverSection } from './src/agent/runtime.ts';
 import { normalizeSession } from './src/agent/session.ts';
 process.env.QLOO_API_KEY='fixture-budget-override';process.env.LOG_LEVEL='error';
 const seed={id:'00000000-0000-4000-8000-000000000010',name:'Fixture artist',types:['urn:entity:artist'],detail:''};
 const entities=[3,undefined,1].map((price,index)=>({entity_id:'00000000-0000-4000-8000-00000000000'+index,name:'Venue '+index,type:'urn:entity:place',tags:[{id:'urn:tag:genre:place:restaurant',name:'Restaurant',type:'urn:tag:genre:place'}],properties:{geocode:{city:'Toronto'},...(price===undefined?{}:{price_level:price})}}));
 let sent;
 globalThis.fetch=async(url)=>{sent=new URL(url).searchParams;return Response.json({results:{entities}})};
 for(const cap of [undefined,3,4,"minimum"]) {
  const state=normalizeSession({id:'budget',revision:0,expires:Date.now()+60000,city:'Toronto',selected:[seed],tags:[],constraints:[],categoryConstraints:{},queryPreferences:{Eat:cap==="minimum"?{priceMin:3}:cap===undefined?{}:{priceMax:cap}},cards:[],previous:[],feedback:[],notices:[]});
  const cards=await discoverSection(state,'Eat',['expensive'],[],false);
  assert.equal(sent.get('filter.price_level.max'),cap===4||cap==='minimum'?null:String(cap ?? 2));
  assert.equal(cards.some(card=>card.id===entities[0].entity_id),cap!==undefined,'Price 3 should be allowed only after the explicit override');
  assert.equal(cards.some(card=>card.id===entities[1].entity_id),cap===4,'Unknown prices are allowed only without a numeric requirement');
  assert.equal(cards.some(card=>card.id===entities[2].entity_id),cap!=='minimum','A premium minimum must exclude lower-price listings');
 }
 console.log('Budget override PASS');
 `],{cwd:process.cwd(),encoding:"utf8",timeout:30000});
 assert.match(output,/Budget override PASS/);
});
test("splitting identical activity queries cannot multiply a retrieval family's influence",()=>{
 const direct=[card("direct","direct",0.1)];
 const adjacent=[card("adjacent","adjacent",0.9)];
 const baseline=mixPools([direct,adjacent]);
 const split=mixPools([direct,direct,adjacent]);
 assert.equal(split.find(c=>c.id==="direct")?.evidence?.fusion?.score,baseline.find(c=>c.id==="direct")?.evidence?.fusion?.score);
 assert.equal(split[0].id,"direct");
});
