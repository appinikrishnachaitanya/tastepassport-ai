/** Explicit native Gemini budgets. These are ceilings, not target response lengths. */
export const GEMINI_TEMPERATURE = 1;
export function generationSettings(phase: "decision" | "response") {
  return {
    temperature: GEMINI_TEMPERATURE,
    // Structured calls need room for arguments and model reasoning. Short
    // conclusions/evidence selections have a separate, smaller output ceiling.
    maxOutputTokens: phase === "decision" ? 4096 : 1024,
  };
}
