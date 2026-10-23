import { compactConversationMemory } from "./memory.ts";
import type { AgentState } from "./types.ts";
export const ACTIVE_SESSION_LIFETIME_MS = 24 * 60 * 60_000;
/** Once a session has entered shared storage, fail closed rather than silently lose later edits. */
export function assertSessionWriteCommitted(wasDurable: boolean, committed: boolean): void {
  if (wasDurable && !committed)
    throw Error("Your Passport could not be synchronized safely. Please retry the refinement.");
}
export const MAX_ACTIVE_SESSION_BYTES = 4_500_000;
export const activeSessionExpiry = (now = Date.now()) => now + ACTIVE_SESSION_LIFETIME_MS;
export const validSessionId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
/** Only persist trusted backend-generated state; bound arrays to control storage. */
export function compactActiveSession(state: AgentState): AgentState {
  return {
    ...state,
    cards: state.cards.slice(-300),
    savedCards: state.savedCards?.slice(-100),
    previous: state.previous.slice(-50),
    history: state.history?.slice(-30),
    conversationMemory: compactConversationMemory(state.conversationMemory),
    notices: state.notices.slice(-30),
  };
}
export function parseActiveSession(value: unknown, id: string, now = Date.now()): AgentState | undefined {
  if (!validSessionId(id) || !value || typeof value !== "object") return;
  const state = value as Partial<AgentState>;
  if (state.id !== id || !Number.isInteger(state.revision) || state.revision! < 0 ||
      typeof state.expires !== "number" || state.expires <= now ||
      typeof state.city !== "string" || !Array.isArray(state.selected) ||
      !Array.isArray(state.tags) || !Array.isArray(state.cards) ||
      !Array.isArray(state.previous) || !Array.isArray(state.feedback) ||
      !Array.isArray(state.notices) || !Array.isArray(state.constraints) ||
      !state.categoryConstraints || typeof state.categoryConstraints !== "object") return;
  return state as AgentState;
}
