/**
 * Gemini server-side 502 recovery: one initial request and at most two retries.
 * 400 validation failures are permanent and must not be retried.
 * This wraps model inference ONLY, never MCP/REST tool executions.
 */
export const MAX_GEMINI_502_RETRIES = 2;
function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return;
  const candidate = error as {status?: unknown; cause?: {status?: unknown}};
  const status = candidate.status ?? candidate.cause?.status;
  return typeof status === "number" ? status : undefined;
}
async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let onAbort: () => void = () => {};
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(signal?.reason ?? Error("Request cancelled")); };
    signal?.addEventListener("abort", onAbort, {once:true});
    if (signal?.aborted) onAbort();
  });
}
export async function retryGemini502<T>(
  request: () => Promise<T>,
  signal?: AbortSignal,
  wait: (ms:number, signal?:AbortSignal) => Promise<void> = pause,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await request(); }
    catch (error) {
      if (statusOf(error) !== 502 || attempt >= MAX_GEMINI_502_RETRIES || signal?.aborted)
        throw error;
      // Google recommends exponential backoff and jitter. 1s then ~2s.
      const delay = 1000 * (2 ** attempt) + Math.floor(Math.random() * 200);
      await wait(delay, signal);
    }
  }
}
