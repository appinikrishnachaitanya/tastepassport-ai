import type { Card } from "./model.ts";
import { resultBrand, brandNameCounts } from "./model.ts";
export interface Choice { card: Card; label: string; reason: string }
/** Labels describe comparisons within the actual returned set, not guarantees. */
export function threeChoices(cards: Card[]): Choice[] {
  const remaining = [...new Map(cards.map(c => [c.id, c])).values()];
  if (!remaining.length) return [];
  const choices: Choice[] = [];
  const repeatedNames = brandNameCounts(remaining);
  const distinct=()=>{
    const used=new Set(choices.map(c=>resultBrand(c.card,repeatedNames)).filter(Boolean));
    const options=remaining.filter(c=>!resultBrand(c,repeatedNames) || !used.has(resultBrand(c,repeatedNames)));
    return options.length?options:remaining;
  };
  const take = (card: Card, label: string, reason: string) => {
    choices.push({card,label,reason}); remaining.splice(remaining.findIndex(c => c.id === card.id),1);
  };
  // Preserve the validated/fused ranking; affinity from separate queries is
  // not calibrated and must not override the category's seed routing.
  take(remaining[0], "Start here", "A starting point chosen from your taste-led discoveries.");
  const priced = distinct().filter(c => c.intelligence?.commercial?.priceLevel !== undefined)
    .sort((a,b)=>a.intelligence!.commercial!.priceLevel!-b.intelligence!.commercial!.priceLevel!);
  if (priced.length) {
    const firstPrice=choices[0].card.intelligence?.commercial?.priceLevel;
    const lower=firstPrice !== undefined && priced[0].intelligence!.commercial!.priceLevel! < firstPrice;
    take(priced[0], lower ? "Lower-price option" : "Known budget", lower ? "A lower typical cost than the first choice. Check current prices." : "Lowest known typical cost among these alternatives. Check current prices.");
  }
  const adjacent = distinct().find(c => c.evidence?.pool === "adjacent");
  if (adjacent && choices.length < 3) take(adjacent, "Explore a little", "A broader connection to your tastes, for when you feel like trying something new.");
  while (choices.length < 3 && remaining.length) take(distinct()[0], "Another option", "One more discovery to consider alongside your starting choice.");
  return choices;
}
