/** Isolated catalogue contract. Uses a synthetic Supabase endpoint and mocked responses. */
import assert from "node:assert/strict";
import { destinationCatalog, catalogCity } from "../src/workspace/destinations";
process.env.SUPABASE_URL = "https://catalog-contract.example";
process.env.SUPABASE_PUBLISHABLE_KEY = "contract-test-public-key";
let fail = false;
globalThis.fetch = async (url) => {
  const requestUrl = new URL(String(url));
  assert.equal(requestUrl.pathname, "/rest/v1/destinations");
  assert.equal(requestUrl.searchParams.get("enabled"), "eq.true");
  return fail
    ? new Response(JSON.stringify({ message: "unavailable" }), { status: 503 })
    : new Response(JSON.stringify([{ name: "Lisbon" }, { name: "London" }]), { status: 200, headers: { "content-type": "application/json" } });
};
assert.deepEqual(await destinationCatalog(), ["Lisbon", "London"]);
assert.equal(await catalogCity("lisbon"), "Lisbon");
assert.equal(await catalogCity("Tokyo"), undefined);
assert.equal(await catalogCity("https://bad.example"), undefined);
fail = true;
await assert.rejects(destinationCatalog());
console.log("PASS: dynamic catalogue, server allowlist, input validation and database failure handling");
