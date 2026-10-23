const KEY = "tastepassport.active-session.v1";
const SAVED_KEY = "tastepassport.saved-session.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A per-tab pointer only. The server remains the source of truth for the Passport. */
export function rememberActiveSession(store: Store, id: string) {
  try { if (UUID.test(id)) store.setItem(KEY, id); } catch {}
}
export function restoreActiveSession(store: Store): string | undefined {
  try { const id = store.getItem(KEY); return id && UUID.test(id) ? id : undefined; } catch { return undefined; }
}
export function clearActiveSession(store: Store) {
  try { store.removeItem(KEY); store.removeItem(SAVED_KEY); } catch {}
}
/** Only an explicitly saved or reopened session may update its account snapshot. */
export function rememberSavedSession(store: Store, id: string) {
  try { if (UUID.test(id)) store.setItem(SAVED_KEY, id); } catch {}
}
export function restoreSavedSession(store: Store): string | undefined {
  try { const id = store.getItem(SAVED_KEY); return id && UUID.test(id) ? id : undefined; } catch { return undefined; }
}
export function clearSavedSession(store: Store) {
  try { store.removeItem(SAVED_KEY); } catch {}
}
