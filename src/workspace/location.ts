/** A named locality, not an address or a claim of verified provider coverage. */
export function validDestination(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2 &&
    value.trim().length <= 100 && /\p{L}/u.test(value) &&
    /^[\p{L}\p{M}\p{N} .'’,()\-]+$/u.test(value) &&
    !/https?|\d{7}|@/i.test(value);
}

const normalize = (value: string) => value.normalize("NFD")
  .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const countryAlias = (value: string) =>
  ["uk", "gb", "great britain"].includes(value) ? "united kingdom" :
    ["us", "usa", "united states of america"].includes(value) ? "united states" : value;

export function matchesDestination(city: string, geo: Record<string, unknown>) {
  const locality = normalize(city.split(",")[0]);
  const qualifiers = city.split(",").slice(1).map(normalize).filter(Boolean);
  const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
  const geography = [geo.country, geo.country_code, geo.admin1_region, geo.admin2_region]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => /^[a-z]{2}$/i.test(value)
      ? [normalize(value), normalize(regionNames.of(value.toUpperCase()) ?? value)]
      : [normalize(value)]);
  if (qualifiers.some((qualifier) => !geography.map(countryAlias).includes(countryAlias(qualifier)))) return false;
  const alias = (name: string) => name === "new york city" ? "new york" :
    name === "bengaluru" ? "bangalore" : name === "mumbai" ? "bombay" : name;
  return [geo.city, geo.metro, geo.name].some((name) =>
    typeof name === "string" && alias(normalize(name)) === alias(locality),
  );
}
