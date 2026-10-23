export const turnFailureMessages = {
  SESSION_EXPIRED: "Your editing window has ended. Your discoveries are still here. Refresh with your tastes to continue.",
  SESSION_MISSING: "I couldn’t reconnect to this Passport. Your discoveries are still here. Refresh with your tastes to continue.",
  SESSION_CHANGED: "Your Passport has a newer update. I’ll reconnect before you try this request again.",
  STORAGE_UNAVAILABLE: "I can’t save your changes just now. Your discoveries are still here. Please try again in a moment.",
  CANCELLED: "Stopped this request. Your discoveries are still here.",
  TIMEOUT: "That’s taking longer than expected. Your discoveries are still here. Try again in a moment.",
  TEMPORARILY_UNAVAILABLE: "I couldn’t finish that request just now. Your discoveries are still here. Try again or keep exploring.",
} as const;
export type TurnFailureCode = keyof typeof turnFailureMessages;
export function isTurnFailureCode(value: unknown): value is TurnFailureCode {
  return typeof value === "string" && Object.hasOwn(turnFailureMessages, value);
}
/** Stable recovery codes and application-owned copy; never expose raw service errors. */
export function turnFailure(error: unknown, aborted = false): {code: TurnFailureCode; message: string} {
  const text = error instanceof Error ? error.message : "";
  let code: TurnFailureCode = "TEMPORARILY_UNAVAILABLE";
  if (/session.*expired/i.test(text)) code = "SESSION_EXPIRED";
  else if (/session is no longer available/i.test(text)) code = "SESSION_MISSING";
  else if (/storage.*unavailable|synchronized safely/i.test(text)) code = "STORAGE_UNAVAILABLE";
  else if (/passport changed|latest state|latest version/i.test(text)) code = "SESSION_CHANGED";
  else if (/timeout|timed out/i.test(text)) code = "TIMEOUT";
  else if (aborted || /cancelled|canceled/i.test(text)) code = "CANCELLED";
  return {code, message: turnFailureMessages[code]};
}
