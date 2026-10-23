import test from "node:test";
import assert from "node:assert/strict";
import { validDestination, matchesDestination } from "../src/workspace/location.ts";
import { extractDraft } from "../src/workspace/state.ts";
import { interpret, validateIntent } from "../src/agent/intent.ts";
import { cityDate, nextWeekend, cityTimeZone } from "../src/account/plans.ts";

test("destinations accept international cities and reject non-locality input", () => {
  for (const city of ["Bengaluru, India", "São Paulo", "München", "東京", "Cape Town"])
    assert.equal(validDestination(city), true);
  for (const city of [null, "", "https://example.com", "user@example.com", "123456789", "x".repeat(101)])
    assert.equal(validDestination(city), false);
  assert.equal(validateIntent({ ...interpret("I love jazz"), destination: "Bengaluru, India" }).destination, "Bengaluru, India");
});

test("arbitrary relocation destinations are extracted without substituting a suggested city", () => {
  assert.equal(extractDraft("I'm moving to Bengaluru, India. I love jazz, films and coffee", "London").city, "Bengaluru, India");
});

test("locality matching accepts aliases and accents but rejects wrong cities and countries", () => {
  assert.equal(matchesDestination("Bengaluru, India", { city: "Bangalore", country: "India" }), true);
  assert.equal(matchesDestination("São Paulo", { city: "Sao Paulo" }), true);
  assert.equal(matchesDestination("Paris, France", { city: "Paris", country_code: "FR" }), true);
  assert.equal(matchesDestination("London, UK", { city: "London", country_code: "GB" }), true);
  assert.equal(matchesDestination("Paris, France", { city: "Paris", country: "United States" }), false);
  assert.equal(matchesDestination("Paris, France", { city: "Paris" }), false);
  assert.equal(matchesDestination("Bengaluru", { city: "London" }), false);
});

test("configured destinations use their real time zones and other cities retain UTC fallback", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  assert.equal(cityDate("Bengaluru, India", now), "2026-10-17");
  assert.equal(cityTimeZone("Bengaluru, India"), "Asia/Kolkata");
  assert.equal(nextWeekend("Bengaluru, India", now), "2026-10-24");
  assert.equal(cityTimeZone("London, United Kingdom"), "Europe/London");
  assert.equal(cityTimeZone("Cape Town"), "UTC");
});
