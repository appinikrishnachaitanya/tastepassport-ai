/** Supabase may return an obfuscated user with no identities for an existing account. */
export function existingRegistration(result: {
  error: {code?: string} | null;
  data: {session: unknown; user: {identities?: unknown[]} | null};
}) {
  return result.error?.code === "user_already_exists" || result.error?.code === "email_exists" ||
    (!result.error && !result.data.session && Array.isArray(result.data.user?.identities) && result.data.user.identities.length === 0);
}
