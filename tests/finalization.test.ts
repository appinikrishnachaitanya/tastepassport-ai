import test from "node:test";
import assert from "node:assert/strict";
import { suggestedMatch, suggestedMatches } from "../src/passport/matching.ts";
import { threeChoices } from "../src/passport/shortlist.ts";
import { evidenceFacts } from "../src/qloo/explanation.ts";
import { supportedCity, destinations } from "../src/workspace/state.ts";
import { activityMatches } from "../src/passport/day-out.ts";
import type { Card, Candidate } from "../src/passport/model.ts";
const candidate = (id: string, name: string): Candidate => ({ id,name,types:["urn:entity:movie"],detail:"" });
function card(id: string, affinity?: number, price?: number, pool: "direct" | "adjacent" = "direct"): Card {
  return { ...candidate(id,id),section:"Eat",intelligence:{id,name:id,type:"urn:entity:place",taste:{contributingSignals:[]},quality:{},commercial:{priceLevel:price},externalProof:{},location:{}}, evidence:{source:"Qloo",operation:"/v2/insights/",queryId:"test",recordedAt:"2026-10-18",destination:"London",locality:"physical-city",mode:"balanced",pool,inputs:[],params:{},result:{id,type:"urn:entity:place",tags:[],...(affinity === undefined ? {} : {affinity:{field:"query.affinity",value:affinity}})}} };
}
test("unique exact entity is suggested; editions, partial names and tags remain reviewable",()=>{
  assert.equal(suggestedMatch("Interstellar",[candidate("one","Interstellar"),candidate("two","Other film")]),"one");
  assert.equal(suggestedMatch("Crash",[candidate("one","Crash"),candidate("two","Crash")]),undefined);
  assert.equal(suggestedMatch("Rahman",[candidate("one","A.R. Rahman")]),undefined);
  assert.equal(suggestedMatch("Indian",[candidate("urn:tag:cuisine:place:indian","Indian")]),undefined);
  assert.deepEqual(suggestedMatches([{query:"Interstellar",candidates:[candidate("one","Interstellar")]},{query:"Interstellar",candidates:[candidate("one","Interstellar")]}]),{0:"one"});
});
test("three choices are unique and label only returned relative evidence",()=>{
  const result=threeChoices([card("taste",.9,4),card("budget",.6,1),card("explore",.7,3,"adjacent"),card("other",.5,2)]);
  assert.deepEqual(result.map(c=>c.card.id),["taste","budget","explore"]);
  assert.deepEqual(result.map(c=>c.label),["Start here","Lower-price option","Explore a little"]);
  assert.equal(new Set(result.map(c=>c.card.id)).size,3);
});
test("missing price and broader-pool evidence do not produce budget or adventure claims",()=>{
  const result=threeChoices([card("a"),card("b"),card("c")]);
  assert.deepEqual(result.map(c=>c.label),["Start here","Another option","Another option"]);
  assert.equal(threeChoices([]).length,0);
});
test("explanations distinguish matching returned tags from input-only signal use",()=>{
  const value=card("place");
  value.address="Fixture street";
  value.evidence!.inputs=[{id:"urn:tag:cuisine:place:indian",name:"Indian",types:["urn:tag"],role:"tag-filter"}];
  value.evidence!.result.tags=[{id:"urn:tag:cuisine:place:indian",name:"Indian"}];
  const facts=evidenceFacts(value).join(" ");
  assert.match(facts,/returned tags include Indian/);
  assert.match(facts,/Fixture street/);
  assert.doesNotMatch(facts,/helped shape/);
});
test("supported destination selector canonicalizes only configured cities",()=>{
  assert.equal(destinations.length,10);
  assert.equal(supportedCity("Bangalore, India"),"Bengaluru");
  assert.equal(supportedCity("NYC"),"New York City");
  assert.equal(supportedCity("Imaginary city"),undefined);
});
test("cinema and nightlife choices require their own returned venue tags",()=>{
  const value=card("cinema");value.section="Culture";value.name="ODEON Cinema";value.address="22 Leicester Square, London";
  value.evidence!.result.tags=[{id:"urn:tag:category:place:movie_theater",name:"Movie theater"}];
  assert.equal(activityMatches(value,"Cinema"),true);
  assert.equal(activityMatches(value,"Nightlife"),false);
});
