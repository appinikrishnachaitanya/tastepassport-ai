/** Display Qloo-returned ratings without rounding near-perfect scores up to 5/5. */
export function formatReturnedRating(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) return;
  return (Math.floor(value * 100 + 1e-8) / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
