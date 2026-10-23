import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("reconnection reads trusted state, rejects bad/cross-site requests and reports expired sessions",()=>{
 const output=execFileSync(process.execPath,["--conditions=react-server","--import","tsx","--input-type=module","-e",`
 import assert from 'node:assert/strict';
 import { POST } from './app/api/agent/session/route.ts';
 import { createSession } from './src/agent/store.ts';
 delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 const session=createSession({city:'London',selected:[],cards:[],notices:[],explanation:''});
 const request=(body,origin='http://localhost')=>new Request('http://localhost/api/agent/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
 const response=await POST(request({sessionId:session.id}));
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.passport.city,'London');
 assert.equal(data.passport.agent.sessionId,session.id);
 assert.ok(response.headers.get('cache-control').includes('no-store'));
 assert.equal((await POST(request({sessionId:'invalid'}))).status,400);
 assert.equal((await POST(request({sessionId:session.id},'https://other.example'))).status,403);
 assert.equal((await POST(request({sessionId:'11111111-1111-4111-8111-111111111111'}))).status,410);
 console.log('Reconnect PASS');
 `],{cwd:process.cwd(),encoding:"utf8",timeout:15000});
 assert.match(output,/Reconnect PASS/);
});
