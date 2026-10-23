import { browserRequestError, readRequestText } from "../../../src/http/request.ts";
import { debugRequest } from "../../../src/agent/debug";
import { NextResponse } from 'next/server';
import { resolve } from '../../../src/passport/service.ts';
import { QlooError } from '../../../src/qloo/client.ts';
async function handlePOST(request:Request){
  const rejected = browserRequestError(request);
  if (rejected) return rejected;
  try{const raw=await readRequestText(request, 3000);if(raw.length>3000)return NextResponse.json({error:'Input is too long.'},{status:400});const body=JSON.parse(raw);const seeds=body.seeds;
    if(!Array.isArray(seeds)||seeds.length<1||seeds.length>5||seeds.some(s=>typeof s!=='string'||!s.trim()||s.length>100)||new Set(seeds.map(s=>s.trim().toLowerCase())).size!==seeds.length)return NextResponse.json({error:'Enter one to five different tastes, up to 100 characters each.'},{status:400});
    return NextResponse.json(await resolve(seeds.map(s=>s.trim())),{headers:{'Cache-Control':'no-store'}});
  }catch(e){return NextResponse.json({error:e instanceof QlooError?(e.status===429?'Qloo is busy. Please wait a moment and try again.':e.message):'Could not resolve tastes. Please try again.'},{status:e instanceof QlooError&&e.status===400?400:e instanceof QlooError&&e.status===429?429:502});}
}

export function POST(request: Request) {
  return debugRequest("resolve", () => handlePOST(request));
}
