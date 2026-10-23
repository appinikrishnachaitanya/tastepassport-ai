import "server-only";
import { debugEvent } from "./debug.ts";
import { normalizeSession, clearPassport } from "./session.ts";
import { randomUUID } from "node:crypto";
import { loadActiveSession, persistActiveSession, removeActiveSession } from "./active-session-db.ts";
import { activeSessionExpiry, assertSessionWriteCommitted } from "./session-lifetime.ts";
import type { Candidate } from "../passport/model.ts";
import type { AgentState, Constraint, TastePassportSession } from "./types.ts";
import type { Passport } from "../workspace/state.ts";
const globalStore = globalThis as typeof globalThis & {
  tastePassportSessions?: Map<string, AgentState>;
  tastePassportLocks?: Set<string>;
  tastePassportDurableIds?: Set<string>;
};
const sessions = (globalStore.tastePassportSessions ??= new Map<
  string,
  AgentState
>());
const locks = (globalStore.tastePassportLocks ??= new Set<string>());
const durableIds = (globalStore.tastePassportDurableIds ??= new Set<string>());
export function createSession(
  passport: Passport,
  constraints: Constraint[] = [],
): TastePassportSession {
  for (const [id, s] of sessions)
    if (s.expires < Date.now()) { sessions.delete(id); durableIds.delete(id); }
  if (sessions.size >= 100) {
    const oldest = sessions.keys().next().value!;
    sessions.delete(oldest);
    durableIds.delete(oldest);
  }
  const state: AgentState = {
    id: randomUUID(),
    revision: 0,
    expires: activeSessionExpiry(),
    city: passport.city,
    selected: passport.selected,
    tags: passport.selected.filter((s: Candidate) =>
      s.id.startsWith("urn:tag:"),
    ),
    constraints,
    categoryConstraints: {},
    cards: passport.cards,
    previous: [],
    feedback: [],
    notices: passport.notices,
  };
  const session = normalizeSession(state);
  sessions.set(state.id, session);
  debugEvent("session.created", { count: sessions.size });
  return session;
}
export function getSession(id: string): AgentState {
  const state = sessions.get(id);
  if (!state) {
    debugEvent("session.missing");
    throw Error("Your Passport session is no longer available. Refresh with your tastes to continue.");
  }
  if (state.expires < Date.now()) {
    debugEvent("session.expired");
    throw Error(
      "Your refinement session expired. Build a passport again; your taste draft remains available.",
    );
  }
  return state;
}
/** Read the trusted shared session first when available, falling back to the in-process map.
 * No browser-submitted recommendation data is accepted as a replacement.
 */
export async function loadSession(id: string): Promise<AgentState> {
  let persisted: AgentState | undefined;
  let storageUnavailable = false;
  try { persisted = await loadActiveSession(id); }
  catch { storageUnavailable = true; }
  if (persisted) durableIds.add(id);
  const local = sessions.get(id);
  const now = Date.now();
  const validLocal = local && local.expires > now ? local : undefined;
  // A higher local revision than the shared row means a prior DB update was
  // missed. Never treat that uncommitted state as authoritative for saving.
  if (persisted && validLocal && validLocal.revision > persisted.revision)
    throw Error("Your Passport could not be synchronized safely. Please retry the refinement.");
  const chosen = persisted && (!validLocal || persisted.revision >= validLocal.revision)
    ? normalizeSession(persisted) : validLocal;
  if (chosen) {
    sessions.set(id, chosen);
    return chosen;
  }
  if (storageUnavailable) throw Error("Passport storage is temporarily unavailable.");
  return getSession(id);
}
/** Persist newly constructed trusted server state before returning it to the browser. */
export async function syncSession(state: AgentState) {
  const persisted = await persistActiveSession(state);
  if (persisted) durableIds.add(state.id);
  return persisted;
}
export async function inSession<T>(
  id: string,
  revision: number,
  run: (state: AgentState) => Promise<{ state: AgentState; value: T }>,
  signal?: AbortSignal,
): Promise<T> {
  const state = await loadSession(id);
  if (locks.has(id)) throw Error("A refinement is already in progress.");
  if (state.revision !== revision)
    throw Error("Passport changed. Use the latest state.");
  locks.add(id);
  try {
    let abort: (() => void) | undefined;
    const next = await (signal
      ? Promise.race([
          run(state),
          new Promise<never>((_, reject) => {
            abort = () =>
              reject(
                Error(
                  "Refinement cancelled or timed out. Your discoveries are preserved.",
                ),
              );
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          }),
        ]).finally(() => {
          if (abort) signal.removeEventListener("abort", abort);
        })
      : run(state));
    signal?.throwIfAborted();
    next.state.revision = revision + 1;
    next.state.expires = activeSessionExpiry();
    if (!sessions.has(id)) throw Error("Passport was reset.");
    // CAS protects the revision when a second server instance processes a
    // concurrent edit. An unavailable shared table retains the legacy map.
    const committed = await persistActiveSession(next.state, revision);
    assertSessionWriteCommitted(durableIds.has(id), committed);
    if (committed) durableIds.add(id);
    sessions.set(id, next.state);
    debugEvent("session.updated", { count: next.state.cards.length });
    return next.value;
  } finally {
    locks.delete(id);
  }
}

export async function discardSession(id: string) {
  const old = sessions.get(id);
  if (old) clearPassport(old);
  sessions.delete(id);
  durableIds.delete(id);
  await removeActiveSession(id);
}

/** Rehydrate trusted account data with a fresh, bounded guest-session token. */
export function registerRestoredSession(state: TastePassportSession) {
  for (const [id, s] of sessions)
    if (s.expires < Date.now()) { sessions.delete(id); durableIds.delete(id); }
  if (sessions.size >= 100) {
    const oldest = sessions.keys().next().value!;
    sessions.delete(oldest);
    durableIds.delete(oldest);
  }
  sessions.set(state.id, state);
}
