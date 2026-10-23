import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEntities } from '../src/qloo/types.ts';
import { insightParams, request, safeText } from '../src/qloo/client.ts';
// Synthetic protocol/error inputs only; no fake recommendation data.
test('unexpected envelopes and malformed entities fail closed', () => {
  for (const body of [null, {}, { success: false, results: { entities: [] } }, { results: { entities: [{}] } }]) {
    assert.throws(() => parseEntities(body, 'insights'));
  }
  assert.deepEqual(parseEntities({ results: { entities: [] } }, 'insights'), []);
});
test('physical locality filters are strict and distinct from audience signals', () => {
  const local = insightParams(['id'], 'place', true);
  assert.equal(local['filter.location.radius'], '0');
  assert.equal(local['filter.location.query'], 'New York City');
  assert.equal(local['signal.location.query'], undefined);
  assert.equal(insightParams(['id'], 'artist', false)['signal.location.query'], 'New York City');
  assert.throws(() => insightParams(['id'], 'artist', true));
  assert.throws(() => insightParams([], 'place', true));
  assert.throws(() => insightParams(['id'], 'invented', false));
});
test('missing credentials fail without network requests', async () => {
  const original = process.env.QLOO_API_KEY;
  delete process.env.QLOO_API_KEY;
  try { await assert.rejects(request('/search', { query: 'Interstellar' }), /Missing QLOO_API_KEY/); }
  finally { if (original !== undefined) process.env.QLOO_API_KEY = original; }
});
test('HTTP failures never echo response bodies or request secrets', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.QLOO_API_KEY;
  process.env.QLOO_API_KEY = 'synthetic-unit-test-sentinel';
  try {
    for (const status of [400, 401, 403, 404, 429, 500]) {
      globalThis.fetch = async () => new Response('synthetic-unit-test-sentinel', { status });
      await assert.rejects(request('/search', {}), (error: Error) => {
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.ok(!error.message.includes('synthetic-unit-test-sentinel')); return true;
      });
    }
    assert.equal(safeText('synthetic-unit-test-sentinel'), '"[REDACTED]"');
    globalThis.fetch = async () => new Response('invalid json');
    await assert.rejects(request('/search', {}), /invalid JSON/);
    globalThis.fetch = async () => { throw new Error('synthetic-unit-test-sentinel'); };
    await assert.rejects(request('/search', {}), /network\/TLS\/proxy failure/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.QLOO_API_KEY; else process.env.QLOO_API_KEY = originalKey;
  }
});

test('live-observed search types and insight affinity are preserved', () => {
  const entity = {name:'Protocol test',entity_id:'00000000-0000-0000-0000-000000000000',types:['urn:entity:artist'],query:{affinity:0.5}};
  assert.deepEqual(parseEntities({results:[entity]},'search')[0].types,['urn:entity:artist']);
  assert.equal(parseEntities({results:{entities:[entity]}},'insights')[0].query?.affinity,0.5);
  assert.throws(()=>parseEntities({results:[{...entity,types:[3]}]},'search'));
});
