import test from "node:test";
import assert from "node:assert/strict";
import {buildAreaGuide} from "../src/passport/area-guide.ts";
import type {Card} from "../src/passport/model.ts";
const card=(id:string,latitude?:number,longitude?:number)=>({id,name:id,section:"Eat",types:["urn:entity:place"],detail:"",address:"Returned address",intelligence:{location:{latitude,longitude}}}) as Card;
test("area previews connect real venues, deduplicate nearby starting points and omit distant extras",()=>{
 const places=[card("Anchor",40.75,-73.99),card("Nearby",40.751,-73.99),card("Far away",40.57,-74.16)];
 const result=buildAreaGuide([{latitude:40.75,longitude:-73.99,affinity:.9}],places);
 assert.equal(result.length,1);assert.equal(result[0].anchor.name,"Anchor");assert.equal(result[0].fromAreaSignal,true);
 assert.deepEqual(result[0].nearby.map(card=>card.name),["Nearby"]);
});
test("outlying heat points fall back honestly to returned places without inventing area names",()=>{
 const result=buildAreaGuide([{latitude:40.57,longitude:-74.16,affinity:.9}],[card("Existing place",40.75,-73.99)]);
 assert.equal(result[0].fromAreaSignal,false);assert.equal(result[0].anchor.name,"Existing place");
});
test("places without coordinates still offer a real destination without claiming proximity",()=>{
 const result=buildAreaGuide([],[card("Known place")]);
 assert.equal(result[0].point,undefined);assert.deepEqual(result[0].nearby,[]);assert.equal(result[0].fromAreaSignal,false);
 assert.deepEqual(buildAreaGuide([],[]),[]);
});
