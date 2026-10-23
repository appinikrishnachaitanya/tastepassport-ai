import { sameOrigin } from "../account/policy.ts";

/** Browser writes must originate from the configured app, not another site. */
export function browserRequestError(request: Request): Response | undefined {
  if (!sameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Please use TastePassport to make this request." }, {
      status: 403, headers: { "Cache-Control": "private, no-store" },
    });
}

/** Bound memory while reading, including chunked uploads without Content-Length. */
export async function readRequestText(request: Request, maxCharacters: number): Promise<string> {
  const maxBytes = maxCharacters * 4;
  if (Number(request.headers.get("content-length")) > maxBytes) throw Error("Request too large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw Error("Request too large");
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > maxCharacters) throw Error("Request too large");
    }
    text += decoder.decode();
    if (text.length > maxCharacters) throw Error("Request too large");
    return text;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
