import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { turnFailure } from "../src/agent/turn-failure.ts";

test("turn failures distinguish missing/expired sessions, storage failures and stale revisions",()=>{
 assert.equal(turnFailure(Error("session expired")).code,"SESSION_EXPIRED");
 assert.equal(turnFailure(Error("Your Passport session is no longer available")).code,"SESSION_MISSING");
 assert.equal(turnFailure(Error("Passport storage is temporarily unavailable")).code,"STORAGE_UNAVAILABLE");
 assert.equal(turnFailure(Error("Passport changed. Use the latest state.")).code,"SESSION_CHANGED");
 assert.equal(turnFailure(Error("provider internal details")).code,"TEMPORARILY_UNAVAILABLE");
 assert.ok(!turnFailure(Error("provider internal details")).message.includes("internal"));
});
test("a trusted persisted Passport rehydrates after process-memory loss; database downtime is not expiry",()=>{
 const result=execFileSync(process.execPath,["--conditions=react-server","--import","tsx","--input-type=module","-e",`
 import assert from 'node:assert/strict';
 process.env.SUPABASE_URL='https://session-fixture.example.test';
 process.env.SUPABASE_PUBLISHABLE_KEY='fixture-public';
 process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-service';
 let row, down=false;
 globalThis.fetch=async(url,init)=>{
  if(down)return Response.json({code:'PGRST205',message:'Fixture unavailable'},{status:503});
  if(init?.method==='POST'){row=JSON.parse(init.body);return new Response(null,{status:201});}
  return Response.json(row?[row]:[]);
 };
 const {createSession,syncSession,loadSession}=await import('./src/agent/store.ts');
 const current=createSession({city:'London',selected:[],cards:[],notices:[],explanation:''});
 current.revision=3;
 assert.equal(await syncSession(current),true);
 globalThis.tastePassportSessions.clear();
 globalThis.tastePassportDurableIds.clear();
 const restored=await loadSession(current.id);
 assert.equal(restored.id,current.id);
 assert.equal(restored.revision,3);
 assert.equal(restored.city,'London');
 globalThis.tastePassportSessions.clear();
 down=true;
 await assert.rejects(loadSession(current.id),/storage is temporarily unavailable/);
 down=false; row=undefined;
 await assert.rejects(loadSession(current.id),/session is no longer available/);
 console.log('Restart recovery PASS');
 `],{cwd:process.cwd(),encoding:"utf8",timeout:15000});
 assert.match(result,/Restart recovery PASS/);
});
