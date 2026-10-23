import type { TastePassportSession } from "./types.ts";
import type { Card, Section } from "../passport/model.ts";
export interface ComparisonSnapshot {
  request: string;
  destination: string;
  tastes: string[];
  revision: number;
  cards: Card[];
  outcome: "updated" | "no-new-results";
}
/** A comparison uses the exact controller request and its resulting Qloo cards,
 * never whatever unrelated recommendations happen to be visible later. */
export function captureComparison(
  state: TastePassportSession,
  request: string,
  sections: Section[],
  changed: Section[],
): ComparisonSnapshot {
  const updated = sections.filter(
    (s) => changed.includes(s) && !state.hiddenCategories.includes(s),
  );
  return {
    request,
    destination: state.city,
    tastes: state.selected.map((s) => s.name),
    revision: state.revision + 1,
    cards: structuredClone(
      state.cards.filter(
        (c) =>
          updated.includes(c.section) &&
          c.evidence?.source === "Qloo" &&
          c.evidence.result.id === c.id,
      ),
    ).slice(0, 20),
    outcome: updated.length ? "updated" : "no-new-results",
  };
}
