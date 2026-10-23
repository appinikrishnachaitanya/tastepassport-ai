import test from "node:test";
import assert from "node:assert/strict";
import {parseAnalysis, selectAnalysisSignals} from "../src/qloo/analysis.ts";
import {interpret} from "../src/agent/intent.ts";
const artist="00000000-0000-4000-8000-000000000001";
const movie="00000000-0000-4000-8000-000000000002";
const cuisine="urn:tag:cuisine:qloo:indian";
const selected=[{id:artist},{id:movie},{id:cuisine}];

test("insights use only the confirmed subset chosen by the user",()=>{
  assert.deepEqual(selectAnalysisSignals(selected,[movie]),{entities:[movie],tags:[]});
  assert.deepEqual(selectAnalysisSignals(selected,[cuisine,artist]),{entities:[artist],tags:[cuisine]});
  for(const ids of [[],[artist,artist],[artist,"invented"],[cuisine,"urn:tag:cuisine:qloo:invented"],[1],null]) {
    assert.throws(()=>selectAnalysisSignals(selected,ids));
  }
});
test("returned themes are unique by meaning, not permutations or tag IDs",()=>{
  const parsed=parseAnalysis("taste",{results:{tags:[
    {tag_id:"urn:tag:cuisine:qloo:indian",name:"Indian Cuisine",query:{affinity:0.6}},
    {tag_id:"urn:tag:cuisine:place:indian",name:"Indian food",query:{affinity:0.75}},
    {tag_id:"urn:tag:genre:qloo:jazz",name:"Jazz",query:{affinity:0.5}},
    {tag_id:"urn:tag:genre:qloo:jazz_alt",name:"Jazz",query:{affinity:0.1}},
  ]}});
  assert.equal(parsed.kind,"taste");
  if(parsed.kind!=="taste")return;
  assert.equal(parsed.tags.length,2);
  assert.equal(parsed.tags[0].name,"Indian food");
  assert.equal(parsed.tags[1].name,"Jazz");
});
test("plain requests for Indian restaurants select dining and Indian cuisine",()=>{
  const intent=interpret("Show me Indian restaurants","Toronto");
  assert.deepEqual(intent.sections,["Eat"]);
  assert.deepEqual(intent.concepts,["Indian cuisine"]);
  assert.equal(intent.kind,"refine");
});
