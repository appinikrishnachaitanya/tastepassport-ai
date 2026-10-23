import test from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, type AgentDependencies } from '../src/agent/orchestrator.ts';
import { normalizeSession } from '../src/agent/session.ts';
import { validateResponse, responseContext } from '../src/agent/response.ts';
import { TurnGuard } from '../src/agent/guard.ts';
import type { GroundedResponseContext, GroundedResponse } from '../src/agent/types.ts';
const initial=()=>normalizeSession({id:'fixture',revision:0,expires:Date.now()+60000,city:'London',selected:[],tags:[],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[],activeCategories:['Eat']});
const forbidden=async():Promise<never>=>{throw Error('No tools permitted');};
const base:AgentDependencies={tools:forbidden,workflow:forbidden,discover:forbidden};
const provider=(compose:NonNullable<NonNullable<AgentDependencies['provider']>['compose']>)=>({interpret:forbidden,choose:forbidden,compose});
test('a greeting receives a dynamic response with context and no tool execution',async()=>{
 let calls=0;
 const reply=await runTurn(initial(),{message:'Hi'},{...base,provider:provider(async context=>{
  calls++;assert.equal(context.request,'Hi');assert.equal(context.passport.city,'London');
  assert.deepEqual(context.outcome.changed,[]);
  return {message:'Welcome! What would make London feel like your kind of place?',evidenceIds:[],recommendationIds:[]};
 })});
 assert.equal(calls,1);assert.match(reply.message,/What would make London/);assert.equal(reply.state.history?.at(-1)?.text,reply.message);assert.deepEqual(reply.changed,[]);
});
test('final response observes retrieval outcome, cites returned choices and cannot change committed preferences',async()=>{
 const original=initial();
 const reply=await runTurn(original,{message:'Make food cheaper'},{...base,
  provider:{interpret:async()=>({kind:'refine',sections:['Eat'],seeds:[],concepts:[],constraints:['expensive'],strategy:'discover'}),choose:async()=>[],compose:async context=>{
   assert.deepEqual(context.outcome.changed,['Eat']);assert.equal(context.passport.categories?.[0].preferences.priceMax,2);
   context.outcome.changed.push('Music'); // Payload mutation cannot affect real state.
   return {message:'Here is Returned Table from the updated food search. Would you like help choosing?',evidenceIds:['returned'],recommendationIds:['returned']};
  }},discover:async()=>[{id:'returned',name:'Returned Table',section:'Eat',types:['urn:entity:place'],detail:''}],tools:async()=>[],
 });
 assert.deepEqual(reply.changed,['Eat']);assert.equal(reply.state.queryPreferences?.Eat?.priceMax,2);
 assert.match(reply.message,/Returned Table/);assert.match(reply.message,/Applied to: Food/);
 assert.deepEqual(reply.state.history?.at(-1)?.recommendationIds,['returned']);
});
test('timeout or invalid prose preserves the successful result and authoritative fallback',async()=>{
 const reply=await runTurn(initial(),{message:'Hi'},{...base,provider:provider(async()=>{throw Error('Provider timed out');})});
 assert.match(reply.message,/Hi!/);assert.deepEqual(reply.changed,[]);
 const invalid=await runTurn(initial(),{message:'Hi'},{...base,provider:provider(async()=>({message:'I updated your food and reserved a table.',evidenceIds:[],recommendationIds:[]}))});
 assert.match(invalid.message,/Hi!/);
});
test('failed filters stay unapplied in the model envelope and canonical receipt',async()=>{
 const original=initial();original.queryPreferences={Eat:{priceMax:4}};
 const failed=await runTurn(original,{message:'Make food cheaper'},{...base,tools:async()=>[],discover:async()=>[],provider:{interpret:async()=>({kind:'refine',sections:['Eat'],seeds:[],concepts:[],constraints:['expensive'],strategy:'discover'}),choose:async()=>[],compose:async context=>{
  assert.deepEqual(context.outcome.changed,[]);assert.deepEqual(context.outcome.failed,['Eat']);
  assert.equal(context.passport.categories?.[0].preferences.priceMax,4);
  return {message:'I could not apply the cheaper search. Would you like to adjust the budget?',evidenceIds:[],recommendationIds:[]};
 }}});
 assert.match(failed.message,/Search not applied/);assert.equal(failed.state.queryPreferences?.Eat?.priceMax,4);
});
test('checker rejects invented references, metrics, false updates and live availability',()=>{
 const context:GroundedResponseContext={request:'Help me choose',passport:{city:'London'},outcome:{changed:[],failed:[],pending:false,fallback:'Returned Table has listing rating 4.5/5.'},facts:[{id:'real',text:'Returned Table, rating 4.5/5'}],choices:[{id:'real',name:'Returned Table',section:'Eat'}],limitations:['Hours unavailable']};
 for(const proposal of [
  {message:'Try this.',evidenceIds:['invented'],recommendationIds:[]},
  {message:'It has rating 4.9.',evidenceIds:['real'],recommendationIds:[]},
  {message:'Your search was updated.',evidenceIds:[],recommendationIds:[]},
  {message:'They are open now.',evidenceIds:[],recommendationIds:[]},
  {message:'Returned Table looks good.',evidenceIds:[],recommendationIds:[]},
  {message:'Your table is reserved.',evidenceIds:[],recommendationIds:[]},
 ] as GroundedResponse[])assert.throws(()=>validateResponse(proposal,context));
 assert.doesNotThrow(()=>validateResponse({message:'I cannot verify whether they are open now. Check before going.',evidenceIds:[],recommendationIds:[]},context));
});
test('response budget is separate from planning and aborts only its own request',async()=>{
 const guard=new TurnGuard(4,550);
 await guard.model(async()=>1);await guard.model(async()=>2);
 await assert.rejects(guard.respond(async signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))),/unavailable|timeout|aborted/i);
 assert.equal(guard.signal.aborted,false);
});
test('response context omits account records and clears latest fallback from recent transcript',()=>{
 const state=initial();state.history=[{role:'user',text:'Hi'},{role:'agent',text:'Fallback hello'}];
 const context=responseContext({state,changed:[],events:[],mode:'deterministic',message:'Fallback hello'},{message:'Hi'});
 assert.deepEqual(context.passport.history,[]);assert.ok(!JSON.stringify(context).includes('fixture'));
});
