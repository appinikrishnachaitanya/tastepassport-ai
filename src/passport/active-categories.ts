import type { AgentState } from "../agent/types.ts";
import { sectionOrder } from "../workspace/state.ts";
import type { Card, Section } from "./model.ts";
/** Current or explicitly requested outputs only; not the entire Qloo type catalogue. */
export function activeCategories(state?:Pick<AgentState,"activeCategories"|"hiddenCategories">,cards:Card[]=[]):Section[] {
  const present=new Set([...(state?.activeCategories ?? []),...cards.map(card=>card.section)]);
  return sectionOrder.filter(section=>present.has(section)&&!state?.hiddenCategories?.includes(section));
}
