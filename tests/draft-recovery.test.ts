import test from "node:test";
import assert from "node:assert/strict";
import { clearOnboardingDraft, restoreOnboardingDraft, saveOnboardingDraft } from "../src/workspace/draft-recovery.ts";
import { candidate } from "../src/passport/model.ts";

function store() {
  const rows = new Map<string,string>();
  return {getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);},removeItem:(key:string)=>{rows.delete(key);}};
}
test("unfinished onboarding choices survive tab refresh and clear on New Passport",()=>{
  const storage=store();
  const draft={city:"London",origin:"Bengaluru",tastes:["Björk"],activities:["Music" as const]};
  saveOnboardingDraft(storage,draft,1000);
  assert.deepEqual(restoreOnboardingDraft(storage,2000),draft);
  clearOnboardingDraft(storage);
  assert.equal(restoreOnboardingDraft(storage,2000),undefined);
});
test("old drafts expire and entity type is not repeated in candidate details",()=>{
  const storage=store();
  saveOnboardingDraft(storage,{city:"London",origin:"",tastes:["Interstellar"],activities:[]},1000);
  assert.equal(restoreOnboardingDraft(storage,1000+2*60*60_000+1),undefined);
  assert.equal(candidate({entity_id:"movie",name:"Toy Story",types:["urn:entity:movie","movie"],properties:{release_year:1995}}).detail,"movie · 1995");
});
