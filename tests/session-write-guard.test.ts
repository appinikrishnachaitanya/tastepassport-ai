import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertSessionWriteCommitted } from "../src/agent/session-lifetime.ts";

const source = (path: string) => readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("durable sessions fail closed when a later revision cannot be persisted", () => {
  assert.doesNotThrow(() => assertSessionWriteCommitted(true,true));
  assert.doesNotThrow(() => assertSessionWriteCommitted(false,false));
  assert.doesNotThrow(() => assertSessionWriteCommitted(false,true));
  assert.throws(
    () => assertSessionWriteCommitted(true,false),
    /could not be synchronized safely/,
  );
});

test("session store checks revisioned write before changing in-memory state", () => {
  const store=source("src/agent/store.ts");
  const update=store.indexOf("const committed = await persistActiveSession(next.state, revision)");
  const guard=store.indexOf("assertSessionWriteCommitted(durableIds.has(id), committed)");
  const memoryCommit=store.indexOf("sessions.set(id, next.state)");
  assert.ok(update>=0 && guard>update && memoryCommit>guard);
  assert.match(store,/if \(persisted\) durableIds\.add\(id\)/);
  assert.match(store,/if \(persisted && validLocal && validLocal\.revision > persisted\.revision\)/);
  assert.match(store,/durableIds\.delete\(id\)/);
});

test("shared-session writes protect against stale revisions across server instances",()=>{
  const sourceFile=source("src/agent/active-session-db.ts");
  assert.match(sourceFile,/\.eq\("revision", expectedRevision\)/);
  assert.match(sourceFile,/\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(sourceFile,/if \(!data\)/);
  assert.match(sourceFile,/throw Error\("Passport changed\. Use the latest state\."\)/);
});

test("new Passport warns if shared state is not durable; saved restore never silently succeeds",()=>{
  const create=source("app/api/passport/route.ts");
  assert.match(create,/if \(storageConfigured\(\) && !persisted\)/);
  assert.match(create,/Temporary Passport storage is unavailable/);
  for (const file of ["app/api/account/passports/route.ts","app/api/account/preferences/route.ts"]) {
    const code=source(file);
    assert.match(code,/assertSessionWriteCommitted\(storageConfigured\(\), persisted\)/);
  }
});
