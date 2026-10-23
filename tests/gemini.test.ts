import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("native Gemini SDK uses function declarations, validates selections, provides tool-free baseline and safe logs", () => {
  const output = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
import assert from 'node:assert/strict';
import { configuredProvider } from './src/agent/provider.ts';
import { debugEvent } from './src/agent/debug.ts';
delete process.env.GOOGLE_API_KEY;process.env.GEMINI_API_KEY='native-test-secret';process.env.GEMINI_MODEL='gemini-2.5-flash';process.env.AGENT_MODEL_BASE_URL='invalid-unused-base';process.env.QLOO_API_KEY='qloo-test-secret';process.env.AGENT_DEBUG='1';
const logs=[];console.info=console.error=(line)=>logs.push(JSON.parse(line));const requests=[];let bad=false,fail=false;
globalThis.fetch=async (url,options)=>{
 assert.equal(String(url),'https://aiplatform.googleapis.com/v1/publishers/google/models/'+(process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite')+':generateContent');
 assert.equal(new Headers(options.headers).get('x-goog-api-key'),process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
 const body=JSON.parse(options.body);requests.push(body);
 assert.ok(!JSON.stringify(body).includes('native-test-secret'));
 if(fail)return new Response('{}',{status:429,headers:{'content-type':'application/json'}});
 const tool=body.tools?.[0]?.functionDeclarations?.[0];
 const parts=tool?[{functionCall:{name:bad?'invented_tool':tool.name,args:tool.name==='interpret_cultural_intent'?{kind:'refine',seeds:[],concepts:['art'],constraints:[],sections:['Culture'],strategy:'discover',affinity:99}:tool.name==='explain_qloo_evidence'?{indices:[0,2]}:{query:'art',limit:5}}}]:[{text:'Unverified model-only suggestion'}];
 return Response.json({candidates:[{content:{role:'model',parts},finishReason:'STOP'}]});
};
const provider=configuredProvider();
const intent=await provider.interpret('Find art in Toronto',{city:'Toronto',history:[{role:'user',text:'Find vegetarian dining'},{role:'agent',text:'Updated dining suggestions'},{role:'agent',text:'Guided filter changed'}],categories:[{section:'Eat',preferences:{priceMax:2},constraints:[],concepts:[],requirements:['Vegetarian'],exclusions:[],resultCount:3}]});assert.deepEqual(requests[0].contents.map(m=>m.role),['user','model','user']);assert.equal(requests[0].contents[1].parts.length,2);const envelope=JSON.parse(requests[0].contents[2].parts[0].text);assert.equal(envelope.passport.categories[0].preferences.priceMax,2);assert.ok(!envelope.passport.history);assert.deepEqual(intent.sections,['Culture']);assert.ok(!('affinity' in intent));assert.equal(requests[0].toolConfig.functionCallingConfig.mode,'ANY');assert.equal(requests[0].generationConfig.temperature,1);assert.equal(requests[0].generationConfig.maxOutputTokens,4096);
const choices=await provider.choose('Find art',{city:'Toronto',selected:[],cards:[],feedback:[],intent},[{name:'qloo_find_tags',inputSchema:{type:'object',properties:{query:{type:'string'}}}}]);assert.equal(choices[0].name,'qloo_find_tags');assert.equal(requests[1].toolConfig.functionCallingConfig.mode,'AUTO');assert.ok(requests[1].tools[0].functionDeclarations[0].parametersJsonSchema);
const request='Find art in Toronto';const baseline=await provider.baseline('Toronto',['Interstellar'],request);assert.equal(baseline.request,request);assert.equal(baseline.model,'gemini-2.5-flash');assert.ok(!requests[2].tools);assert.equal(requests[2].generationConfig.temperature,1);assert.equal(requests[2].generationConfig.maxOutputTokens,1024);assert.equal(JSON.parse(requests[2].contents[0].parts[0].text).request,request);
const selectedFacts=await provider.explain(['Returned rating 4.5','Returned price category 2','Returned contribution 0.4']);assert.deepEqual(selectedFacts,[0,2]);assert.equal(requests[3].tools[0].functionDeclarations[0].name,'explain_qloo_evidence');
bad=true;await assert.rejects(provider.interpret('Find art'),/Model provider unavailable/);bad=false;fail=true;await assert.rejects(provider.interpret('Find art'),/Model provider unavailable/);assert.ok(logs.some(l=>l.event==='gemini.failed'&&l.status===429));
debugEvent('qloo.result',{tool:'native-test-secret',count:-1,trace:'qloo-test-secret'});
assert.ok(logs.some(l=>l.event==='gemini.request'));assert.ok(logs.some(l=>l.event==='gemini.tool_selected'&&l.tool==='qloo_find_tags'));
assert.ok(!JSON.stringify(logs).includes('native-test-secret'));assert.ok(!JSON.stringify(logs).includes('qloo-test-secret'));assert.ok(!JSON.stringify(logs).includes('Find art'));assert.ok(!JSON.stringify(logs).includes('invented_tool'));
delete process.env.GEMINI_MODEL;fail=false;assert.equal((await configuredProvider().baseline('Toronto',[],request)).model,'gemini-3.1-flash-lite');
process.env.GOOGLE_API_KEY='vertex-google-test-secret';assert.ok(await configuredProvider().baseline('Toronto',[],request));assert.ok(!JSON.stringify(logs).includes('vertex-google-test-secret'));delete process.env.GOOGLE_API_KEY;
delete process.env.GEMINI_API_KEY;process.env.AGENT_MODEL_API_KEY='compat-test-secret';process.env.AGENT_MODEL_BASE_URL='https://compatible.example/v1';process.env.AGENT_MODEL_NAME='compat-model';let compatBody;
globalThis.fetch=async(_url,options)=>{compatBody=JSON.parse(options.body);return Response.json({choices:[{message:{tool_calls:[{function:{name:'interpret_cultural_intent',arguments:JSON.stringify({kind:'refine',seeds:[],concepts:[],constraints:[],sections:['Eat'],strategy:'discover'})}}]}}]});};
await configuredProvider().interpret('Find dining',{city:'Toronto',history:[{role:'user',text:'prior cultural memory'}],tastes:['prior taste']});assert.equal(compatBody.messages.length,2);assert.equal(compatBody.messages[1].content,'Find dining');assert.ok(!JSON.stringify(compatBody).includes('prior cultural memory'));assert.ok(!JSON.stringify(compatBody).includes('prior taste'));
console.log('Native Gemini PASS');
`], { cwd:process.cwd(), encoding:"utf8",timeout:30000 });
  assert.match(output,/Native Gemini PASS/);
});
