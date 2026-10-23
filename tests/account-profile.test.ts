import test from "node:test";
import assert from "node:assert/strict";
import { accountName } from "../src/account/identity.ts";
import { portableTasteProfile, readTasteProfile } from "../src/account/taste-profile.ts";
import type { AgentState } from "../src/agent/types.ts";
const ids = ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000003"];
function state(): AgentState {
  return {id:"secret-session",revision:5,expires:1,city:"Toronto",
    selected:ids.map((id,i)=>({id,name:["Jazz","Cinema","Coffee artist"][i],types:["urn:entity:artist"],detail:""})),
    tags:[],constraints:["expensive"],categoryConstraints:{Eat:["expensive"]},
    queryPreferences:{Eat:{priceMax:2,businessRatingMin:4,locationQuery:"Toronto",radius:5000,excludeLocation:"Downtown",countryCode:"CA",region:"Ontario",metro:"Toronto",excludeEntities:[ids[0]],excludeTags:["urn:tag:business:place:chain"]}},
    cards:[{id:ids[0],name:"Old venue",types:["urn:entity:place"],detail:"Private address",section:"Eat"}],
    previous:[],feedback:[{id:ids[0],section:"Eat",accepted:true}],notices:[],history:[{role:"user",text:"Private conversation"}],
  };
}
test("account names support international names without accepting contact details or markup",()=>{
  assert.equal(accountName("  José  "),"José");
  assert.equal(accountName("O’Connor"),"O’Connor");
  assert.equal(accountName("李"),"李");
  for(const name of ["", "...", "<script>", "person@example.com", "x".repeat(81),null]) assert.throws(()=>accountName(name));
});
test("reusable tastes retain budgets and exclusions while stripping city results, identity and conversation",()=>{
  const original=state();original.selected[0].detail="Private address in Toronto";
  original.activeCategories=['Eat','Culture'];original.activityGenres={Culture:['cinema']};
  const profile=portableTasteProfile(original);
  assert.deepEqual(profile.queryPreferences.Eat,{priceMax:2,businessRatingMin:4,excludeTags:["urn:tag:business:place:chain"]});
  assert.equal(profile.selected.length,3);
  assert.deepEqual(profile.categoryConstraints.Eat,["expensive"]);
  assert.deepEqual(profile.activeCategories,['Eat','Culture']);
  assert.deepEqual(profile.activityGenres,{Culture:['cinema']});
  assert.doesNotMatch(JSON.stringify(profile),/secret-session|Toronto|Downtown|Ontario|Old venue|Private address|Private conversation/);
  assert.equal("cards" in profile,false);
  assert.equal("feedback" in profile,false);
  assert.equal("history" in profile,false);
});
test("saved taste profiles round trip with a version boundary and reject malformed selections",()=>{
  const profile=portableTasteProfile(state());
  assert.deepEqual(readTasteProfile(profile),profile);
  assert.throws(()=>readTasteProfile({...profile,version:99}));
  assert.throws(()=>readTasteProfile({...profile,selected:[]}));
  assert.throws(()=>readTasteProfile({...profile,selected:[{...profile.selected[0],id:"forged"},...profile.selected.slice(1)]}));
});
