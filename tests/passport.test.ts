import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, classify, card } from '../src/passport/model.ts';
import { fetchWithRetry, retryDelay } from '../src/qloo/transport.ts';
import type { Entity } from '../src/qloo/types.ts';
// Synthetic protocol inputs; no fake recommendation fixtures or live credentials.
const entity:Entity={name:'Protocol sample',entity_id:'00000000-0000-0000-0000-000000000000',types:['urn:entity:movie'],properties:{release_year:2014}};
test('resolution collapses duplicate display identities while preserving distinct years',()=>{
 const options=candidates([entity,{...entity,entity_id:'00000000-0000-0000-0000-000000000001'},entity,{...entity,entity_id:'00000000-0000-0000-0000-000000000002',properties:{release_year:2024}}]);assert.equal(options.length,2);assert.equal(options[0].detail,'movie · 2014');assert.deepEqual(options[0].types,['urn:entity:movie']);
});
test('review keeps all distinct matches from a ten-result search',()=>{
 const results=Array.from({length:10},(_,index):Entity=>({...entity,entity_id:`00000000-0000-0000-0000-${String(index).padStart(12,'0')}`,name:`Protocol sample ${index}`}));
 assert.equal(candidates(results).length,10);
});
test('conservative category filtering omits services and unknown landmarks',()=>{
 assert.equal(classify({...entity,tags:[{name:'Restaurant'}]}),'Eat');
 assert.equal(classify({...entity,tags:[{name:'Coffee Shop'}]}),'Coffee');
 assert.equal(classify({...entity,tags:[{name:'Art Museum'}]}),'Culture');
 assert.equal(classify({...entity,tags:[{name:'Bookstore'}]}),'Lifestyle');
 assert.equal(classify({...entity,name:'Consulate',tags:[{name:'Restaurant'}]}),undefined);
 assert.equal(classify({...entity,tags:[{name:'Landmark'}]}),undefined);
});
test('normalization only includes returned affinity and usable metadata',()=>{
 assert.equal(card(entity,'Music').affinity,undefined);const c=card({...entity,query:{affinity:0.7},properties:{address:'Protocol address',short_description:'Protocol description'}},'Culture');assert.equal(c.affinity,0.7);assert.equal(c.address,'Protocol address');
});
test('429 retry is bounded, honors Retry-After and uses backoff',async()=>{
 let calls=0;const delays:number[]=[];
 const r=await fetchWithRetry(new URL('https://example.com'),{},async()=>new Response('',{status:++calls<3?429:200}),async ms=>{delays.push(ms)});
 assert.equal(r.status,200);assert.equal(calls,3);assert.deepEqual(delays,[1000,2000]);
 calls=0;await fetchWithRetry(new URL('https://example.com'),{},async()=>{calls++;return new Response('',{status:429})},async()=>{});assert.equal(calls,3);
 assert.equal(retryDelay(0,'5'),5000);assert.equal(retryDelay(1,null),2000);
 calls=0;await fetchWithRetry(new URL('https://example.com'),{},async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'120'}})},async()=>{});assert.equal(calls,1);
});

test('transient gateway errors retry while permanent validation errors fail immediately',async()=>{
 for(const status of [502,503,504,400]){
  let calls=0;
  const response=await fetchWithRetry(new URL('https://example.com'),{},async()=>{calls++;return new Response('',{status:calls===1?status:200});},async()=>{});
  assert.equal(calls,status===400?1:2);
  assert.equal(response.status,status===400?400:200);
 }
});
