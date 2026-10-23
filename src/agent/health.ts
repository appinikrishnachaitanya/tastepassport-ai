export type ProviderHealth =
  "unconfigured" | "configured" | "healthy" | "unavailable";
let last: { status: ProviderHealth; at: number } | undefined;
export function recordProviderHealth(status: ProviderHealth) {
  last = { status, at: Date.now() };
}
export function providerHealth(configured: boolean): ProviderHealth {
  if (!configured) return "unconfigured";
  return last && Date.now() - last.at < 60_000 ? last.status : "configured";
}
export const conciergeUnavailable =
  "Taste Concierge is temporarily unavailable. You can still refine your Passport.";
