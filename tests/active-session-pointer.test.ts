import assert from "node:assert/strict";
import test from "node:test";
import { clearActiveSession, rememberActiveSession, restoreActiveSession, rememberSavedSession, restoreSavedSession, clearSavedSession } from "../src/workspace/active-session.ts";

test("active Passport recovery stores only a validated per-tab session pointer", () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const id = "11111111-1111-4111-8111-111111111111";
  rememberActiveSession(store, id);
  assert.equal(restoreActiveSession(store), id);
  assert.equal([...values.values()][0], id);
  rememberActiveSession(store, "not-a-session");
  assert.equal(restoreActiveSession(store), id);
  assert.equal(restoreSavedSession(store), undefined, "an active Passport is not automatically saved");
  rememberSavedSession(store, id);
  assert.equal(restoreSavedSession(store), id);
  clearSavedSession(store);
  assert.equal(restoreSavedSession(store), undefined);
  assert.equal(restoreActiveSession(store), id, "deleting a saved snapshot need not discard the active Passport");
  rememberSavedSession(store, id);
  clearActiveSession(store);
  assert.equal(restoreActiveSession(store), undefined);
  assert.equal(restoreSavedSession(store), undefined);
});
