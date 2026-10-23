import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { browserRequestError, readRequestText } from "../src/http/request.ts";
import config from "../next.config.ts";

test("request reader bounds chunked uploads, cancels overflow and preserves Unicode", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(100))); },
    cancel() { cancelled = true; },
  });
  const request = new Request("http://localhost", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readRequestText(request, 10), /too large/);
  assert.equal(cancelled, true);
  const bytes = new TextEncoder().encode("日本語");
  const unicode = new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close();
  } });
  assert.equal(await readRequestText(new Request("http://localhost", { method: "POST", body: unicode, duplex: "half" } as RequestInit), 3), "日本語");
  await assert.rejects(readRequestText(new Request("http://localhost", { method: "POST", headers: {"Content-Length":"1000000"}, body: "x" }), 10));
});

test("browser guard rejects missing origins and cross-site fetch metadata", () => {
  const before = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://app.example";
  try {
    const invalidHeaders: Record<string, string>[] = [{}, { Origin: "https://evil.example" }, { Origin: "https://app.example", "Sec-Fetch-Site": "cross-site" }];
    for (const headers of invalidHeaders)
      assert.equal(browserRequestError(new Request("https://app.example", { headers }))?.status, 403);
    assert.equal(browserRequestError(new Request("https://app.example", { headers: { Origin: "https://app.example" } })), undefined);
  } finally {
    if (before === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = before;
  }
});

test("all guest writes reject cross-site requests before reading bodies or calling providers", () => {
  const output = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    process.env.APP_ORIGIN='http://localhost';process.env.LOG_LEVEL='error';
    let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected network call');};
    const paths=['agent/turn','agent/intelligence','agent/comparison','agent/interpret','agent/resolve','resolve','passport','agent/session'];
    for(const path of paths){
      const route=await import('./app/api/'+path+'/route.ts');
      for(const method of path==='agent/session'?['POST','DELETE']:['POST']){
        for(const origin of [undefined,'https://evil.example']){
          const request=new Request('http://localhost/api/'+path,{method,headers:origin?{Origin:origin}:{},body:'not-json'});
          const response=await route[method](request);
          assert.equal(response.status,403,path+' '+method);
          assert.equal(request.bodyUsed,false);
          assert.match(response.headers.get('cache-control'),/no-store/);
        }
      }
    }
    const {DELETE}=await import('./app/api/agent/session/route.ts');
    assert.equal((await DELETE(new Request('http://localhost/api/agent/session',{method:'DELETE',headers:{Origin:'http://localhost'},body:JSON.stringify({sessionId:'invalid'})}))).status,400);
    assert.equal(calls,0);console.log('Guest origin boundaries PASS');
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 20000 });
  assert.match(output, /Guest origin boundaries PASS/);
});

test("all pages receive framing, MIME and referrer safeguards", async () => {
  const rules = await config.headers!();
  const headers = Object.fromEntries(rules.find(rule => rule.source === "/:path*")!.headers.map(header => [header.key, header.value]));
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
});
