import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, type Card } from '../src/passport/model.ts';
import { relevantThemes } from '../src/passport/taste-themes.ts';
import { activityMatches } from '../src/passport/day-out.ts';

test('Together choices expose type/year, omit placeholders and collapse indistinguishable copies',()=>{
 const results=candidates([
  {entity_id:'a',name:'Toy Story',types:['urn:entity:movie'],properties:{release_year:1995,short_description:'None'}},
  {entity_id:'b',name:'Toy Story None',types:['urn:entity:movie'],properties:{release_year:1995,short_description:'null'}},
  {entity_id:'c',name:'Toy Story',types:['urn:entity:video_game'],properties:{release_year:1995}},
  {entity_id:'d',name:'Toy Story',types:['urn:entity:movie'],properties:{release_year:2025}},
 ]);
 assert.equal(results.length,3);
 assert.deepEqual(results.map(item=>item.detail),['movie · 1995','video game · 1995','movie · 2025']);
 assert.ok(results.every(item=>! /None|null/.test(item.name+item.detail)));
});
test('film themes reject unrelated food/place and generic labels without manufacturing replacements',()=>{
 const tags=[['genre:media:science_fiction','Science fiction'],['genre:media:classics','Classics'],['category:place:bar','Bar'],['specialty_dish:place:cubano','Cubano Sandwich'],['style:media:indie','indie'],['theme:media:ambitious','Ambitious']].map(([id,name])=>({id:`urn:tag:${id}`,name}));
 assert.deepEqual(relevantThemes(tags,[{id:'film',types:['urn:entity:movie']}]).map(tag=>tag.name),['Science fiction']);
 assert.deepEqual(relevantThemes(tags.slice(1),[{id:'film',types:['urn:entity:movie']}]),[]);
 assert.ok(relevantThemes(tags,[{id:'urn:tag:cuisine:place:indian',types:['urn:tag']}]).some(tag=>tag.name==='Cubano Sandwich'));
});
const cinema=(name:string,address:string|undefined,description?:string):Card=>({id:'venue',name,section:'Culture',types:['urn:entity:place'],detail:'',address,description,evidence:{result:{tags:[{name:'Movie theater'}]}} as Card['evidence']});
test('Cinema rejects a tagged square and requires a specific venue identity and address',()=>{
 assert.equal(activityMatches(cinema('Leicester Square','Leicester Square, London'),'Cinema'),false);
 assert.equal(activityMatches(cinema('Leicester Square','Leicester Square, London','An area known for cinema'),'Cinema'),false);
 assert.equal(activityMatches(cinema('ODEON Luxe Leicester Square','22-24 Leicester Square, London'),'Cinema'),true);
 assert.equal(activityMatches(cinema('BFI Southbank','Belvedere Road, London','A cinema screening classic films'),'Cinema'),true);
 assert.equal(activityMatches(cinema('ODEON',undefined),'Cinema'),false);
 assert.equal(activityMatches(cinema('Community Hall','A street, London'),'Cinema'),false);
});
