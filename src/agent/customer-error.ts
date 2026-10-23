import { AgentTurnError } from "./browser.ts";
import { turnFailureMessages } from "./turn-failure.ts";
/** Provider/network diagnostics must never be shown as the customer's chat reply. */
export function refinementErrorMessage(error: unknown, cancelled = false): string {
  if (error instanceof AgentTurnError && !cancelled) return turnFailureMessages[error.code];
  if (cancelled) return "Stopped this request. Your discoveries are still here whenever you’re ready.";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || /timed? ?out|timeout/i.test(message))
    return "That’s taking longer than expected. Your discoveries are still here. Try again in a moment.";
  if (/session.*expired|editing window.*ended/i.test(message))
    return "Your Passport needs a refresh before I can make changes. You can keep browsing your discoveries in the meantime.";
  if (/network|failed to fetch|fetch failed|connection|load failed/i.test(message))
    return "I couldn’t connect just now. Your discoveries are still here. Try again in a moment.";
  if (/latest state|latest version|passport changed/i.test(message))
    return "Your Passport has a newer update. Reopen it before trying this request again.";
  return "I couldn’t finish that request just now. Your discoveries are still here. You can try again or keep exploring.";
}
