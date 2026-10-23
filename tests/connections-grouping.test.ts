import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bridgeRoutes, type QlooEvidence } from "../src/passport/evidence.ts";
import type { Candidate, Card, Section } from "../src/passport/model.ts";
import { ConnectionExplorer } from "../app/components/passport-overview.tsx";
import type { Passport } from "../src/workspace/state.ts";
const tastes: Candidate[] = [
 {id:"taste-artist",name:"A.R. Rahman",types:["urn:entity:artist"],detail:""},
 {id:"taste-film",name:"Interstellar",types:["urn:entity:movie"],detail:""},
 {id:"taste-coffee",name:"Specialty Coffee",types:["urn:tag:cuisine"],detail:""}
];
function card(section: Section, id: string, query: string, inputs: Candidate[], mode: QlooEvidence["mode"] = "balanced"): Card {
 return {
   section,id,name:section+" venue "+id,types:["urn:entity:place"],detail:"",address:"Test Road, London",
   evidence:{
     source:"Qloo",operation:"/v2/insights/",queryId:query,recordedAt:"2026-10-20T00:00:00Z",
     destination:"London",locality:"physical-city",mode,pool:"direct",
     inputs:inputs.map(i=>({id:i.id,name:i.name,types:i.types,role:"entity-signal"})),
     params:{},result:{id,type:"urn:entity:place",tags:[]}
   }
 };
}
const cards=[
 card("Eat","food-1","query-eat",tastes.slice(0,2)),
 card("Coffee","coffee-1","query-coffee-a",[tastes[2]],"familiar"),
 card("Coffee","coffee-2","query-coffee-b",[tastes[0]],"explore"),
 card("Coffee","coffee-3","query-coffee-b",[tastes[0]],"explore"),
 card("Culture","culture-1","query-culture",tastes.slice(0,2)),
 card("Lifestyle","shop-1","query-lifestyle-1",[tastes[0]]),
 card("Lifestyle","shop-2","query-lifestyle-2",[tastes[1]])
];
test("Taste Connections groups by category, not every Qloo query permutation",()=>{
 const routes=bridgeRoutes(cards,tastes);
 assert.deepEqual(routes.map(r=>r.section),["Eat","Coffee","Culture","Lifestyle"]);
 assert.equal(routes.find(r=>r.section==="Coffee")?.count,3);
 assert.equal(routes.find(r=>r.section==="Lifestyle")?.count,2);
 assert.equal(routes.find(r=>r.section==="Coffee")?.mode,"balanced");
 assert.deepEqual(routes.find(r=>r.section==="Coffee")?.inputs.map(i=>i.id),["taste-coffee","taste-artist"]);
 assert.equal(cards[1].evidence?.queryId,"query-coffee-a","card's original Qloo provenance is unchanged");
});
test("connection selector displays one Coffee and one Lifestyle category choice",()=>{
 const passport={city:"London",selected:tastes,cards,notices:[],explanation:""} as Passport;
 const html=renderToStaticMarkup(createElement(ConnectionExplorer,{passport}));
 const buttons=html.match(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>[^<]+<small>/g)??[];
 assert.equal(buttons.filter(v=>v.includes(">Coffee &amp; cafés<small>")).length,1);
 assert.equal(buttons.filter(v=>v.includes(">Lifestyle<small>")).length,1);
 assert.match(html,/3 discoveries/);
 assert.match(html,/Each category appears once/);
});
