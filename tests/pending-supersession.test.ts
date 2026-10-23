import test from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, type AgentDependencies } from '../src/agent/orchestrator.ts';
import { normalizeSession } from '../src/agent/session.ts';
import type { Intent } from '../src/agent/types.ts';
const fresh=()=>normalizeSession({id:'pending-regression',revision:0,expires:Date.now()+60000,city:'London',selected:[],tags:[],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[],activeCategories:['Eat','Coffee','Music']});
const unknown:Intent={kind:'unknown',question:'explanation',sections:[],concepts:[],seeds:[],constraints:[],strategy:'discover'};
const lookups:string[]=[];
const deps:AgentDependencies={provider:{interpret:async message=>message.includes('noddles')?{kind:'refine',sections:['Eat'],concepts:['noodles'],seeds:[],constraints:[],strategy:'discover'}:structuredClone(unknown),choose:async()=>[]},tools:async()=>[],workflow:async(_mode,_tool,args)=>{const query=String(args.query);lookups.push(query);if(/quiet/.test(query))return {status:'ok',results:[{id:'urn:tag:ambience:place:quiet',name:'Quiet atmosphere'}]};return {status:'ok',results:[{id:`urn:tag:specialty_dish:place:${query.replace(/\s+/g,'_')}`,name:`${query} dishes`},{id:`urn:tag:genre:place:${query.replace(/\s+/g,'_')}_other`,name:`${query} alternative`}]};},discover:async()=>[]};
test('new dish and cancellation supersede the pending noodles question even when the model returns a stale read-only intent',async()=>{
 lookups.length=0;
 const noodles=await runTurn(fresh(),{message:'i want to eat noddles man'},deps);
 assert.equal(noodles.state.pending?.query,'noodles');
 const biryani=await runTurn(noodles.state,{message:'i want chicken birayni'},deps);
 assert.notEqual(biryani.state.pending?.query,'noodles');
 assert.ok(lookups.some(query=>/biryani/.test(query)));
 const peaceful=await runTurn(biryani.state,{message:"I don't need chicken. I just want somewhere peaceful."},deps);
 assert.doesNotMatch(peaceful.state.pending?.query ?? '',/noodles|chicken|biryani/i);
 assert.ok(!peaceful.state.pending || /quiet|peaceful/i.test(peaceful.state.pending.query));
 assert.deepEqual(peaceful.changed,[]);
 assert.ok(lookups.includes('quiet atmosphere'));
 assert.ok(!peaceful.state.categoryTags?.Eat?.some(id=>/noodles|chicken|biryani/.test(id)));
 assert.ok(!peaceful.state.history?.at(-1)?.text.includes('noodles'));
});

test('a genuine read-only question answers without consuming or reconfirming a paused choice',async()=>{
 const first=await runTurn(fresh(),{message:'i want to eat noddles man'},deps);
 const answered=await runTurn(first.state,{message:'What are my preferences?'},deps);
 assert.deepEqual(answered.state.pending,first.state.pending);
 assert.doesNotMatch(answered.message,/choose the concept/i);
 assert.deepEqual(answered.changed,[]);
});
test('repeating the same pending request preserves its choices without another lookup',async()=>{
 const first=await runTurn(fresh(),{message:'i want to eat noddles man'},deps);
 const before=lookups.length;
 const repeated=await runTurn(first.state,{message:'i want to eat noddles man'},deps);
 assert.equal(repeated.state.pending?.query,'noodles');assert.equal(lookups.length,before);
});
test('ambiguous accidental input does not confirm a pending concept',async()=>{
 const first=await runTurn(fresh(),{message:'i want to eat noddles man'},deps);
 const before=lookups.length;
 const typo=await runTurn(first.state,{message:'yi'},deps);
 assert.deepEqual(typo.changed,[]);assert.equal(lookups.length,before);
 assert.deepEqual(typo.state.categoryTags,first.state.categoryTags);
});
test('pending search settings are draft-only and survive a repeated clarification before confirmation',async()=>{
 const first=await runTurn(fresh(),{message:'i want to eat noddles man'},deps);
 assert.deepEqual(first.state.categoryConcepts,{});
 assert.deepEqual(first.state.pending?.settings?.Eat?.categoryConcepts,['noodles']);
 const repeated=await runTurn(first.state,{message:'i want to eat noddles man'},deps);
 assert.deepEqual(repeated.state.pending?.settings,first.state.pending?.settings);
});
test('None of these followed by a fresh dish request does not restore noodles',async()=>{
 const first=await runTurn(fresh(),{message:'i want to eat noddles man'},deps);
 first.state.categoryConcepts!.Eat=['noodles']; // Legacy pre-fix draft pollution.
 const skipped=await runTurn(first.state,{message:'None of these'},deps);
 assert.ok(!skipped.state.categoryConcepts?.Eat?.includes('noodles'));
 assert.equal(skipped.state.pending,undefined);
 const next=await runTurn(skipped.state,{message:'i want chicken birayni'},deps);
 assert.notEqual(next.state.pending?.query,'noodles');
 assert.ok(!next.state.categoryConcepts?.Eat?.includes('noodles'));
});
