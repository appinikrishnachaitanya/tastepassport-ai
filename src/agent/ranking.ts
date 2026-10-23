import { brandNameCounts, isPlaceSection, resultBrand, type Card, type Section } from "../passport/model.ts";

/** A bounded MMR-style reranker. Provider/fused rank remains the relevance
 * signal; only close candidates compete on redundancy. No invented similarity
 * vectors, ratings-as-taste, or cross-query affinity comparisons. */
export function rankDiverseChoices(cards: Card[], section: Section): Card[] {
  const seen = new Set<string>();
  const unique = cards.filter(card => !seen.has(card.id) && Boolean(seen.add(card.id)));
  if (!isPlaceSection(section) || unique.length < 3) return unique;
  const counts = brandNameCounts(unique);
  const brand = (card: Card) => resultBrand(card, counts);
  const selected: Card[] = [unique[0]];
  const remaining = unique.slice(1).map((card, index) => ({card, rank: index + 1}));
  const distinctiveTags = (card: Card) => new Set((card.evidence?.result.tags ?? [])
    .filter(tag => /urn:tag:(?:cuisine|specialty_dish|ambience):/.test(tag.id)).map(tag => tag.id));
  const overlap = (left: Card, right: Card) => {
    const leftBrand = brand(left), rightBrand = brand(right);
    if (leftBrand && rightBrand && leftBrand === rightBrand) return 1;
    const a = distinctiveTags(left), b = distinctiveTags(right);
    if (!a.size || !b.size) return 0;
    const shared = [...a].filter(id => b.has(id)).length;
    // Sharing a cuisine is expected, so it is much weaker than a repeated branch.
    return 0.25 * shared / (a.size + b.size - shared);
  };
  while (remaining.length) {
    // Diversify the decision preview; the rest retain their original order.
    if (selected.length >= 3) return [...selected, ...remaining.map(item => item.card)];
    const window = remaining.slice(0, 8);
    const score = (item: typeof remaining[number]) =>
      0.85 * (1 - item.rank / Math.max(unique.length, 8)) -
      0.15 * Math.max(...selected.map(card => overlap(card, item.card)));
    const best = window.reduce((a, b) => score(b) > score(a) ? b : a);
    selected.push(best.card);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return selected;
}
