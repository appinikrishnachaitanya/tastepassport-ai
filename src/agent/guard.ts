export class TurnGuard {
  private external?: AbortSignal;
  private calls = 0;
  private modelCalls = 0;
  private responseCalls = 0;
  private seen = new Set<string>();
  private deadline: number;
  private limit: number;
  private cancellation = new AbortController();
  get signal() {
    return this.external
      ? AbortSignal.any([this.cancellation.signal, this.external])
      : this.cancellation.signal;
  }
  constructor(limit = 4, timeout = 90_000, external?: AbortSignal) {
    this.external = external;
    this.limit = limit;
    this.deadline = Date.now() + timeout;
  }
  async run<T>(
    name: string,
    args: unknown,
    call: () => Promise<T>,
  ): Promise<T> {
    if (this.signal.aborted) throw Error("Turn cancelled");
    const signature = JSON.stringify([name, args]);
    if (this.seen.has(signature)) throw Error("Duplicate tool call prevented");
    if (this.calls >= this.limit) throw Error("Tool-call budget reached");
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw Error("Turn timeout");
    this.seen.add(signature);
    this.calls++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        call(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.cancellation.abort();
            reject(Error("Turn timeout"));
          }, remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  /** Model planning is timed separately and does not consume the Qloo budget. */
  async model<T>(call: () => Promise<T>): Promise<T> {
    if (this.signal.aborted) throw Error("Turn cancelled");
    if (++this.modelCalls > 2) throw Error("Model planning budget reached");
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw Error("Turn timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([call(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.cancellation.abort(); reject(Error("Turn timeout")); }, remaining);
      })]);
    } finally { clearTimeout(timer); }
  }
  /** One optional tool-free response pass; timeout must not discard validated results. */
  async respond<T>(call:(signal:AbortSignal)=>Promise<T>):Promise<T> {
    if (++this.responseCalls > 1) throw Error("Response budget reached");
    const remaining = Math.min(8000, this.deadline - Date.now());
    if (remaining < 500 || this.signal.aborted) throw Error("Response budget unavailable");
    const controller = new AbortController();
    const signal = AbortSignal.any([this.signal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([call(signal), new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{controller.abort();reject(Error("Response timeout"));},remaining);
      })]);
    } finally { clearTimeout(timer); }
  }
  get count() {
    return this.calls;
  }
}
