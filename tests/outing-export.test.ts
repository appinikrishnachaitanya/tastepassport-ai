import test from 'node:test';
import assert from 'node:assert/strict';
import { dayOutText, type OutingExportStop } from '../src/passport/day-out.ts';
import type { Card } from '../src/passport/model.ts';
const venue=(name:string,section:Card['section']):Card=>({id:name,name,section,types:['urn:entity:place'],detail:'',address:`${name} address`});
const stops:OutingExportStop[]=[
 {activity:'Culture',time:'11:00',card:venue('Gallery','Culture')},
 {activity:'Cinema',time:'14:00',card:venue('Prince Charles Cinema','Culture')},
 {activity:'Eat',time:'18:30',card:venue('Dinner venue','Eat')},
];
test('complete export preserves chosen activities, order, times, date and venue details',()=>{
 const text=dayOutText('London',stops,'2026-10-24','Europe/London');
 assert.match(text,/Complete plan · 3\/3 stops chosen/);
 assert.match(text,/Planned for 2026-10-24/);assert.match(text,/Europe\/London/);
 assert.match(text,/1\. 11:00 · Culture — Gallery/);
 assert.match(text,/2\. 14:00 · Cinema — Prince Charles Cinema/);
 assert.match(text,/3\. 18:30 · Food — Dinner venue/);
 assert.doesNotMatch(text,/Prince Charles Cinema \(Culture\)/);
 assert.match(text,/Prince Charles Cinema address/);assert.match(text,/No booking has been made/);
});
test('partial export retains the open Food stop and its scheduled place in the itinerary',()=>{
 const partial=stops.map(stop=>stop.activity==='Eat'?{...stop,card:undefined}:stop);
 const text=dayOutText('London',partial,'2026-10-24','Europe/London');
 assert.match(text,/Partial plan · 2\/3 stops chosen/);
 assert.match(text,/2\. 14:00 · Cinema — Prince Charles Cinema/);
 assert.match(text,/3\. 18:30 · Food — Place not chosen \(open stop\)/);
 assert.doesNotMatch(text,/Dinner venue/);
});
test('moving an open stop preserves its label and time in the exported order',()=>{
 const text=dayOutText('London',[{activity:'Eat',time:'10:00'},stops[1],{activity:'Nightlife',time:'22:00'}]);
 assert.match(text,/Partial plan · 1\/3 stops chosen/);
 assert.match(text,/1\. 10:00 · Food — Place not chosen/);
 assert.match(text,/2\. 14:00 · Cinema — Prince Charles Cinema/);
 assert.match(text,/3\. 22:00 · Nightlife — Place not chosen/);
});
