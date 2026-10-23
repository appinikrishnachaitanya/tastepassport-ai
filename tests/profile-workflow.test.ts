import { recommendationSummary } from "../src/qloo/explanation.ts";
import type { Card } from "../src/passport/model.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { portableTasteProfile } from "../src/account/taste-profile.ts";
import { profileName, validProfileId, exportTasteProfile } from "../src/account/profile-record.ts";
import { existingRegistration } from "../src/account/registration.ts";
import { rankCandidates, suggestedMatch } from "../src/passport/matching.ts";
import { discoveryQueries } from "../src/agent/strategy.ts";
import { normalizeSession } from "../src/agent/session.ts";
import type { AgentState } from "../src/agent/types.ts";
const selected=[1,2,3].map(n=>({id:`00000000-0000-4000-8000-00000000000${n}`,name:`Fixture ${n}`,types:["urn:entity:movie"],detail:""}));
function state() {return normalizeSession({id:"secret-session",revision:0,expires:0,city:"London",selected,tags:[],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[]} as AgentState);}
test("named profiles validate names and identifiers",()=>{
  assert.equal(profileName("  Weekend favourites  "),"Weekend favourites");
  assert.throws(()=>profileName(undefined));
  for (const value of ["", "<script>","x".repeat(81),"bad\nname",42]) assert.throws(()=>profileName(value));
  assert.equal(validProfileId(selected[0].id),true);
  assert.equal(validProfileId("somebody-else"),false);
});
test("profile export is versioned and excludes identity, session, geography and conversation",()=>{
  const original=state();
  const value=exportTasteProfile({id:selected[0].id,name:"Film weekends",updated_at:"2026-10-18T00:00:00Z",profile:portableTasteProfile(original)});
  assert.equal(value.version,1);
  assert.equal(value.name,"Film weekends");
  assert.equal(value.preferences.selected.length,3);
  assert.doesNotMatch(JSON.stringify(value),/secret-session|London|user_id|email|history|sessionId/);
});
test("duplicate registration handles both explicit and obfuscated provider responses",()=>{
  assert.equal(existingRegistration({error:null,data:{session:null,user:{identities:[]}}}),true);
  assert.equal(existingRegistration({error:{code:"user_already_exists"},data:{session:null,user:null}}),true);
  assert.equal(existingRegistration({error:null,data:{session:null,user:{identities:[{}]}}}),false);
  assert.equal(existingRegistration({error:{code:"over_email_send_rate_limit"},data:{session:null,user:null}}),false);
});
test("candidate ranking prioritizes exact title and requested year without losing ambiguity",()=>{
  const choices=[{...selected[0],name:"Crash",detail:"1996"},{...selected[1],name:"Crash",detail:"2004"},{...selected[2],name:"Crash Course",detail:"2004"}];
  assert.equal(suggestedMatch("Crash (2004)",choices),selected[1].id);
  assert.equal(suggestedMatch("Crash",choices),undefined);
  assert.equal(suggestedMatch("1984",[{...selected[0],name:"1984"}]),selected[0].id);
  assert.equal(suggestedMatch("2001: A Space Odyssey",[{...selected[0],name:"2001: A Space Odyssey"}]),selected[0].id);
  assert.deepEqual(rankCandidates("Crash (2004)",choices).map(c=>c.id),[selected[1].id,selected[0].id,selected[2].id]);
});
test("identical entity-only retrieval stays honest while preserving hard filters",()=>{
  const base={"filter.type":"urn:entity:place","filter.location.query":"London","filter.price_level.max":"2","filter.tags":"urn:tag:genre:place:museum","signal.interests.entities":selected[0].id};
  const familiar=discoveryQueries(base,state(),"Culture","familiar");
  const balanced=discoveryQueries(base,state(),"Culture","balanced");
  const explore=discoveryQueries(base,state(),"Culture","explore");
  assert.equal(familiar[0].params["bias.content_based"],undefined);
  assert.equal(explore[0].params["bias.content_based"],undefined);
  assert.equal(balanced.length,1);
  assert.match(balanced[0].note!, /do not support a distinct broader query/);
  for (const query of [...familiar,...balanced,...explore]) {
    assert.equal(query.params["filter.tags"],base["filter.tags"]);
    assert.equal(query.params["filter.price_level.max"],"2");
    assert.equal(query.params["filter.location.query"],"London");
  }
});

test("card summaries use specific returned interests instead of generic category promises",()=>{
  const card={id:selected[0].id,name:"Fixture venue",types:["urn:entity:place"],section:"Eat",detail:"",evidence:{inputs:[{id:"urn:tag:cuisine:place:indian",name:"Indian",role:"tag-signal",types:["urn:tag"]}],result:{tags:[{id:"urn:tag:genre:place:restaurant",type:"urn:tag:genre:place",name:"Restaurant"}]}}} as Card;
  assert.equal(recommendationSummary(card),undefined);
  card.evidence!.result.tags.push({id:"urn:tag:cuisine:place:indian",name:"Indian"});
  assert.equal(recommendationSummary(card),"Matches your interest in Indian.");
});
