/** Bounded live acceptance; logs counts/status only. No credentials or response payloads. */
import assert from 'node:assert/strict';
import { search, QlooError } from '../src/qloo/client.ts';
import { findTags } from '../src/qloo/lookups.ts';
import { threeChoices } from '../src/passport/shortlist.ts';
import { candidates } from '../src/passport/model.ts';
import { passport, seal } from '../src/passport/service.ts';
import { createSession } from '../src/agent/store.ts';
import { agentDependencies, resolveCulturalSeeds } from '../src/agent/runtime.ts';
import { runTurn } from '../src/agent/orchestrator.ts';
if(!process.env.QLOO_API_KEY){console.log('Accuracy acceptance UNRUN: configure QLOO_API_KEY securely.');process.exitCode=2;}
else try {
  const artist=candidates(await search('A. R. Rahman')).find(c=>c.types.includes('urn:entity:artist'));
  const film=candidates(await search('Interstellar')).find(c=>c.types.includes('urn:entity:movie') && c.detail.includes('2014'));
  const cuisine=(await findTags('Indian')).find(t=>t.id.includes(':cuisine:'));
  assert.ok(artist&&film&&cuisine,'Required exact cultural inputs were not returned');
  const selected=[artist,film,cuisine];
  const started=Date.now();
  const result=await passport('London',seal(selected.map(c=>({query:c.name,candidates:[c]}))),selected.map(c=>c.id),[],['Eat','Movies']);
  assert.ok(result.cards.some(c=>c.section==='Eat'),'Dining must be independently returned');
  assert.ok(result.cards.some(c=>c.section==='Movies'),'Films must be independently returned');
  assert.ok(!result.cards.some(c=>c.section==='Coffee'||c.section==='Music'),'Unrequested categories must not be added');
  console.log(JSON.stringify({check:'live-activity-routing',elapsedMs:Date.now()-started,dining:result.cards.filter(c=>c.section==='Eat').length,movies:result.cards.filter(c=>c.section==='Movies').length,photos:result.cards.filter(c=>c.intelligence?.image).length}));
  const state=createSession(result);
  const deps=agentDependencies();
  // Test the actual guided fallback independently of provider availability.
  delete deps.provider;
  let reply=await runTurn(state,{message:'find chicken biryani'},deps);
  if(reply.state.pending) {
    const exact=reply.state.pending.candidates.filter(c=>c.name.toLowerCase()==='chicken biryani');
    if(exact.length===1)reply=await runTurn(reply.state,{tagChoice:exact[0].id},deps);
  }
  console.log(JSON.stringify({check:'live-dish-refinement',changed:reply.changed,pending:Boolean(reply.state.pending),recovery:reply.state.recovery,otherCategoryPreserved:reply.state.cards.filter(c=>c.section==='Movies').map(c=>c.id).join(',')===state.cards.filter(c=>c.section==='Movies').map(c=>c.id).join(',')}));
  assert.ok(!reply.state.pending,'Dish refinement should complete without a repeated confirmation');
  assert.ok(reply.changed.includes('Eat'),'Dish refinement requires eligible dining results');
  const budget=await runTurn(reply.state,{discovery:{section:'Eat',preferences:{priceMax:2}}},deps);
  assert.ok(budget.changed.includes('Eat'),'Budget refinement requires eligible dining results');
  assert.ok(budget.state.cards.filter(c=>c.section==='Eat').every(c=>c.intelligence?.commercial.priceLevel!==undefined && c.intelligence.commercial.priceLevel<=2));
  console.log('PASS live price cap: every retained dining result has a known eligible price.');
  const outing=await runTurn(budget.state,{message:'movie then party then dinner'},deps);
  assert.ok(outing.changed.includes('Culture'),'Outing refinement requires eligible cinema/nightlife venues');
  const culture=outing.state.cards.filter(c=>c.section==='Culture');
  const genres=culture.map(c=>c.evidence?.result.tags.map(t=>t.name).join(' ') ?? '');
  assert.ok(genres.some(g=>/cinema|movie theater|movie theatre/i.test(g)),'The outing needs an actual cinema option');
  assert.ok(genres.some(g=>/nightclub|night club/i.test(g)),'The outing needs an actual nightlife option');
  assert.deepEqual(outing.state.outingActivities,['Cinema','Nightlife','Eat']);
  console.log(JSON.stringify({check:'live-multi-activity',culture:culture.length,cinema:genres.filter(g=>/cinema|movie theater|movie theatre/i.test(g)).length,nightlife:genres.filter(g=>/nightclub|night club/i.test(g)).length,order:outing.state.outingActivities}));
  let coffee=await runTurn(outing.state,{message:'Find independent coffee shops instead of Starbucks or other big chains'},deps);
  if(coffee.state.pending) {
    const exact=coffee.state.pending.candidates.filter(c=>c.name.toLowerCase()==='independent coffee shops');
    if(exact.length===1)coffee=await runTurn(coffee.state,{tagChoice:exact[0].id},deps);
  }
  const cafes=coffee.state.cards.filter(c=>c.section==='Coffee');
  console.log(JSON.stringify({check:'live-coffee-refinement',changed:coffee.changed,pending:Boolean(coffee.state.pending),count:cafes.length,starbucksReturned:cafes.some(c=>/\bstarbucks\b/i.test(c.name))}));
  assert.ok(coffee.changed.includes('Coffee') && !coffee.state.pending,'Independent coffee refinement should complete after at most one exact confirmation');
  assert.ok(!cafes.some(c=>/\bstarbucks\b/i.test(c.name)),'Explicitly excluded Starbucks must not be retained');
  const reportedItems=await resolveCulturalSeeds(['A.R. Rahman','Specialty Coffee','Indian Savouries']);
  const reportedSelected=reportedItems.map((item,index)=>item.candidates.find(c=>index===0?c.types.includes('urn:entity:artist'):c.name.toLowerCase()===item.query.toLowerCase()));
  assert.ok(reportedSelected.every(Boolean),'Reported tastes require exact returned concepts/entities');
  assert.ok(reportedSelected[2]!.id.startsWith('urn:tag:'),'Indian Savouries must not resolve to an unrelated named place');
  const modeChoices:Record<string,string[]>={};
  for(const mode of ['familiar','balanced','explore'] as const) {
    const profile=await passport('London',seal(reportedItems),reportedSelected.map(c=>c!.id),[],[],mode);
    const counts=Object.fromEntries(['Music','Coffee','Eat'].map(section=>[section,profile.cards.filter(c=>c.section===section).length]));
    assert.ok(Object.values(counts).every(count=>count>0),`Reported London profile needs each inferred category in ${mode}`);
    assert.ok(profile.cards.every(c=>c.evidence?.mode===mode),'Initial results must use the requested style');
    modeChoices[mode]=threeChoices(profile.cards.filter(c=>c.section==='Eat')).map(choice=>choice.card.id);
    console.log(JSON.stringify({check:'reported-profile-initial-style',mode,counts}));
  }
  console.log(JSON.stringify({check:'mode-preview-overlap',familiarChoices:modeChoices.familiar.length,balancedChoices:modeChoices.balanced.length,sharedDiningChoices:modeChoices.familiar.filter(id=>modeChoices.balanced.includes(id)).length}));
}catch(error){console.error(`Accuracy acceptance FAIL${error instanceof QlooError&&error.status?` HTTP ${error.status}`:''}; request details and credentials withheld.`);process.exitCode=1;}
