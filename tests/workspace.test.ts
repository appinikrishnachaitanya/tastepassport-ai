import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractDraft } from '../src/workspace/state.ts';
import { PassportSections, TranslationMap } from '../app/components/passport.tsx';
import { CandidateChoices } from '../app/components/disambiguation.tsx';
import type { Candidate } from '../src/passport/model.ts';
import type { Passport } from '../src/workspace/state.ts';
// Isolated UI protocol fixtures. Never imported by the production app.
const signal:Candidate={id:'test-id',name:'Protocol signal',types:['urn:entity:artist'],detail:'Test metadata'};
const partial:Passport={city:'New York City',selected:[signal],cards:[{...signal,id:'result-id',name:'Protocol result',section:'Music'}],notices:['Local places: test query failed'],explanation:'Test explanation'};
test('conversation produces a reviewable draft without inferring entities',()=>{
 const d=extractDraft("I'm moving to New York. I love A.R. Rahman, Interstellar and Blue Tokai.",'Paris');
 assert.equal(d.city,'New York City');assert.deepEqual(d.tastes,['A.R. Rahman','Interstellar','Blue Tokai']);
 assert.deepEqual(extractDraft('Biryani\nCoffee\nBooks','London').tastes,['Biryani','Coffee','Books']);
});
test('disambiguation renders all choices with accessible labels and no implicit selection',()=>{
 const html=renderToStaticMarkup(createElement(CandidateChoices,{query:'Test query',candidates:[signal,{...signal,id:'second',types:['urn:entity:person']}],onSelect:()=>{}}));
 assert.match(html,/Matches for Test query/);assert.equal((html.match(/type="radio"/g)??[]).length,2);assert.doesNotMatch(html,/checked/);assert.match(html,/artist/);assert.match(html,/person/);
});
test('empty result sections do not fabricate cards or category headers',()=>{
 const html=renderToStaticMarkup(createElement(PassportSections,{result:{...partial,cards:[],notices:[]},feedback:{},onFeedback:()=>{}}));assert.match(html,/No suitable discoveries yet/);assert.doesNotMatch(html,/section-Eat|section-Music|discovery-card/);
});
test('partial category failures preserve real available results and feedback semantics',()=>{
 const html=renderToStaticMarkup(createElement(PassportSections,{result:partial,feedback:{'result-id':'dislike'},onFeedback:()=>{}}));assert.match(html,/Protocol result/);assert.match(html,/query gaps|few gaps/);assert.match(html,/Local places: test query failed/);assert.doesNotMatch(html,/section-Eat/);assert.match(html,/aria-pressed="true"/);assert.match(html,/haven’t been replanned/);
});
test('translation map shows only returned categories and explicitly collective provenance',()=>{
 const html=renderToStaticMarkup(createElement(TranslationMap,{signals:[signal],result:partial}));assert.match(html,/Protocol signal/);assert.match(html,/Music/);assert.doesNotMatch(html,/map-target[^]*Coffee/);assert.match(html,/Individual taste-to-place links are not provided/);
});
