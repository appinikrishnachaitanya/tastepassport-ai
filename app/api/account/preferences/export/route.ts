import { accountClient, storageConfigured, privateJson } from "../../../../../src/account/server";
import { exportTasteProfile, validProfileId } from "../../../../../src/account/profile-record";
import { debugRequest } from "../../../../../src/agent/debug";
export function GET(request: Request) {
  return debugRequest("account.preferences", async () => {
    if (!storageConfigured()) return privateJson({error:"Profile storage is unavailable."},503);
    try {
      const client = await accountClient();
      const {data:{user},error:authError} = await client.auth.getUser();
      if (authError || !user) return privateJson({error:"Sign in to export your profiles."},401);
      const id = new URL(request.url).searchParams.get("id");
      if (id && !validProfileId(id)) return privateJson({error:"Invalid profile identifier."},400);
      let query = client.from("taste_profiles").select("id,name,updated_at,profile").eq("user_id",user.id).order("updated_at",{ascending:false});
      if (id) query = query.eq("id",id);
      const {data,error} = await query;
      if (error) throw Error();
      if (id && !data?.length) return privateJson({error:"Profile not found."},404);
      const profiles = (data ?? []).map(exportTasteProfile);
      return Response.json({schema:"tastepassport.profile-export",version:1,profiles},{headers:{
        "Cache-Control":"private, no-store",Vary:"Cookie","Content-Disposition":'attachment; filename="tastepassport-profiles.json"',
      }});
    } catch { return privateJson({error:"Profiles could not be exported. Please retry."},503); }
  });
}
