import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultMetrics } from "../app/components/intelligence-evidence.tsx";
import type { Card } from "../src/passport/model.ts";

test("one confirmed taste completes resolution, discovery and saved-profile/snapshot round trips",()=>{
 const output=execFileSync(process.execPath,["--conditions=react-server","--import","tsx","--input-type=module","-e",`
 import assert from 'node:assert/strict';
 import {POST as resolve} from './app/api/agent/resolve/route.ts';
 import {POST as build} from './app/api/passport/route.ts';
 import {passportSnapshot,restoreSnapshot} from './src/account/snapshot.ts';
 import {portableTasteProfile,readTasteProfile} from './src/account/taste-profile.ts';
 import {getSession} from './src/agent/store.ts';
 process.env.QLOO_API_KEY='single-taste-fixture';process.env.LOG_LEVEL='error';delete process.env.SUPABASE_URL;
 const id='00000000-0000-4000-8000-000000000001', match='00000000-0000-4000-8000-000000000002';
 globalThis.fetch=async(url)=>Response.json({results:{entities:new URL(url).pathname==='/search'?[{entity_id:id,name:'Interstellar',types:['urn:entity:movie'],properties:{release_year:2014}}]:[{entity_id:match,name:'Returned film',types:['urn:entity:movie'],query:{affinity:0.7}}]}});
 const resolved=await resolve(new Request('http://localhost/api/agent/resolve',{method:'POST',headers:{Origin:'http://localhost'},body:JSON.stringify({seeds:['Interstellar']})}));
 assert.equal(resolved.status,200);const resolution=await resolved.json();assert.equal(resolution.items.length,1);
 const generated=await build(new Request('http://localhost/api/passport',{method:'POST',headers:{Origin:'http://localhost'},body:JSON.stringify({city:'Toronto',token:resolution.token,ids:[id],activities:['Movies']})}));
 assert.equal(generated.status,200);const passport=await generated.json();assert.equal(passport.selected.length,1);assert.equal(passport.cards.length,1);
 const state=getSession(passport.agent.sessionId);
 assert.equal(restoreSnapshot(passportSnapshot(state)).selected.length,1);
 assert.equal(readTasteProfile(portableTasteProfile(state)).selected.length,1);
 assert.throws(()=>portableTasteProfile({...state,selected:[]}));
 const empty=await build(new Request('http://localhost/api/passport',{method:'POST',headers:{Origin:'http://localhost'},body:JSON.stringify({city:'Toronto',token:resolution.token,ids:[]})}));
 assert.equal(empty.status,400);
 console.log('Single taste round trip PASS');
 `],{cwd:process.cwd(),encoding:"utf8",timeout:30000});
 assert.match(output,/Single taste round trip PASS/);
});
test("consumer cards show returned ratings and never technical price categories",()=>{
 const card={section:"Eat",intelligence:{quality:{businessRating:4.4},commercial:{priceLevel:2}}} as Card;
 const html=renderToStaticMarkup(createElement(ResultMetrics,{card}));
 assert.match(html,/Rated 4.4 out of 5/);
 assert.doesNotMatch(html,/Price category|2 \/ 4|Budget-friendly/);
 const missing=renderToStaticMarkup(createElement(ResultMetrics,{card:{section:"Eat"} as Card}));
 assert.match(missing,/Rating unavailable/);
});
