import test from "node:test";
import assert from "node:assert/strict";
import {
  passwordRequirements,
  passwordValidationMessage,
  passwordProviderMessage,
} from "../src/account/password-policy.ts";

const valid = "SafePasscode12!";

test("registration password matches Supabase configured 12-char and 4-character-class policy", () => {
  assert.equal(passwordValidationMessage(valid), null);
  assert.deepEqual(passwordRequirements(valid).map((x) => x.satisfied), [true, true, true, true, true]);
  const scenarios = [
    { password: "Abcdef1!", missing: "12–128 characters" },
    { password: "UPPERCASE123!", missing: "lowercase letter" },
    { password: "lowercase123!", missing: "uppercase letter" },
    { password: "NoDigitsAllowed!", missing: "number" },
    { password: "NoSpecial12345", missing: "symbol" },
  ];
  for (const { password, missing } of scenarios) {
    const message = passwordValidationMessage(password);
    assert.ok(message, `Expected rejection for ${missing}`);
    assert.match(message!, new RegExp(missing));
  }
  assert.match(passwordValidationMessage("A".repeat(129))!, /12–128/);
  assert.match(passwordValidationMessage(undefined)!, /12–128/);
  assert.equal(passwordValidationMessage("CapsAndDigit9#"), null);
});

test("Supabase weak-password failures have specific safe feedback", () => {
  assert.match(passwordProviderMessage({ code: "weak_password" })!, /character requirements/);
  assert.match(passwordProviderMessage({ code: "weak_password", weakPassword: { reasons: ["length"] } } as { code: string })!, /too short/);
  assert.match(passwordProviderMessage({ code: "weak_password", weakPassword: { reasons: ["pwned"] } } as { code: string })!, /data breach/);
  assert.match(passwordProviderMessage({ code: "weak_password", weak_password: { reasons: ["characters"] } } as { code: string })!, /character requirements/);
  assert.equal(passwordProviderMessage({ code: "email_exists" }), null);
  assert.equal(passwordProviderMessage(null), null);
  assert.doesNotMatch(passwordProviderMessage({ code: "weak_password", message: "secret-token" } as { code: string })!, /secret-token/);
});
