/** Relative price categories, not currency amounts or current menu prices. */
export function priceLabel(level: unknown): string | undefined {
  return typeof level === "number" && Number.isInteger(level)
    ? (
        {
          1: "Budget-friendly",
          2: "Moderate",
          3: "Premium",
          4: "Luxury",
        } as Record<number, string>
      )[level]
    : undefined;
}
