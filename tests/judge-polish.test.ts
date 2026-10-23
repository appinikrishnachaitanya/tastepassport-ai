import test from "node:test";
import assert from "node:assert/strict";
import {knownChain,type Card} from "../src/passport/model.ts";
import {cleanTagName,displayTags} from "../src/qloo/explanation.ts";
import {normalizeCompare} from "../src/qloo/compare.ts";
import {threeChoices} from "../src/passport/shortlist.ts";

test("known coffee chains are excluded without declaring unknown cafes independent",()=>{
 const card=(name:string)=>({id:name,name,section:"Coffee",types:["urn:entity:place"],detail:""}) as Card;
 for(const name of ["Harris + Hoole","Costa Coffee","Pret A Manger","Starbucks Reserve","Caffè Nero"])assert.equal(knownChain(card(name)),true,name);
 assert.equal(knownChain(card("Neighbourhood Coffee")),false);
});
test("returned themes clean punctuation and deduplicate visible labels",()=>{
 assert.equal(cleanTagName("Family,,"),"Family");
 assert.equal(displayTags([{id:"urn:tag:cuisine:qloo:indian",name:"Indian,,"},{id:"urn:tag:cuisine:qloo:other",name:"Indian"}]).length,1);
 const result=normalizeCompare({results:{tags:[{tag_id:"urn:tag:keyword:media:family",name:"Family,,"},{tag_id:"urn:tag:keyword:media:family2",name:"Family"}]}});
 assert.deepEqual(result.shared.map(tag=>tag.name),["Family"]);
});
test("bookstore budget explanations never refer to menu prices",()=>{
 const cards=[1,2].map(price=>({id:String(price),name:"Bookshop "+price,section:"Lifestyle",types:["urn:entity:place"],detail:"",intelligence:{commercial:{priceLevel:price}}})) as Card[];
 assert.ok(threeChoices(cards).some(choice=>choice.reason.includes("current prices")));
 assert.ok(threeChoices(cards).every(choice=>!choice.reason.includes("menu")));
});

test("Games normalizes the live provider spelling to the documented application type",async()=>{
 const {parseEntities}=await import("../src/qloo/types.ts");
 const entities=parseEntities({results:{entities:[{entity_id:"00000000-0000-4000-8000-000000000001",name:"Game",type:"urn:entity:videogame",types:["urn:entity:videogame"]}]}},"insights");
 assert.equal(entities[0].type,"urn:entity:video_game");
 assert.deepEqual(entities[0].types,["urn:entity:video_game"]);
});
