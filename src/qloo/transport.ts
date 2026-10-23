import { debugEvent } from "../agent/debug.ts";
/** One in-flight request per process. Cache private results for five minutes.
 * Cross-process quotas still need a shared limiter when deployed. */
export function retryDelay(
  attempt: number,
  retryAfter: string | null,
  now = Date.now(),
): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  const requested = Number.isFinite(seconds)
    ? seconds * 1000
    : retryAfter
      ? Date.parse(retryAfter) - now
      : 0;
  return Math.min(30_000, Math.max(1000 * 2 ** attempt, requested || 0));
}
export async function fetchWithRetry(
  url: URL,
  init: RequestInit,
  fetcher = fetch,
  pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    const retryable = response.status === 429 || [502,503,504].includes(response.status);
    if (!retryable || attempt >= 2) return response;
    const header = response.headers.get("retry-after");
    // A long server cooldown should surface to the user, rather than retry early.
    if (
      header &&
      (Number(header) > 30 || Date.parse(header) - Date.now() > 30_000)
    )
      return response;
    await response.body?.cancel();
    const delay = retryDelay(attempt, header);
    debugEvent("qloo.retry", {
      status: response.status,
      attempt: attempt + 1,
      delayMs: delay,
    });
    await pause(delay);
  }
}
const cache = new Map<string, { until: number; value: unknown }>();
let queue: Promise<unknown> = Promise.resolve();
let last = 0;
export function paced<T>(
  key: string,
  run: () => Promise<T>,
  ttl = 300_000,
  signal?: AbortSignal,
): Promise<T> {
  const job = queue.then(async () => {
    signal?.throwIfAborted();
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) {
      debugEvent("qloo.cache_hit");
      return hit.value as T;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 800 - (Date.now() - last))),
    );
    signal?.throwIfAborted();
    try {
      const value = await run();
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { value, until: Date.now() + ttl });
      return value;
    } finally {
      last = Date.now();
    }
  });
  queue = job.catch(() => undefined);
  if (!signal) return job;
  let abort: (()=>void) | undefined;
  return Promise.race([job, new Promise<never>((_,reject)=>{
    abort=()=>reject(signal.reason ?? Error("Qloo request cancelled"));
    if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});
  })]).finally(()=>{if(abort)signal.removeEventListener("abort",abort);});
}
