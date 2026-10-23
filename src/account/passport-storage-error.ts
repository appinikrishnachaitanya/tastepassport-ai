/** User-facing account storage failures. Never expose SQL diagnostics or snapshots. */
export type PassportStorageStage =
  | "request" | "auth" | "list" | "restore-read" | "restore-snapshot"
  | "restore-session" | "save-session" | "save-snapshot" | "save-upsert";

export function safePassportStorageCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "unknown";
  const code = (error as {code?: unknown}).code;
  return typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(code)
    ? code : "unknown";
}
/** Only return a known fixed identifier; arbitrary SQL/message text is private. */
export function safePassportConstraint(error: unknown): "city" | "snapshot" | "other" {
  if (!error || typeof error !== "object") return "other";
  const message = (error as {message?: unknown}).message;
  if (typeof message !== "string") return "other";
  if (/\bsaved_passports_city_check\b/.test(message)) return "city";
  if (/\bsaved_passports_snapshot_check\b/.test(message)) return "snapshot";
  return "other";
}
export function passportStorageFailure(stage: PassportStorageStage, error: unknown) {
  const code = safePassportStorageCode(error);
  const retained = "Your current Passport is still here.";
  if (stage === "save-session") {
    // An unavailable Supabase request is not proof that the user session expired.
    if (error instanceof Error && /(?:session expired|refinement session expired)/i.test(error.message))
      return {status:410,message:`Your editing session ended. Open a saved Passport or create a new one before saving. ${retained}`,code};
    if (error instanceof Error && /Passport changed|synchronized safely/.test(error.message))
      return {status:409,message:`Your Passport changed while you were working. Refresh the latest Passport and try Save again. ${retained}`,code};
    return {status:503,message:`We couldn't retrieve your Passport for saving. Try again; if it continues, the app's session storage needs attention. ${retained}`,code};
  }
  if (stage === "save-snapshot")
    return {status:422,message:`This Passport has more details than we can safely save right now. Try saving a smaller set of discoveries. ${retained}`,code};
  if (stage === "restore-snapshot")
    return {status:422,message:"This saved Passport uses a format we can't safely open. Your other saved Passports are unchanged.",code};
  if (code === "42P01" || code === "PGRST205")
    return {status:503,message:`Saving needs a database update from the app owner. Please try again after maintenance. ${retained}`,code};
  if (code === "42501")
    return {status:503,message:`We couldn't access your saved Passports right now. The app owner needs to check storage permissions. ${retained}`,code};
  if (code === "23514") {
    const constraint = safePassportConstraint(error);
    const message = constraint === "city"
      ? `Saving this destination requires an app database update. Please try again after maintenance. ${retained}`
      : constraint === "snapshot"
        ? `This Passport's details exceed the database's current save rules. The app owner needs to apply the storage update. ${retained}`
        : `Your Passport couldn't be saved because the database rules need updating. Please try again after maintenance. ${retained}`;
    return {status:503,message,code};
  }
  return {status:stage === "list" ? 503 : 502,
    message:stage === "list"
      ? "Your saved Passports couldn't load. Please try again."
      : `We couldn't complete that save or restore. Please try again. ${retained}`,
    code};
}
