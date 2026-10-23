/** Canonical deployment origin, with a Host-header fallback for local Next servers. */
export function requestOrigin(
  request: Request,
  configured = process.env.APP_ORIGIN,
) {
  const incoming = new URL(request.url);
  const origin = configured
    ? new URL(configured)
    : new URL(
        `${incoming.protocol}//${request.headers.get("host") || incoming.host}`,
      );
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw Error("Invalid application origin");
  return origin.origin;
}
export function sameOrigin(
  request: Request,
  configured = process.env.APP_ORIGIN,
) {
  try {
    return request.headers.get("origin") === requestOrigin(request, configured);
  } catch {
    return false;
  }
}
