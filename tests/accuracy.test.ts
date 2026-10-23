// Synthetic protocol fixtures only; no live Qloo response data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { paced } from '../src/qloo/transport.ts';
import { suggestedSections, conceptSections } from '../src/passport/routing.ts';
import { interpret, isConcept } from '../src/agent/intent.ts';
import { parseAnalysis } from '../src/qloo/analysis.ts';
import { buildQuery, patchPreferences, validatePreferences } from '../src/qloo/query-plan.ts';
import { validateDiscoveries } from '../src/agent/validation.ts';
import { runTurn } from '../src/agent/orchestrator.ts';
import { normalizeSession } from '../src/agent/session.ts';
import { threeChoices } from '../src/passport/shortlist.ts';
import type { AgentDependencies } from '../src/agent/orchestrator.ts';
import type { Card, Candidate } from '../src/passport/model.ts';
const id='00000000-0000-4000-8000-000000000001';
const candidate=(type:string):Candidate=>({id,name:'Fixture interest',types:[`urn:entity:${type}`],detail:''});

test('food descriptions resolve as concepts rather than unrelated named entities',()=>{
  assert.equal(isConcept('Indian Savouries'),true);
  assert.equal(isConcept('Indian savories'),true);
  assert.equal(isConcept('Indian Museum'),false);
  assert.equal(isConcept('Indian Coffee House'),false);
});
test('default sections follow confirmed tastes without forced coffee or unrelated culture',()=>{
  assert.deepEqual(suggestedSections([candidate('artist')]),['Music']);
  assert.deepEqual(suggestedSections([candidate('movie')]),['Movies']);
  assert.deepEqual(suggestedSections([{id:'urn:tag:cuisine:place:fixture',name:'Fixture cuisine',types:['urn:tag'],detail:''}]),['Eat']);
});
test('content recommendations and physical outing requests route to different result types',()=>{
  assert.deepEqual(interpret('recommend movies to watch').sections,['Movies']);
  assert.deepEqual(interpret('find books to read').sections,['Books']);
  assert.deepEqual(interpret('find independent bookstores').sections,['Lifestyle']);
  assert.deepEqual(interpret('find podcasts').sections,['Podcasts']);
  assert.deepEqual(interpret('Find independent contemporary art connected to my film tastes').sections,['Culture']);
  const outing=interpret('movie then party and dinner');
  assert.deepEqual(new Set(outing.sections),new Set(['Culture','Eat']));
  assert.deepEqual(outing.activityGenres,['cinema','nightclub']);
});
test('dish concepts stay specific and scoped to dining in multi-activity requests',()=>{
  assert.equal(isConcept('chicken biryani'),true);
  assert.deepEqual(conceptSections('chicken biryani',['Culture','Eat']),['Eat']);
  assert.deepEqual(conceptSections('independent coffee shops',['Eat','Coffee']),['Coffee']);
});
test('documented property and metro controls survive while undocumented content weights are diagnosed',()=>{
  const plan=buildQuery({outputType:'place',interests:{entities:[id],tags:[]},preferences:{requiredProperties:['image'],metro:'Fixture metro',contentBasedBias:.6}});
  assert.equal(plan.params['filter.exists'],'properties.image');
  assert.equal(plan.params['filter.location.metro'],'Fixture metro');
  assert.equal(plan.params['bias.content_based'],undefined);
  assert.ok(plan.diagnostics.dropped.some(item=>item.parameter === 'bias.content_based'));
  assert.deepEqual(plan.diagnostics.dropped.map(item=>item.parameter),["bias.content_based"]);
  const surprise=buildQuery({outputType:'place',interests:{entities:[id],tags:[]},preferences:{goal:'surprise'}});
  assert.equal(surprise.params['diversify.take'],undefined);
});
test('heatmap point searches use longitude first and a new locality supersedes the point',()=>{
  const point=patchPreferences({locationQuery:'Fixture city',priceMax:2},{locationPoint:'POINT(-73.9 40.7)',radius:1500});
  assert.equal(point.locationQuery,undefined);
  assert.equal(point.priceMax,2);
  const next=patchPreferences(point,{locationQuery:'Fixture district'});
  assert.equal(next.locationPoint,undefined);
  assert.throws(()=>validatePreferences({locationPoint:'POINT(190 42)'}));
  assert.throws(()=>validatePreferences({locationPoint:'https://example.invalid'}));
});
test('special Insights collections parse independently and reject malformed envelopes',()=>{
  const taste=parseAnalysis('taste',{results:{tags:[{tag_id:'urn:tag:genre:media:fixture',name:'Fixture theme',query:{affinity:.4}}]}});
  assert.equal(taste.kind==='taste'&&taste.tags.length,1);
  const heat=parseAnalysis('heatmap',{results:{heatmap:[{location:{latitude:40,longitude:-73},query:{affinity:.7}},{location:{latitude:100,longitude:20},query:{affinity:1}}]}});
  assert.equal(heat.kind==='heatmap'&&heat.points.length,1);
  const demo=parseAnalysis('demographics',{results:{demographics:[{entity_id:id,query:{age:{'25_to_29':-.2,invalid:'unknown'},gender:{female:.1}}}]}});
  assert.deepEqual(demo.kind==='demographics'&&demo.records[0].age,{'25_to_29':-.2});
  assert.throws(()=>parseAnalysis('heatmap',{results:{entities:[]}}));
  assert.throws(()=>parseAnalysis('taste',{success:false,results:{tags:[]}}));
});
test('content validation accepts the requested type and excludes unrelated entities without requiring local geography',()=>{
  const body={results:{entities:[{entity_id:id,name:'Fixture film',subtype:'urn:entity:movie'}]}};
  assert.equal(validateDiscoveries(body,'London','Movies',[],[]).length,1);
  assert.equal(validateDiscoveries(body,'London','Books',[],[]).length,0);
  assert.equal(validateDiscoveries(body,'London','Movies',[],[id]).length,0);
});
test('an exact dish applies during an outing and preserves activity genres across refinement',async()=>{
  const state=normalizeSession({id:'fixture',revision:0,expires:0,city:'London',selected:[candidate('artist')],tags:[],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[]});
  const visited:string[]=[];
  const deps:AgentDependencies={tools:async()=>[],workflow:async()=>({status:'ok',results:[{id:'urn:tag:specialty_dish:place:chicken_biryani',name:'Chicken biryani',type:'urn:tag:specialty_dish:place'}]}),discover:async(s,section)=>{
    visited.push(section);
    if(section==='Culture')assert.equal(s.categoryTags?.Culture?.includes('urn:tag:specialty_dish:place:chicken_biryani'),false);
    const resultId=section==='Eat'?'dining':'cinema';
    return [{...candidate('place'),id:resultId,section,...(section==='Eat'?{evidence:{source:'Qloo',operation:'/v2/insights/',queryId:'fixture',recordedAt:'2026-10-21',destination:s.city,locality:'physical-city',mode:'familiar',pool:'direct',inputs:[],params:{},result:{id:resultId,type:'urn:entity:place',tags:[{id:'urn:tag:specialty_dish:place:chicken_biryani',name:'Chicken biryani'}]}}}:{})}] as Card[];
  }};
  const reply=await runTurn(state,{message:'I want movie then party and chicken biryani dinner'},deps);
  assert.equal(reply.state.pending,undefined);
  assert.deepEqual(new Set(visited),new Set(['Eat','Culture']));
  assert.deepEqual(reply.state.categoryConcepts.Culture,undefined);
  assert.deepEqual(reply.state.categoryConcepts.Eat,['chicken biryani']);
  assert.deepEqual(reply.state.activityGenres?.Culture,['cinema','nightclub']);
  assert.deepEqual(reply.state.outingActivities,['Cinema','Nightlife','Eat']);
});
test('a selected concept is not re-resolved using a model-reworded query',async()=>{
  const tag={id:'urn:tag:genre:place:fixture_independent',name:'Independent Coffee Shops',types:['urn:tag:genre:place'],detail:''};
  const state=normalizeSession({id:'fixture',revision:0,expires:0,city:'London',selected:[],tags:[],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[],providerHealth:'healthy',pending:{query:'independent coffee shops',candidates:[tag],sections:['Coffee'],constraints:[]}});
  let lookups=0;
  const deps:AgentDependencies={provider:{interpret:async()=>interpret('find independent coffee shops'),choose:async()=>[{name:'qloo_find_tags',arguments:{query:'independent coffee shops London'}}]},tools:async()=>[{name:'qloo_find_tags',inputSchema:{}}],workflow:async()=>{lookups++;return {status:'ok',results:[]};},discover:async()=>[{...candidate('place'),id:'fixture-coffee',section:'Coffee'}]};
  const reply=await runTurn(state,{tagChoice:tag.id},deps);
  assert.equal(lookups,0);
  assert.equal(reply.state.pending,undefined);
  assert.deepEqual(reply.changed,['Coffee']);
});
test('model tool selection cannot rank an empty shortlist or add a film-taste activity',async()=>{
  const state=normalizeSession({id:'fixture',revision:0,expires:0,city:'London',selected:[],tags:[],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[]});
  let choices=0;
  const deps:AgentDependencies={provider:{interpret:async()=>({...interpret('find art'),sections:['Culture','Movies'],concepts:['independent art']}),choose:async(_message,_state,tools)=>{
    choices++;assert.deepEqual(tools.map(t=>t.name),['qloo_find_tags']);
    return [{name:'qloo_find_tags',arguments:{query:'independent art'}}];
  }},tools:async()=>[{name:'qloo_find_tags',inputSchema:{}},{name:'qloo_rank',inputSchema:{}}],workflow:async()=>({status:'ok',results:[{id:'urn:tag:genre:place:fixture_art',name:'Fixture art'}]}),discover:async()=>[]};
  const reply=await runTurn(state,{message:'Find independent art connected to my film tastes'},deps);
  assert.equal(choices,1);
  assert.deepEqual(reply.state.intent?.sections,['Culture']);
});
test('the budget label does not imply a more expensive second card is cheaper',()=>{
  const card=(id:string,price:number,affinity:number)=>({id,name:id,detail:'',types:['urn:entity:place'],section:'Eat',intelligence:{commercial:{priceLevel:price}},evidence:{result:{affinity:{value:affinity}}}} as Card);
  const choices=threeChoices([card('first',1,.9),card('second',3,.6)]);
  assert.equal(choices[1].label,'Known budget');
});
test('three choices prefer different branches or brands when real alternatives exist',()=>{
  const card=(id:string,name:string,affinity:number)=>({id,name,detail:'',types:['urn:entity:place'],section:'Coffee',evidence:{result:{affinity:{value:affinity}}}} as Card);
  const result=threeChoices([card('a','FixtureChain North',.9),card('b','FixtureChain South',.8),card('c','Independent Fixture',.7),card('d','Another Cafe',.6)]);
  assert.deepEqual(result.map(c=>c.card.id),['a','c','d']);
});
test('initial activity discovery keeps cuisine tags out of entity exclusions',()=>{
  const result=execFileSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {passport,seal} from './src/passport/service.ts';
    process.env.QLOO_API_KEY='synthetic-protocol-only';
    const selected=[{id:'00000000-0000-4000-8000-000000000001',name:'Fixture artist',types:['urn:entity:artist'],detail:''},{id:'00000000-0000-4000-8000-000000000002',name:'Fixture film',types:['urn:entity:movie'],detail:''},{id:'urn:tag:cuisine:place:fixture',name:'Fixture cuisine',types:['urn:tag'],detail:''}];
    const types=[];
    let broadened=false;
    globalThis.fetch=async input=>{
      const url=new URL(input);const type=url.searchParams.get('filter.type');types.push(type);
      assert.ok(!(url.searchParams.get('filter.exclude.entities')??'').includes('urn:tag:'));
      if(type==='urn:entity:place' && !(url.searchParams.get('filter.tags')??'').includes('urn:tag:cuisine:place:fixture'))broadened=true;
      return Response.json({results:{entities:[{entity_id:type==='urn:entity:place'?'00000000-0000-4000-8000-000000000004':'00000000-0000-4000-8000-000000000005',name:'Fixture result',subtype:type,tags:[{id:'urn:tag:genre:place:restaurant',type:'urn:tag:genre:place',name:'Restaurant'}],properties:{geocode:{city:'London'}}}]}});
    };
    const result=await passport('London',seal(selected.map(c=>({query:c.name,candidates:[c]}))),selected.map(c=>c.id),[],['Eat','Movies'],'balanced');
    assert.equal(broadened,true,'Balanced must run both profile and broader pools during initial discovery');
    assert.ok(result.cards.every(card=>card.evidence.mode==='balanced'));
    assert.deepEqual(new Set(types),new Set(['urn:entity:place','urn:entity:movie']));
    assert.deepEqual(new Set(result.cards.map(c=>c.section)),new Set(['Eat','Movies']));
    console.log('Activity contract PASS');
  `],{cwd:process.cwd(),encoding:'utf8',timeout:10000});
  assert.match(result,/Activity contract PASS/);
});
test('a cancelled queued request returns before the preceding request completes and never runs',async()=>{
  let release!:()=>void,started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const first=paced('fixture-held',async()=>{started();await new Promise<void>(resolve=>{release=resolve;});return 1;},0);
  await ready;
  const controller=new AbortController();let ran=false;
  const second=paced('fixture-cancelled',async()=>{ran=true;return 2;},0,controller.signal);
  controller.abort();
  await assert.rejects(second);
  assert.equal(ran,false);
  release();await first;
  assert.equal(ran,false);
});
