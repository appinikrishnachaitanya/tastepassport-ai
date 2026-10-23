import { readRequestText } from "../../../../src/http/request.ts";
import { profileName, validProfileId } from "../../../../src/account/profile-record";
import { suggestedSections } from "../../../../src/passport/routing";
import { catalogCity } from "../../../../src/workspace/destinations";
import { accountClient, storageConfigured, storageWriter, privateJson, sameOrigin } from "../../../../src/account/server";
import { portableTasteProfile, readTasteProfile } from "../../../../src/account/taste-profile";
import { createSession, loadSession, syncSession } from "../../../../src/agent/store";
import { normalizeSession } from "../../../../src/agent/session";
import { discoverSection } from "../../../../src/agent/runtime";
import { passportView, sectionOrder } from "../../../../src/workspace/state";
import { debugRequest } from "../../../../src/agent/debug";
import { assertSessionWriteCommitted } from "../../../../src/agent/session-lifetime";
export const runtime = "nodejs";

async function handle(request: Request) {
  if (request.method !== "GET" && !sameOrigin(request)) return privateJson({error:"Please use this app."},403);
  if (!storageConfigured()) return privateJson({error:"Reusable tastes need account storage to be configured."},503);
  try {
    const client = await accountClient();
    const {data:{user},error:authError} = await client.auth.getUser();
    if (authError || !user) return privateJson({error:"Sign in to use saved tastes."},401);
    let body: Record<string,unknown> = {};
    if (request.method !== "GET") {
      const raw = await readRequestText(request, 1400);
      if (raw.length > 1400) return privateJson({error:"Invalid taste profile request."},400);
      body = raw ? JSON.parse(raw) : {};
    }
    if (body.profileId !== undefined && !validProfileId(body.profileId)) return privateJson({error:"Choose a valid profile."},400);
    if (request.method === "DELETE") {
      if (!validProfileId(body.profileId)) return privateJson({error:"Choose the profile to remove."},400);
      const {error} = await client.from("taste_profiles").delete().eq("user_id",user.id).eq("id",body.profileId);
      if (error) throw Error();
      return privateJson({deleted:true});
    }
    if (body.action === "save") {
      if (typeof body.sessionId !== "string" || !Number.isInteger(body.revision)) return privateJson({error:"Build a Passport first."},400);
      const state = await loadSession(body.sessionId);
      if (state.revision !== body.revision) return privateJson({error:"Your Passport changed. Save its latest tastes."},409);
      let name: string;
      try { name = profileName(body.name); } catch { return privateJson({error:"Use a profile name of 1–80 characters."},400); }
      const profile = portableTasteProfile(state);
      const {data:saved,error} = await storageWriter().from("taste_profiles").upsert({user_id:user.id,name,profile,updated_at:new Date().toISOString()},{onConflict:"user_id,name"}).select("id,name,updated_at,profile").single();
      if (error) throw Error();
      return privateJson({saved:true,profile,entry:saved});
    }
    const {data:rows,error} = await client.from("taste_profiles").select("id,name,updated_at,profile").eq("user_id",user.id).order("updated_at",{ascending:false});
    if (error) throw Error();
    const profiles = (rows ?? []).map(row=>({...row,profile:readTasteProfile(row.profile)}));
    if (request.method === "GET") return privateJson({profiles,profile:profiles[0]?.profile ?? null});
    const data = body.profileId ? profiles.find(row=>row.id===body.profileId) : profiles[0];
    const city = body.action === "apply" ? await catalogCity(body.city) : undefined;
    if (body.action !== "apply" || !city) return privateJson({error:"Choose a supported destination."},400);
    if (!data) return privateJson({error:"Save your tastes from a Passport first."},404);
    const profile = readTasteProfile(data.profile);
    const initial = {city,selected:profile.selected,cards:[],notices:[] as string[],explanation:"Fresh discoveries using your saved tastes."};
    const working = normalizeSession({...profile,id:"profile-discovery",revision:0,expires:0,city,cards:[],previous:[],feedback:[],notices:[...initial.notices]});
    const desired = profile.activeCategories.length ? profile.activeCategories : suggestedSections(profile.selected);
    const sections = sectionOrder.filter(section=>!profile.hiddenCategories.includes(section) &&
      (desired.includes(section) || Boolean(profile.categoryTags[section]?.length) || Boolean(profile.queryPreferences[section])));
    const signal = AbortSignal.any([request.signal,AbortSignal.timeout(75000)]);
    const results = await Promise.all(sections.map(async section=>{
      try {
        const local=normalizeSession(structuredClone(working));
        local.intent={kind:"refine",seeds:[],concepts:profile.categoryConcepts[section] ?? [],constraints:profile.categoryConstraints[section] ?? profile.constraints,sections:[section],strategy:"discover"};
        const found=await discoverSection(local,section,local.intent.constraints,[],false,signal);
        working.notices.push(...local.notices.filter(notice=>!working.notices.includes(notice)));
        return found;
      }
      catch { working.notices.push(`${section} could not be refreshed with your saved preferences.`); return []; }
    }));
    signal.throwIfAborted();
    const cards = [...new Map(results.flat().map(c=>[c.id,c])).values()];
    const state = createSession({...initial,cards,notices:working.notices},profile.constraints);
    Object.assign(state,profile);
    const persisted = await syncSession(state);
    assertSessionWriteCommitted(storageConfigured(), persisted);
    return privateJson({passport:passportView(state,"Fresh discoveries using your reusable taste profile.")});
  } catch {
    return privateJson({error:"Saved tastes are temporarily unavailable. If this is new, apply the taste_profiles database migration. Your current Passport is preserved."},503);
  }
}
export function GET(request: Request) { return debugRequest("account.preferences",()=>handle(request)); }
export function POST(request: Request) { return debugRequest("account.preferences",()=>handle(request)); }
export function DELETE(request: Request) { return debugRequest("account.preferences",()=>handle(request)); }
