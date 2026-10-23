import test from 'node:test';
import assert from 'node:assert/strict';
import { planDateError } from '../src/account/plans.ts';
import { matchesDishRequirements } from '../src/passport/dish-evidence.ts';
import type { Card } from '../src/passport/model.ts';
const dish={id:'urn:tag:specialty_dish:place:chicken_biryani',name:'Chicken biryani',types:['urn:tag'],detail:''};
const card=(tags:{id:string;name:string}[]):Card=>({id:'restaurant',name:'Returned restaurant',types:['urn:entity:place'],section:'Eat',detail:'',evidence:{result:{tags}} as Card['evidence']});
test('generic restaurants cannot satisfy an explicit chicken biryani requirement',()=>{
 assert.equal(matchesDishRequirements(card([{id:'urn:tag:cuisine:place:indian',name:'Indian'}]),[dish]),false);
 assert.equal(matchesDishRequirements(card([{id:'urn:tag:specialty_dish:place:biryani',name:'Biryani'}]),[dish]),false);
 assert.equal(matchesDishRequirements(card([{id:dish.id,name:dish.name}]),[dish]),true);
 assert.equal(matchesDishRequirements(card([]),[]),true);
});
test('download and persistence share valid destination-local future date checks',()=>{
 const now=new Date('2026-10-21T12:00:00Z');
 assert.match(planDateError('London','2026-10-01',now)!,/today or a future/);
 assert.equal(planDateError('London','2026-10-21',now),undefined);
 assert.equal(planDateError('London','2026-10-24',now),undefined);
 assert.match(planDateError('London','2026-02-30',now)!,/valid date/);
 assert.match(planDateError('London','',now)!,/valid date/);
 assert.equal(planDateError('Toronto','2026-10-20',new Date('2026-10-21T00:30:00Z')),undefined);
 assert.match(planDateError('Tokyo','2026-10-20',new Date('2026-10-21T00:30:00Z'))!,/future/);
});
test('a fresh misspelled biryani request cannot publish unrelated restaurant cards',async()=>{
 const {runTurn}=await import('../src/agent/orchestrator.ts');
 const {normalizeSession}=await import('../src/agent/session.ts');
 const original=normalizeSession({id:'dish-regression',revision:0,expires:Date.now()+60000,city:'London',selected:[],tags:[],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[],activeCategories:['Eat']});
 const reply=await runTurn(original,{message:'i want chicken birayni'},{tools:async()=>[],workflow:async()=>({status:'ok',results:[{id:dish.id,name:dish.name,type:'urn:tag:specialty_dish:place'}]}),discover:async()=>['ChinaTownE14',"Muriel’s Kitchen","Lola’s Cupcakes"].map((name,index)=>({id:`generic-${index}`,name,section:'Eat',types:['urn:entity:place'],detail:''}))});
 assert.deepEqual(reply.changed,[]);assert.deepEqual(reply.state.cards,[]);assert.doesNotMatch(reply.message,/Updated Food/);
 assert.ok(reply.state.failedSearches?.Eat?.categoryTags?.includes(dish.id));
});
