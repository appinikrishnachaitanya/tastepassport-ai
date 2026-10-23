import { writeFile, mkdir } from 'node:fs/promises';
import { search, insights, insightParams, metadata, safeText, QlooError } from '../qloo/client.ts';
import { isObject } from '../qloo/types.ts';
import type { Entity } from '../qloo/types.ts';
const seeds = [
  { query: 'A.R. Rahman', type: 'artist' },
  { query: 'Interstellar', type: 'movie', year: 2014 },
  { query: 'Blue Tokai', type: 'brand' },
  { query: 'biryani', type: 'place' },
  { query: 'The Strand', type: 'place' },
  { query: 'The Hitchhiker\'s Guide to the Galaxy', type: 'book' }
];
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
async function main() {
  console.log('TASTEPASSPORT QLOO FEASIBILITY SPIKE\nDestination: New York City');
  if (!process.env.QLOO_API_KEY?.trim()) throw new QlooError('Missing QLOO_API_KEY. No live experiments executed; no feasibility verdict established.');
  const evidence: Record<string, unknown>[] = [];
  const resolved: { query: string; entity: Entity }[] = [];
  let failed = false;
  console.log('\nResolved Taste Seeds');
  for (const seed of seeds) {
    try {
      const candidates = await search(seed.query);
      const matches = candidates.filter(e => normalize(e.name) === normalize(seed.query)
        && (e.types?.includes(`urn:entity:${seed.type}`) || (e.subtype ?? e.type) === `urn:entity:${seed.type}`)
        && (!seed.year || e.properties?.release_year === seed.year));
      const entity = matches.length === 1 ? matches[0] : undefined;
      evidence.push({ query: seed.query, source: 'REAL QLOO API RESPONSE', candidates, selected: entity ?? null });
      if (!entity) { console.log(`${seed.query}: unresolved or ambiguous (no substituted entity). Candidates: ${safeText(candidates.map(e => ({ name: e.name, entity_id: e.entity_id, types: e.types, year: e.properties?.release_year })))}`); continue; }
      resolved.push({ query: seed.query, entity });
      console.log(`${seed.query}: ${entity.name}\nQloo ID: ${entity.entity_id}\n${safeText(metadata(entity))}`);
    } catch (error) {
      if (error instanceof QlooError && [401, 403, 429].includes(error.status ?? 0)) throw error;
      failed = true;
      const message = error instanceof Error ? error.message : 'Unknown failure';
      evidence.push({ query: seed.query, error: message }); console.log(`${seed.query}: ${safeText(message)}`);
    }
  }
  const primary = resolved.filter(s => ['A.R. Rahman', 'Interstellar'].includes(s.query));
  const experiments = primary.map(s => ({ title: `${s.query} → NYC places`, ids: [s.entity.entity_id], type: 'place', local: true }));
  if (primary.length) {
    const ids = primary.map(s => s.entity.entity_id);
    experiments.push({ title: 'Combined tastes → NYC places', ids, type: 'place', local: true });
    for (const type of ['artist', 'book', 'brand']) experiments.push({ title: `Combined tastes → ${type} with NYC audience signal`, ids, type, local: false });
  }
  if (resolved.length) experiments.push({ title: 'All resolved tastes → NYC places', ids: resolved.map(s => s.entity.entity_id), type: 'place', local: true });
  let nonempty = 0;
  console.log('\nDestination Discoveries / Cross-domain Experiments');
  for (const experiment of experiments) {
    const params = insightParams(experiment.ids, experiment.type, experiment.local);
    console.log(`\n${experiment.title}\nRequest: ${safeText(params)}`);
    try {
      const result = await insights(params);
      evidence.push({ experiment: experiment.title, source: 'REAL QLOO API RESPONSE', params, response: result.body });
      if (!result.entities.length) { console.log('Empty result set'); failed = true; }
      else nonempty++;
      result.entities.forEach((entity, i) => console.log(`${i + 1}. ${entity.name}\nQloo ID: ${entity.entity_id}\n${safeText(metadata(entity))}`));
      if (isObject(result.body)) console.log(`Returned locality/query metadata: ${safeText(result.body.query ?? null)}`);
    } catch (error) {
      if (error instanceof QlooError && [401, 403, 429].includes(error.status ?? 0)) throw error;
      failed = true;
      const message = error instanceof Error ? error.message : 'Unknown failure';
      evidence.push({ experiment: experiment.title, params, error: message }); console.log(safeText(message));
    }
  }
  await mkdir('.spike-output', { recursive: true });
  await writeFile('.spike-output/latest.json', safeText({ timestamp: new Date().toISOString(), destination: 'New York City', evidence }) + '\n');
  console.log(`\n${nonempty} nonempty experiments. Evidence: .spike-output/latest.json. Review actual entities and locality before assigning a product verdict.`);
  if (failed || primary.length !== 2 || nonempty < 3) process.exitCode = 1;
}
main().catch(error => { console.error(safeText(error instanceof Error ? error.message : 'Spike failed')); process.exitCode = 1; });
