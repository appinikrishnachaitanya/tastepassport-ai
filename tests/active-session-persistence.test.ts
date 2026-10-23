import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { activeSessionExpiry, ACTIVE_SESSION_LIFETIME_MS, MAX_ACTIVE_SESSION_BYTES, compactActiveSession, parseActiveSession, validSessionId } from "../src/agent/session-lifetime.ts";
import type { AgentState } from "../src/agent/types.ts";

function fixture(): AgentState {
  const now = Date.now();
  return {
    id: randomUUID(),revision:7,expires:activeSessionExpiry(now),
    city:"London",selected:[{id:"trusted-movie",name:"Interstellar",types:["urn:entity:movie"],detail:""}],
    tags:[],constraints:[],categoryConstraints:{},
    cards:[{id:"verified",name:"Current Qloo venue",types:["urn:entity:place"],detail:"",section:"Eat"}],
    previous:[],feedback:[],notices:[],
  };
}
test("active Passport sessions use a 24-hour rolling lease rather than the old 30-minute expiry",()=>{
  const now=Date.now();const expiry=activeSessionExpiry(now);
  assert.equal(ACTIVE_SESSION_LIFETIME_MS,24*60*60_000);
  assert.equal(expiry-now,ACTIVE_SESSION_LIFETIME_MS);
  assert.ok(expiry-now>30*60_000);
});
test("rehydrated session requires exact unpredictable capability ID and nonexpired state",()=>{
  const state=fixture();
  assert.equal(validSessionId(state.id),true);
  assert.equal(validSessionId("test"),false);
  assert.equal(parseActiveSession(state,state.id),state);
  assert.equal(parseActiveSession(state,randomUUID()),undefined);
  assert.equal(parseActiveSession({...state,expires:Date.now()-1},state.id),undefined);
  assert.equal(parseActiveSession({...state,revision:-1},state.id),undefined);
  assert.equal(parseActiveSession({...state,cards:null},state.id),undefined);
  assert.equal(parseActiveSession({id:state.id,revision:3,expires:Date.now()+5000},state.id),undefined);
});
test("active state storage keeps bounded Qloo cards and conversation history without mutating the source",()=>{
  const state=fixture();
  state.cards=Array.from({length:330},(_,i)=>({id:"card-"+i,name:"Card "+i,types:["urn:entity:place"],detail:"",section:"Eat"}));
  state.previous=state.cards.slice(0,100);
  state.savedCards=state.cards.slice(0,120);
  state.notices=Array.from({length:70},(_,i)=>"Status "+i);
  state.history=Array.from({length:90},(_,i)=>({role:"user" as const,text:"Turn "+i}));
  const compact=compactActiveSession(state);
  assert.equal(compact.cards.length,300);
  assert.equal(compact.previous.length,50);
  assert.equal(compact.savedCards?.length,100);
  assert.equal(compact.notices.length,30);
  assert.equal(compact.history?.length,30);
  assert.equal(state.cards.length,330);
  assert.equal(state.history?.length,90);
  assert.equal(compact.selected[0].name,"Interstellar");
  assert.ok(MAX_ACTIVE_SESSION_BYTES<5_000_000);
});
test("both account save endpoints restore trusted active state, never use a browser-supplied snapshot",()=>{
  const sources=[
    "app/api/account/passports/route.ts",
    "app/api/account/plans/route.ts",
    "app/api/account/preferences/route.ts",
  ];
  for(const path of sources){
    const source=readFileSync(new URL("../"+path,import.meta.url),"utf8");
    assert.match(source,/await loadSession\(/,path);
    assert.doesNotMatch(source,/passportSnapshot\(b\.|planFromSession\(b\./,path);
  }
  const startup=readFileSync(new URL("../app/api/passport/route.ts",import.meta.url),"utf8");
  assert.match(startup,/await syncSession\(state\)/);
  const turns=readFileSync(new URL("../src/agent/store.ts",import.meta.url),"utf8");
  assert.match(turns,/await persistActiveSession\(next\.state, revision\)/);
});
test("fresh schema creates active sessions with server-only access and keeps destinations",()=>{
  const sql=readFileSync(new URL("../db-scripts/setup.sql",import.meta.url),"utf8");
  assert.match(sql,/create table public\.active_passport_sessions/i);
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/revoke all on public\.active_passport_sessions from anon, authenticated/i);
  assert.match(sql,/grant select, insert, update, delete on public\.active_passport_sessions to service_role/i);
  assert.match(sql,/create table if not exists public\.destinations/i);
  assert.doesNotMatch(sql,/drop table if exists public\.destinations/i);
  assert.doesNotMatch(sql,/saved_passports_city_check|saved_passports_snapshot_check/i);
  for (const table of ["saved_passports", "saved_plans", "taste_profiles", "active_passport_sessions"])
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.match(sql,/stop_times text\[\]/i);
  assert.doesNotMatch(sql,/drop table if exists auth\.|drop table[^;]*cascade|\bcheck\s*\(/i);
});
