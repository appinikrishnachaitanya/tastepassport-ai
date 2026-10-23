import type { Candidate, Card } from './model.ts';
/** Dish filters require returned listing evidence, never just a cuisine affinity.
 * These tags do not verify today's menu or dietary suitability. */
export function matchesDishRequirements(card:Card, requirements:readonly Candidate[]):boolean {
  const dishes=requirements.filter(tag=>tag.id.startsWith('urn:tag:specialty_dish:'));
  const listed=card.evidence?.result.tags ?? [];
  const key=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  return dishes.every(dish=>listed.some(tag=>tag.id===dish.id ||
    (tag.id?.startsWith('urn:tag:specialty_dish:') && key(tag.name)===key(dish.name))));
}
