/** Same minimum requirements for registration and a new/replacement password. */
const symbolCharacters = "!@#$%^&*()_+-=[]{};':\"\\|<>?,./`~";

export function passwordRequirements(password: string) {
  return [
    { id: "length", label: "12–128 characters", satisfied: password.length >= 12 && password.length <= 128 },
    { id: "lowercase", label: "A lowercase letter (a–z)", satisfied: /[a-z]/.test(password) },
    { id: "uppercase", label: "An uppercase letter (A–Z)", satisfied: /[A-Z]/.test(password) },
    { id: "number", label: "A number (0–9)", satisfied: /[0-9]/.test(password) },
    { id: "symbol", label: "A symbol (such as !, @, or #)", satisfied: Array.from(password).some(char => symbolCharacters.includes(char)) },
  ];
}

export function passwordValidationMessage(password: unknown): string | null {
  if (typeof password !== "string")
    return "Enter a password containing 12–128 characters, uppercase and lowercase letters, a number, and a symbol.";
  const missing = passwordRequirements(password).filter(requirement => !requirement.satisfied);
  if (!missing.length) return null;
  return `Password needs: ${missing.map(requirement => requirement.label).join("; ")}.`;
}

/** No raw provider message is returned or logged, as it may contain sensitive data. */
export function passwordProviderMessage(error: { code?: string } | null | undefined): string | null {
  if (error?.code !== "weak_password") return null;
  const reasons = (error as { weakPassword?: { reasons?: unknown }; weak_password?: { reasons?: unknown } }).weakPassword?.reasons
    ?? (error as { weak_password?: { reasons?: unknown } }).weak_password?.reasons;
  const safeReasons = Array.isArray(reasons) ? reasons.filter((reason): reason is string => typeof reason === "string") : [];
  if (safeReasons.includes("pwned")) return "This password has appeared in a data breach. Choose a different, unique password.";
  if (safeReasons.includes("length")) return "Password is too short for the account security policy. Use at least 12 characters.";
  return "Password does not meet the account's character requirements. Include uppercase and lowercase letters, a number, and a symbol.";
}
