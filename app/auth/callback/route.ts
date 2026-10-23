import { debugRequest } from "../../../src/agent/debug";
import { accountClient, requestOrigin } from "../../../src/account/server";
async function handleGET(request: Request) {
  const url = new URL(request.url);
  const base = requestOrigin(request);
  const code = url.searchParams.get("code");
  if (code)
    try {
      const client = await accountClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error)
        return Response.redirect(
          new URL(
            url.searchParams.get("recovery") === "1"
              ? "/?account=recovery"
              : "/?account=confirmed",
            base,
          ),
        );
    } catch {}
  return Response.redirect(new URL("/?account=retry", base));
}

export function GET(request: Request) {
  return debugRequest("auth.callback", () => handleGET(request));
}
