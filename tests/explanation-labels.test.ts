import test from "node:test";
import assert from "node:assert/strict";
import { displayTags, recommendationSummary, evidenceFacts } from "../src/qloo/explanation.ts";
import type { Card } from "../src/passport/model.ts";
test("customer explanations exclude narrative keywords and deduplicate useful labels",()=>{
 const tags=[{id:"urn:tag:genre:media:south_asian_cinema",name:"South Asian cinema"},{id:"urn:tag:keyword:media:punched_repeatedly",name:"Punched repeatedly"},{id:"urn:tag:genre:movie:south_asian_cinema",name:"South Asian cinema"}];
 assert.deepEqual(displayTags(tags).map(t=>t.name),["South Asian cinema"]);
 const card={section:"Movies",evidence:{params:{},inputs:[],result:{tags}}} as unknown as Card;
 assert.equal(recommendationSummary(card),"South Asian cinema");assert.doesNotMatch(evidenceFacts(card).join(" "),/punched/i);
});
test("dining summary prioritizes verified requirements over unrelated seed names",()=>{
 const tag={id:"urn:tag:dietary_option:qloo:vegetarian",name:"Vegetarian"};
 const card={section:"Eat",evidence:{params:{},inputs:[{id:tag.id,name:tag.name}],result:{tags:[tag]}}} as unknown as Card;
 assert.match(recommendationSummary(card)!,/Vegetarian options; confirm the menu/);
});
