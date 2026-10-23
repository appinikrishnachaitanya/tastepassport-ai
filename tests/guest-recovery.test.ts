import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rememberGuestPassport,restoreGuestPassport,clearGuestPassport } from "../src/workspace/guest-recovery.ts";
import type { Passport } from "../src/workspace/state.ts";
const fake=()=>{const x=new Map<string,string>();return {getItem:(k:string)=>x.get(k)??null,setItem:(k:string,v:string)=>{x.set(k,v);},removeItem:(k:string)=>{x.delete(k);},raw:x};};
const passport=():Passport=>{
  const card={id:"venue1",name:"Returned Venue",detail:"",types:["urn:entity:place"],section:"Eat" as const};
  const session={id:"11111111-1111-4111-8111-111111111111",revision:0,expires:Date.now()+3600000,city:"London",selected:[],tags:[],constraints:[],categoryConstraints:{},cards:[card],previous:[],feedback:[],notices:[],activeCategories:["Eat" as const],hiddenCategories:[],preferences:{},explorationMode:"aligned" as const,discoveryMode:"familiar" as const,categoryConcepts:{},categoryModes:{},categoryTags:{},history:[],providerHealth:"configured" as const,recovery:[],relaxed:[],savedCards:[]};
  return {city:"London",selected:[],cards:[card],notices:[],explanation:"",session,agent:{sessionId:session.id,revision:0,tags:[],constraints:[]}};
};
test("last good guest Passport is recoverable only within the same browser tab",()=>{
 const store=fake(),p=passport();
 assert.equal(rememberGuestPassport(store,p,1000),true);
 assert.deepEqual(restoreGuestPassport(store,1001),p);
 assert.equal(restoreGuestPassport(fake(),1001),undefined);
 clearGuestPassport(store);
 assert.equal(restoreGuestPassport(store,1001),undefined);
});
test("expired or tampered snapshots fail closed",()=>{
 const s=fake();rememberGuestPassport(s,passport(),1000);
 assert.equal(restoreGuestPassport(s,1000+7200000),undefined);
 assert.equal(s.raw.size,0);
 const p=passport();p.agent!.revision=5;
 assert.equal(rememberGuestPassport(s,p,1000),false);
});
test("oversize guest data and storage failures never crash the UI",()=>{
 const s=fake();const p=passport();p.explanation="a".repeat(1900000);
 assert.equal(rememberGuestPassport(s,p),false);
 const blocked={getItem:()=>{throw Error("blocked");},setItem:()=>{throw Error("blocked");},removeItem:()=>{throw Error("blocked");}};
 assert.equal(rememberGuestPassport(blocked,passport()),false);
 assert.equal(restoreGuestPassport(blocked),undefined);
 assert.doesNotThrow(()=>clearGuestPassport(blocked));
});
test("UI commits recovery snapshots after successful render and clears on intentional reset",()=>{
 const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
 assert.match(page,/useEffect\(\(\) => \{[\s\S]*?restoreGuestPassport\(window\.sessionStorage/);
 assert.match(page,/rememberGuestPassport\(window\.sessionStorage, result\)/);
 assert.match(page,/clearGuestPassport\(window\.sessionStorage\)/);
});
