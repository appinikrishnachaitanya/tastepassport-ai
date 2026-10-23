import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('native response uses configured Vertex model, structured output and no action tools or retries',()=>{
 const output=execFileSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e',`
 import assert from 'node:assert/strict';
 import { configuredProvider } from './src/agent/provider.ts';
 delete process.env.GEMINI_API_KEY;process.env.GOOGLE_API_KEY='test-key-not-real';process.env.GEMINI_MODEL='configured-test-model';
 let calls=0;let fail=false;
 globalThis.fetch=async(url,options)=>{
  calls++;assert.ok(String(url).includes('configured-test-model:generateContent'));
  const body=JSON.parse(options.body);
  assert.equal(body.generationConfig.maxOutputTokens,1024);
  assert.equal(body.generationConfig.responseMimeType,'application/json');
  assert.ok(!body.tools);assert.ok(!body.toolConfig);
  assert.ok(JSON.stringify(body.systemInstruction).includes('NO action tools'));
  assert.ok(!JSON.stringify(body).includes('test-key-not-real'));
  if(fail)return Response.json({}, {status:429});
  return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({message:'What would you like to explore?',evidenceIds:[],recommendationIds:[]})}]},finishReason:'STOP'}]});
 };
 const provider=configuredProvider();assert.ok(provider.compose);
 const context={request:'Hello',passport:{city:'London'},outcome:{changed:[],failed:[],pending:false,fallback:'Hello'},facts:[],choices:[],limitations:[]};
 assert.equal((await provider.compose(context)).message,'What would you like to explore?');assert.equal(calls,1);
 fail=true;await assert.rejects(provider.compose(context),/unavailable/);assert.equal(calls,2);
 delete process.env.GOOGLE_API_KEY;process.env.AGENT_MODEL_API_KEY='test-compatible';process.env.AGENT_MODEL_BASE_URL='https://example.com/v1';process.env.AGENT_MODEL_NAME='compatible';assert.equal(configuredProvider().compose,undefined);
 console.log('Native response PASS');
 `],{cwd:process.cwd(),encoding:'utf8',timeout:30000});
 assert.match(output,/Native response PASS/);
});
