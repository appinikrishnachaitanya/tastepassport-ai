import { readRequestText } from "../../../src/http/request.ts";
import { existingRegistration } from "../../../src/account/registration";
import { passwordValidationMessage, passwordProviderMessage } from "../../../src/account/password-policy";
import { debugRequest } from "../../../src/agent/debug";
import {
  accountClient,
  accountConfigured,
  storageConfigured,
  storageWriter,
  sameOrigin,
  requestOrigin,
  privateJson,
} from "../../../src/account/server";
export const runtime = "nodejs";
import { accountName } from "../../../src/account/identity";
async function handleGET() {
  if (!accountConfigured())
    return privateJson({ configured: false, storage: false, user: null });
  try {
    const client = await accountClient();
    const { data, error } = await client.auth.getUser();
    return privateJson({
      configured: true,
      storage: storageConfigured(),
      user: error ? null : data.user ? {
        email: data.user.email,
        firstName: typeof data.user.user_metadata?.first_name === "string" ? data.user.user_metadata.first_name.slice(0,80) : "",
        lastName: typeof data.user.user_metadata?.last_name === "string" ? data.user.user_metadata.last_name.slice(0,80) : "",
      } : null,
    });
  } catch {
    return privateJson(
      {
        configured: true,
        storage: false,
        user: null,
        error: "Accounts are temporarily unavailable.",
      },
      503,
    );
  }
}
async function handlePOST(request: Request) {
  if (!sameOrigin(request))
    return privateJson(
      { error: "Please use this app to manage your account." },
      403,
    );
  if (!accountConfigured())
    return privateJson(
      {
        error:
          "Accounts are not configured yet. Your guest Passport still works.",
      },
      503,
    );
  try {
    const raw = await readRequestText(request, 4096);
    if (raw.length > 4096)
      return privateJson({ error: "Invalid account request." }, 400);
    const b = JSON.parse(raw);
    const client = await accountClient();
    if (b.action === "logout") {
      const { error } = await client.auth.signOut();
      if (error)
        return privateJson({ error: "Could not sign out. Please retry." }, 502);
      return privateJson({ signedOut: true });
    }
    if (b.action === "recover") {
      if (
        typeof b.email !== "string" ||
        b.email.length > 254 ||
        !/^\S+@\S+\.\S+$/.test(b.email)
      )
        return privateJson({ error: "Use a valid email." }, 400);
      await client.auth.resetPasswordForEmail(b.email.trim(), {
        redirectTo: `${requestOrigin(request)}/auth/callback?recovery=1`,
      });
      return privateJson({ requested: true });
    }
    if (b.action === "password" || b.action === "change-password") {
      const passwordIssue = passwordValidationMessage(b.password);
      if (passwordIssue)
        return privateJson({ error: passwordIssue }, 400);
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();
      if (authError || !user)
        return privateJson(
          { error: "Open your email recovery link first." },
          401,
        );
      if (b.action === "change-password") {
        if (!user.email || typeof b.currentPassword !== "string" || !b.currentPassword || b.currentPassword.length > 128)
          return privateJson({ error: "Enter your current password." },400);
        const verified = await client.auth.signInWithPassword({ email:user.email, password:b.currentPassword });
        if (verified.error || verified.data.user?.id !== user.id)
          return privateJson({ error: "Your current password could not be confirmed." },400);
      }
      const { error } = await client.auth.updateUser({ password: b.password });
      if (error) return privateJson({ error: passwordProviderMessage(error) ?? "Password update could not complete. Sign in again or request an email recovery link." }, 400);
      return privateJson({ signedIn: true });
    }
    if (
      !["login", "register"].includes(b.action) ||
      typeof b.email !== "string" ||
      b.email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(b.email) ||
      typeof b.password !== "string" ||
      (b.action === "login" && b.password.length > 128) ||
      b.password.length < 1
    )
      return privateJson(
        {
          error:
            "Use a valid email and a password of at least 12 characters for registration.",
        },
        400,
      );
    if (b.action === "register") {
      const passwordIssue = passwordValidationMessage(b.password);
      if (passwordIssue) return privateJson({ error: passwordIssue }, 400);
    }
    let names: { first_name: string; last_name: string } | undefined;
    if (b.action === "register") {
      try { names = { first_name: accountName(b.firstName), last_name: accountName(b.lastName) }; }
      catch { return privateJson({ error: "Enter your first and last name using up to 80 characters each." },400); }
    }
    const result =
      b.action === "register"
        ? await client.auth.signUp({
            email: b.email.trim(),
            password: b.password,
            options: {
              data: names,
              emailRedirectTo: `${requestOrigin(request)}/auth/callback`,
            },
          })
        : await client.auth.signInWithPassword({
            email: b.email.trim(),
            password: b.password,
          });
    if (b.action === "register" && existingRegistration(result))
      return privateJson({error:"An account already exists for this email. Sign in or use Forgot password.",signInRequired:true},409);
    if (result.error)
      return privateJson(
        {
          error:
            b.action === "login"
              ? "We couldn’t sign you in. Check your details or confirm your email."
              : passwordProviderMessage(result.error) ?? "Registration could not complete. Please check your details or try again.",
        },
        400,
      );
    return privateJson({
      signedIn: Boolean(result.data.session),
      confirmationRequired: !result.data.session,
    });
  } catch {
    return privateJson(
      {
        error:
          "Account service is temporarily unavailable. Your Passport is preserved.",
      },
      502,
    );
  }
}
async function handleDELETE(request: Request) {
  if (!sameOrigin(request))
    return privateJson({ error: "Please use this app." }, 403);
  if (!storageConfigured())
    return privateJson(
      { error: "Account deletion is not configured yet." },
      503,
    );
  try {
    const raw = await readRequestText(request, 1000);
    if (raw.length > 1000)
      return privateJson({ error: "Invalid deletion request." }, 400);
    const b = JSON.parse(raw);
    if (
      b.confirmation !== "DELETE" ||
      typeof b.password !== "string" ||
      !b.password ||
      b.password.length > 128
    )
      return privateJson(
        { error: "Re-enter your password and type DELETE to confirm." },
        400,
      );
    const client = await accountClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user?.email)
      return privateJson({ error: "Please sign in again." }, 401);
    const verified = await client.auth.signInWithPassword({
      email: user.email,
      password: b.password,
    });
    if (verified.error || verified.data.user?.id !== user.id)
      return privateJson({ error: "Password confirmation failed." }, 400);
    const { error } = await storageWriter().auth.admin.deleteUser(user.id);
    if (error) throw Error();
    await client.auth.signOut();
    return privateJson({ deleted: true });
  } catch {
    return privateJson(
      { error: "Could not delete the account. Please retry." },
      502,
    );
  }
}

export function GET() {
  return debugRequest("account", () => handleGET());
}

export function POST(request: Request) {
  return debugRequest("account", () => handlePOST(request));
}

export function DELETE(request: Request) {
  return debugRequest("account", () => handleDELETE(request));
}
