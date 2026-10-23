import "server-only";
import { storageConfigured, storageWriter } from "../account/server.ts";
import { safePassportStorageCode } from "../account/passport-storage-error.ts";
import type { AgentState } from "./types.ts";

import { MAX_ACTIVE_SESSION_BYTES, validSessionId, compactActiveSession, parseActiveSession } from "./session-lifetime.ts";
/** PostgreSQL row is created with a privileged service-role connection only. */
function report(stage: "read" | "write" | "remove", error: unknown) {
  // Never log session identifiers, user preferences, token contents, or DB messages.
  console.error(JSON.stringify({
    event: "session.persistence.failed", stage,
    code: safePassportStorageCode(error),
  }));
}
export async function loadActiveSession(id: string): Promise<AgentState | undefined> {
  if (!storageConfigured() || !validSessionId(id)) return;
  try {
    const { data, error } = await storageWriter()
      .from("active_passport_sessions").select("state")
      .eq("id", id).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw error;
    return parseActiveSession(data?.state, id);
  } catch (error) { report("read", error); throw Error("Passport storage is temporarily unavailable."); }
}
/** Returns false on unavailable storage, throws only for a real revision conflict. */
export async function persistActiveSession(state: AgentState, expectedRevision?: number): Promise<boolean> {
  if (!storageConfigured()) return false;
  const stored = compactActiveSession(state);
  if (Buffer.byteLength(JSON.stringify(stored), "utf8") > MAX_ACTIVE_SESSION_BYTES) {
    report("write", Error("oversized state"));
    return false;
  }
  const fields = {
    state: stored,
    revision: state.revision,
    expires_at: new Date(state.expires).toISOString(),
    updated_at: new Date().toISOString(),
  };
  try {
    if (expectedRevision !== undefined) {
      const { data, error } = await storageWriter()
        .from("active_passport_sessions").update(fields)
        .eq("id", state.id).eq("revision", expectedRevision)
        .gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
      if (error) { report("write", error); return false; }
      if (!data) {
        // If initial best-effort persistence never succeeded, preserve the
        // current in-process Passport rather than misreporting a conflict.
        const { data: existing, error: checkError } = await storageWriter()
          .from("active_passport_sessions").select("revision")
          .eq("id", state.id).maybeSingle();
        if (checkError) { report("write", checkError); return false; }
        if (!existing) return false;
        throw Error("Passport changed. Use the latest state.");
      }
      return true;
    }
    const { error } = await storageWriter()
      .from("active_passport_sessions").upsert({ id: state.id, ...fields }, { onConflict: "id" });
    if (error) { report("write", error); return false; }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "Passport changed. Use the latest state.") throw error;
    report("write", error);
    return false;
  }
}
export async function removeActiveSession(id: string): Promise<void> {
  if (!storageConfigured() || !validSessionId(id)) return;
  try {
    const { error } = await storageWriter().from("active_passport_sessions").delete().eq("id", id);
    if (error) report("remove", error);
  } catch (error) { report("remove", error); }
}
