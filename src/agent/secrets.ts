/** Defense in depth for configured secrets; never log the value that matched. */
export function containsConfiguredSecret(value: string): boolean {
  return [
    "QLOO_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
    "AGENT_MODEL_API_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  ].some(name => {
    const secret = process.env[name];
    return Boolean(secret && value.includes(secret));
  });
}
