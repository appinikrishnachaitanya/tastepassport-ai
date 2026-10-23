/** Real app HTTP routes with an isolated synthetic Supabase server. No live account claims. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { portableTasteProfile } from "../src/account/taste-profile.ts";
const owner="11111111-1111-4111-8111-111111111111";
const ownId="22222222-2222-4222-8222-222222222222";
const otherId="33333333-3333-4333-8333-333333333333";
const user={id:owner,email:"fixture@example.test",aud:"authenticated",role:"authenticated",identities:[{id:owner,provider:"email"}],app_metadata:{},user_metadata:{}};
const selected=[1,2,3].map(n=>({id:`00000000-0000-4000-8000-00000000000${n}`,name:`Fixture ${n}`,types:["urn:entity:movie"],detail:""}));
const profile=portableTasteProfile({id:"private-session",city:"Private old city",revision:0,expires:0,selected,tags:[],constraints:[],categoryConstraints:{},cards:[],previous:[],feedback:[],notices:[]});
const row={id:ownId,user_id:owner,name:"Weekend films",updated_at:"2026-10-18T00:00:00Z",profile};
let assertions=0;
const stub=createServer((req,res)=>{
  const url=new URL(req.url,"http://127.0.0.1");
  res.setHeader("content-type","application/json");
  if(url.pathname==="/auth/v1/user")return res.end(JSON.stringify(user));
  if(url.pathname==="/auth/v1/signup")return res.end(JSON.stringify({...user,identities:[]}));
  if(url.pathname==="/rest/v1/taste_profiles") {
    try {assert.equal(url.searchParams.get("user_id"),`eq.${owner}`);assertions++;}
    catch {res.statusCode=400;return res.end(JSON.stringify({message:"Missing ownership filter"}));}
    const id=url.searchParams.get("id");
    return res.end(JSON.stringify(!id || id===`eq.${ownId}`?[row]:[]));
  }
  res.statusCode=404;res.end("{}");
});
await new Promise(resolve=>stub.listen(0,"127.0.0.1",resolve));
const supabaseUrl=`http://127.0.0.1:${stub.address().port}`;
const appPort=4322,base=`http://127.0.0.1:${appPort}`;
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(appPort)],{
  env:{...process.env,SUPABASE_URL:supabaseUrl,SUPABASE_PUBLISHABLE_KEY:"synthetic-public-key",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service-key"},stdio:"ignore",
});
try {
  let ready=false;
  for(let i=0;i<80;i++) {
    try {if((await fetch(base+"/api/health")).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  assert.ok(ready,"Synthetic app server must start");
  const unauth=await fetch(base+"/api/account/preferences/export");
  assert.equal(unauth.status,401);
  const cookies=[];
  const auth=createServerClient(supabaseUrl,"synthetic-public-key",{cookies:{getAll:()=>cookies,setAll:values=>{cookies.splice(0,cookies.length,...values);}}});
  const part=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const token=`${part({alg:"HS256",typ:"JWT"})}.${part({sub:owner,exp:Math.floor(Date.now()/1000)+1800,role:"authenticated",aud:"authenticated"})}.fixture`;
  const set=await auth.auth.setSession({access_token:token,refresh_token:"synthetic-refresh"});
  assert.equal(set.error,null);
  const headers={cookie:cookies.map(c=>`${c.name}=${c.value}`).join("; ")};
  const exported=await fetch(base+`/api/account/preferences/export?id=${ownId}`,{headers});
  assert.equal(exported.status,200);
  assert.match(exported.headers.get("cache-control"),/private, no-store/);
  assert.match(exported.headers.get("content-disposition"),/attachment/);
  const data=await exported.json();
  assert.equal(data.profiles[0].name,"Weekend films");
  assert.doesNotMatch(JSON.stringify(data),/fixture@example|private-session|Private old city|user_id|access_token|refresh_token/);
  assert.equal((await fetch(base+`/api/account/preferences/export?id=${otherId}`,{headers})).status,404);
  assert.equal((await fetch(base+"/api/account/preferences/export?id=invalid",{headers})).status,400);
  const list=await(await fetch(base+"/api/account/preferences",{headers})).json();
  assert.equal(list.profiles[0].name,"Weekend films");
  const duplicate=await fetch(base+"/api/account",{method:"POST",headers:{"content-type":"application/json",origin:base},body:JSON.stringify({action:"register",email:user.email,password:"Fixture-only-12345",firstName:"Protocol",lastName:"Tester"})});
  assert.equal(duplicate.status,409);
  assert.equal((await duplicate.json()).signInRequired,true);
  assert.ok(assertions>=3);
  console.log("Profile API contract PASS (synthetic Supabase): authenticated export, explicit ownership, cross-owner denial, no-store/download, private field exclusion, named list and duplicate registration.");
} finally {child.kill("SIGTERM");await new Promise(resolve=>stub.close(resolve));}
