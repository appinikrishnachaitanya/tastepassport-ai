/** Opt-in Qloo acceptance using fixed synthetic profiles. Only bounded public
 * result titles and aggregate evidence are printed; no raw responses or secrets. */
import assert from "node:assert/strict";
import { search, insights } from "../src/qloo/client.ts";
import { findTags } from "../src/qloo/lookups.ts";
import { candidates, type Candidate, type Card } from "../src/passport/model.ts";
import { discoverSection } from "../src/agent/runtime.ts";
import { createSession } from "../src/agent/store.ts";
import { seal, passport } from "../src/passport/service.ts";
import { POST } from "../app/api/agent/intelligence/route.ts";
import { normalizeEntity } from "../src/qloo/normalizer.ts";
const clean = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
async function entity(name: string, type: string, year?: string): Promise<Candidate> {
  const found = candidates(await search(name)).find(candidate =>
    candidate.types.includes(`urn:entity:${type}`) && clean(candidate.name) === clean(name) && (!year || candidate.detail.includes(year)));
  assert.ok(found, `Exact synthetic input unavailable: ${name}`);
  return found;
}
const top = (cards: Card[]) => cards.slice(0,5).map(card => card.name);
const overlap = (a: Card[], b: Card[]) => a.slice(0,10).filter(card => b.slice(0,10).some(other => other.id === card.id)).length;
function influence(cards: Card[], inputs: Candidate[]) {
  return inputs.filter(input=>!input.id.startsWith("urn:tag:")).map(input=>{
    const observed = cards.slice(0,5).flatMap(card => card.intelligence?.taste.contributingSignals.filter(signal=>signal.id===input.id).map(signal=>signal.contribution) ?? []);
    return { input:input.name, observedAt5:observed.length, meanReturnedContribution:observed.length ? Number((observed.reduce((a,b)=>a+b,0)/observed.length).toFixed(3)) : null };
  });
}
if (!process.env.QLOO_API_KEY) {
  console.log("Relevance acceptance UNRUN: configure QLOO_API_KEY securely.");
  process.exitCode = 2;
} else try {
  const artist = await entity("A. R. Rahman", "artist");
  const film = await entity("Interstellar", "movie", "2014");
  const otherFilm = await entity("Toy Story", "movie", "1995");
  const otherArtist = await entity("Taylor Swift", "artist");
  const cuisine = (await findTags("Indian")).find(tag => tag.id.includes(":cuisine:") && clean(tag.name) === "indian");
  assert.ok(cuisine);
  for (const [seed,section] of [[film,"Movies"],[artist,"Music"],[cuisine,"Eat"]] as const) {
    const result=await passport("Toronto",seal([{query:seed.name,candidates:[seed]}]),[seed.id],[],[section]);
    assert.equal(result.selected.length,1);
    assert.ok(result.cards.length>0 && result.cards.every(card=>card.section===section));
    console.log(JSON.stringify({check:"single-taste-live",section,count:result.cards.length}));
  }
  const profiles = [[artist,film,cuisine], [artist,otherFilm,cuisine], [otherArtist,film,cuisine]];
  const familiar: Card[][] = [];
  const music: Card[][] = [];
  for (const [index, selected] of profiles.entries()) {
    const state = createSession({ city: "Toronto", selected, cards: [], notices: [], explanation: "" });
    state.discoveryMode = "familiar";
    const excluded = selected.filter(seed => !seed.id.startsWith("urn:tag:")).map(seed => seed.id);
    const legacyParams = { "filter.type":"urn:entity:movie", "signal.interests.entities":excluded.join(","), "signal.interests.tags":cuisine.id, "signal.location.query":"Toronto", "filter.exclude.entities":excluded.join(","), "bias.content_based":"0.8", take:"20", "feature.explainability":"true" };
    const legacy = await insights(legacyParams);
    if (index===0) {
      const withoutCuisine: Record<string,string>={...legacyParams};
      delete withoutCuisine["signal.interests.tags"];
      const ablation=await insights(withoutCuisine);
      console.log(JSON.stringify({check:"cuisine-ablation-same-bias",top:ablation.entities.slice(0,5).map(entity=>entity.name)}));
    }
    const cards = await discoverSection(state,"Movies",[],excluded,false,AbortSignal.timeout(45000));
    assert.ok(cards.length, "Familiar movie retrieval must return results");
    assert.ok(cards.every(card => card.evidence?.inputs.filter(input => input.role === "entity-signal").every(input => input.id === selected[1].id)));
    familiar.push(cards);
    const legacyCards = legacy.entities.map(entity=>({id:entity.entity_id,name:entity.name,section:"Movies",types:["urn:entity:movie"],detail:"",intelligence:normalizeEntity(entity)}) as Card);
    console.log(JSON.stringify({check:"category-seed-routing",profile:index+1,legacyTop:legacy.entities.slice(0,5).map(entity=>entity.name),familiarTop:top(cards),count:cards.length,individualEvidence:cards.filter(card=>card.intelligence?.taste.contributingSignals.length).length,legacyInfluence:influence(legacyCards,selected),familiarInfluence:influence(cards,selected)}));
    if (index === 0) {
      for (const mode of ["balanced","explore"] as const) {
        state.discoveryMode = mode;
        const varied = await discoverSection(state,"Movies",[],excluded,false,AbortSignal.timeout(45000));
        assert.ok(varied.length);
        console.log(JSON.stringify({check:"discovery-mode",mode,top:top(varied),direct:varied.filter(card=>card.evidence?.pool==="direct").length,broader:varied.filter(card=>card.evidence?.pool==="adjacent").length}));
      }
    }
    state.discoveryMode="familiar";
    const artists=await discoverSection(state,"Music",[],excluded,false,AbortSignal.timeout(45000));
    assert.ok(artists.length);
    music.push(artists);
    console.log(JSON.stringify({check:"music-seed-routing",profile:index+1,top:top(artists),influence:influence(artists,selected)}));
  }
  assert.ok(overlap(familiar[0],familiar[1]) < Math.min(10,familiar[0].length,familiar[1].length), "Contrasting movie seeds must not return an identical top ten");
  assert.deepEqual(familiar[0].map(card=>card.id),familiar[2].map(card=>card.id), "Changing artist alone must not displace the familiar movie anchor");
  assert.deepEqual(music[0].map(card=>card.id),music[1].map(card=>card.id),"Changing film alone must not displace the familiar artist anchor");
  assert.ok(overlap(music[0],music[2])<Math.min(10,music[0].length,music[2].length),"Contrasting artists must change the music shortlist");
  console.log(JSON.stringify({check:"counterfactual-seeds",changedMovieOverlapAt10:overlap(familiar[0],familiar[1]),changedArtistOverlapAt10:overlap(familiar[0],familiar[2])}));
  const italian=(await findTags("Italian")).find(tag=>tag.id.includes(":cuisine:") && clean(tag.name)==="italian");
  assert.ok(italian);
  const dining: Card[][]=[];
  for(const tag of [cuisine,italian]) {
    const state=createSession({city:"Toronto",selected:[artist,film,tag],cards:[],notices:[],explanation:""});
    const cards=await discoverSection(state,"Eat",[],[artist.id,film.id],false,AbortSignal.timeout(45000));
    assert.ok(cards.length && cards.every(card=>card.evidence?.params["filter.tags"].split(",").includes(tag.id)));
    dining.push(cards);
    console.log(JSON.stringify({check:"cuisine-routing",cuisine:tag.name,top:top(cards),count:cards.length,influence:influence(cards,[artist,film])}));
  }
  assert.ok(overlap(dining[0],dining[1])<Math.min(10,dining[0].length,dining[1].length),"Contrasting cuisine requirements must change dining");
  const partner = [otherArtist, await entity("Inception","movie","2010"), otherFilm];
  const state = createSession({city:"Toronto",selected:profiles[0],cards:[],notices:[],explanation:""});
  state.queryPreferences.Eat={priceMax:2,businessRatingMin:4};
  state.categoryConcepts.Eat=["Indian cuisine"];
  const before = JSON.stringify(state);
  const response = await POST(new Request("http://localhost/api/agent/intelligence", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:state.id,revision:state.revision,action:"together",section:"Eat",token:seal(partner.map(candidate=>({query:candidate.name,candidates:[candidate]}))),ids:partner.map(candidate=>candidate.id)})}));
  assert.equal(response.status,200);
  const result = await response.json();
  assert.ok(result.comparison.shared.length>0,"Real comparison needs returned shared themes");
  assert.ok(result.cards.length>0,"Real Together comparison needs usable recommendations");
  assert.equal(JSON.stringify(state),before,"Together must preserve the individual Passport");
  const joint: Card[] = result.cards;
  assert.ok(joint.every(card=>card.section==="Eat" && card.address && card.evidence?.inputs.some(input=>input.id===artist.id) && card.evidence.inputs.some(input=>input.id===otherArtist.id)));
  assert.ok(joint.every(card=>card.intelligence?.commercial.priceLevel!==undefined && card.intelligence.commercial.priceLevel<=2 && (card.intelligence.quality.businessRating ?? 0)>=4 && card.evidence?.params["filter.tags"].split(",").includes(cuisine.id)));
  const aIds=new Set(profiles[0].map(seed=>seed.id)), bIds=new Set(partner.map(seed=>seed.id));
  const withBothContributors=joint.filter(card=>{
    const positive=card.intelligence?.taste.contributingSignals.filter(signal=>signal.contribution>0) ?? [];
    return positive.some(signal=>aIds.has(signal.id)) && positive.some(signal=>bIds.has(signal.id));
  }).length;
  console.log(JSON.stringify({check:"live-together-route",sharedThemes:result.comparison.shared.slice(0,5).map((tag:{name:string})=>tag.name),count:joint.length,top:top(joint),bothProfilesUsed:true,withBothContributors,currentFiltersPreserved:true,passportPreserved:true}));
} catch (error) {
  console.error(error instanceof assert.AssertionError ? `Relevance acceptance FAIL: ${error.message}` : "Relevance acceptance FAIL: provider request unavailable; payloads and credentials withheld.");
  process.exitCode=1;
}
