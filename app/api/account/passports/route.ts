import { readRequestText } from "../../../../src/http/request.ts";
import { debugRequest } from "../../../../src/agent/debug";
import { assertSessionWriteCommitted } from "../../../../src/agent/session-lifetime";
import { passportStorageFailure, type PassportStorageStage } from "../../../../src/account/passport-storage-error";
import {
  accountClient,
  accountConfigured,
  storageConfigured,
  storageWriter,
  sameOrigin,
  privateJson,
} from "../../../../src/account/server";
import { loadSession, syncSession } from "../../../../src/agent/store";
import {
  passportSnapshot,
  restoreSnapshot,
} from "../../../../src/account/snapshot";
import { registerRestoredSession } from "../../../../src/agent/store";
import { passportView } from "../../../../src/workspace/state";
export const runtime = "nodejs";
async function handleGET() {
  if (!accountConfigured())
    return privateJson({ error: "Accounts are not configured." }, 503);
  try {
    const client = await accountClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user)
      return privateJson({ error: "Please sign in." }, 401);
    const { data, error } = await client
      .from("saved_passports")
      .select("id,city,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) return failedPassportOperation("list", error);
    return privateJson({ passports: data });
  } catch {
    return privateJson(
      { error: "Saved Passports are temporarily unavailable." },
      503,
    );
  }
}
function failedPassportOperation(stage: PassportStorageStage, error: unknown) {
  const result = passportStorageFailure(stage, error);
  // Strict allowlist: no error text, credentials, user IDs, request body or snapshots.
  console.error(JSON.stringify({ event: "passport.storage.failed", stage, code: result.code }));
  return privateJson({ error: result.message }, result.status);
}
async function handlePOST(request: Request) {
  if (!sameOrigin(request))
    return privateJson({ error: "Please use this app." }, 403);
  if (!storageConfigured())
    return privateJson(
      {
        error:
          "Account saving is not configured yet. Your current Passport is preserved.",
      },
      503,
    );
  let stage: PassportStorageStage = "request";
  try {
    const raw = await readRequestText(request, 1000);
    if (raw.length > 1000)
      return privateJson({ error: "Invalid save request." }, 400);
    const b = JSON.parse(raw);
    stage = "auth";
    const client = await accountClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user)
      return privateJson({ error: "Please sign in." }, 401);
    if (b.action === "restore") {
      if (typeof b.id !== "string" || !uuid(b.id))
        return privateJson({ error: "Invalid Passport." }, 400);
      stage = "restore-read";
      const { data, error } = await client
        .from("saved_passports")
        .select("snapshot")
        .eq("id", b.id)
        .eq("user_id", user.id)
        .single();
      if (error?.code === "PGRST116")
        return privateJson({ error: "Saved Passport not found." }, 404);
      if (error) return failedPassportOperation(stage, error);
      if (!data)
        return privateJson({ error: "Saved Passport not found." }, 404);
      stage = "restore-snapshot";
      const state = restoreSnapshot(data.snapshot);
      stage = "restore-session";
      registerRestoredSession(state);
      const persisted = await syncSession(state);
      assertSessionWriteCommitted(storageConfigured(), persisted);
      return privateJson({
        passport: passportView(
          state,
          "Restored from your saved Qloo evidence.",
        ),
      });
    }
    if (
      b.action !== "save" ||
      typeof b.sessionId !== "string" ||
      !Number.isInteger(b.revision)
    )
      return privateJson({ error: "Invalid save request." }, 400);
    stage = "save-session";
    const state = await loadSession(b.sessionId);
    if (state.revision !== b.revision)
      return privateJson(
        { error: "Your Passport changed. Save the latest version." },
        409,
      );
    stage = "save-snapshot";
    const snapshot = passportSnapshot(state);
    stage = "save-upsert";
    const { error } = await storageWriter().from("saved_passports").upsert(
      {
        user_id: user.id,
        city: state.city,
        snapshot,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,city" },
    );
    if (error) return failedPassportOperation(stage, error);
    return privateJson({ saved: true, city: state.city });
  } catch (error) {
    return failedPassportOperation(stage, error);
  }
}
async function handleDELETE(request: Request) {
  if (!sameOrigin(request))
    return privateJson({ error: "Please use this app." }, 403);
  try {
    const raw = await readRequestText(request, 200);
    if (raw.length > 200)
      return privateJson({ error: "Invalid request." }, 400);
    const b = JSON.parse(raw);
    if (typeof b.id !== "string" || !uuid(b.id))
      return privateJson({ error: "Invalid Passport." }, 400);
    const client = await accountClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user)
      return privateJson({ error: "Please sign in." }, 401);
    const { data, error } = await client
      .from("saved_passports")
      .delete()
      .eq("id", b.id)
      .eq("user_id", user.id)
      .select("id");
    if (error) throw Error();
    if (!data?.length)
      return privateJson({ error: "Passport not found." }, 404);
    return privateJson({ deleted: true });
  } catch {
    return privateJson({ error: "Could not delete that saved Passport." }, 502);
  }
}
function uuid(value: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
    value,
  );
}

export function GET() {
  return debugRequest("account.passports", () => handleGET());
}

export function POST(request: Request) {
  return debugRequest("account.passports", () => handlePOST(request));
}

export function DELETE(request: Request) {
  return debugRequest("account.passports", () => handleDELETE(request));
}
