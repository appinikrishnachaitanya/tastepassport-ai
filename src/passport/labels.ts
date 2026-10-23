import type { Section } from "./model.ts";

/** Customer-facing names; stable section IDs remain unchanged in APIs and storage. */
export function sectionLabel(section: Section): string {
  return section === "Eat" ? "Food" : section === "Coffee" ? "Coffee & cafés" : section;
}
