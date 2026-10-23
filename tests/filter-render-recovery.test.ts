import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ResultMetrics,WhyEvidence } from "../app/components/intelligence-evidence.tsx";
import { DiscoveryCard,PassportSections } from "../app/components/passport.tsx";
import { evidenceFacts,recommendationSummary } from "../src/qloo/explanation.ts";
import { threeChoices } from "../src/passport/shortlist.ts";
import { validatePreferences,preferenceParams } from "../src/qloo/query-plan.ts";
import type { Card } from "../src/passport/model.ts";
import type { Passport } from "../src/workspace/state.ts";

const sparse=(id:string,rating?:number):Card=>({
 id,name:`Returned restaurant ${id}`,types:["urn:entity:place"],detail:"",section:"Eat",
 intelligence: { id,name:`Returned restaurant ${id}`,type:"place",
  quality:rating===undefined?undefined:{businessRating:rating},
  taste:undefined,externalProof:undefined,commercial:undefined,location:undefined
 } as unknown as Card["intelligence"],
} as Card);
test("sparse Qloo metadata never throws during card or Passport rendering",()=>{
 const cards=[sparse("one"),sparse("two",4.5),sparse("three",4.6),sparse("four")];
 for(const card of cards){
   assert.doesNotThrow(()=>renderToStaticMarkup(createElement(ResultMetrics,{card})));
   assert.doesNotThrow(()=>renderToStaticMarkup(createElement(WhyEvidence,{card})));
   assert.doesNotThrow(()=>renderToStaticMarkup(createElement(DiscoveryCard,{card,feedback:undefined,onFeedback:()=>{}})));
   assert.doesNotThrow(()=>evidenceFacts(card));
   assert.doesNotThrow(()=>recommendationSummary(card));
 }
 assert.match(renderToStaticMarkup(createElement(ResultMetrics,{card:cards[0]})),/Rating unavailable/);
 assert.deepEqual(threeChoices(cards).map(c=>c.card.id).length,3);
 const passport={city:"London",selected:[],cards,notices:[],explanation:""} as Passport;
 assert.doesNotThrow(()=>renderToStaticMarkup(createElement(PassportSections,{result:passport,feedback:{},onFeedback:()=>{}})));
});
test("rating and price filters map to supported Qloo parameters without altering original preferences",()=>{
 const filter=validatePreferences({businessRatingMin:4.5,priceMax:2});
 const params=preferenceParams(filter);
 assert.equal(params["filter.properties.business_rating.min"],"4.5");
 assert.equal(params["filter.price_level.max"],"2");
 assert.deepEqual(filter,{businessRatingMin:4.5,priceMax:2});
});
test("changing budget is an edit, never an implicit network submission",()=>{
 const component=readFileSync(new URL("../app/components/intelligence.tsx",import.meta.url),"utf8");
 const start=component.indexOf('aria-label="Maximum price"');
 const end=component.indexOf('</select>',start);
 const budgetSelect=component.slice(start,end);
 assert.ok(start!==-1&&end>start);
 assert.match(budgetSelect,/setPrice\(value\)/);
 assert.doesNotMatch(budgetSelect,/onRefine\(/);
 assert.match(component,/Choose Update suggestions to apply it/);
});
