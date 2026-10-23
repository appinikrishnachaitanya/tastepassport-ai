import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { debugEvent } from "../agent/debug";
export function accountConfigured() {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY,
  );
}
export function storageConfigured() {
  return accountConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
const safeFetch: typeof fetch = async (url, init) => {
  const path = new URL(url instanceof Request ? url.url : String(url)).pathname;
  const service = path.startsWith("/auth/")
    ? "supabase-auth"
    : "supabase-storage";
  const started = Date.now();
  debugEvent("service.invoked", { service });
  try {
    const response = await fetch(url, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
    debugEvent("service.response", {
      service,
      status: response.status,
      elapsedMs: Date.now() - started,
    });
    return response;
  } catch (error) {
    debugEvent("service.failed", { service, elapsedMs: Date.now() - started });
    throw error;
  }
};
export async function accountClient() {
  if (!accountConfigured()) throw Error("Accounts are not configured");
  const jar = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { fetch: safeFetch },
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          for (const { name, value, options } of values)
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            });
        },
      },
    },
  );
}
/** Kept on server; used ONLY for snapshot writes after a verified user lookup. */
export function storageWriter() {
  if (!storageConfigured()) throw Error("Saving is not configured");
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: { fetch: safeFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
export { sameOrigin, requestOrigin } from "./policy.ts";
export function privateJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
