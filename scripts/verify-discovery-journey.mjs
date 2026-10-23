/** Real-browser/live-backend acceptance. Requires an isolated Chromium CDP profile. */
import fs from "node:fs/promises";
const appUrl = process.env.PASSPORT_TEST_URL ?? "http://127.0.0.1:3001";
const cdpUrl = process.env.PASSPORT_CDP_URL ?? "http://127.0.0.1:9231";
const artifactDir = process.env.PASSPORT_TEST_ARTIFACTS ?? "/tmp";
await fs.mkdir(artifactDir, { recursive: true });
import assert from "node:assert/strict";
const tabs = await (await fetch(cdpUrl + "/json")).json();
const ws = new WebSocket(
  tabs.find((t) => t.type === "page").webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const jobs = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    jobs.get(m.id)?.(m);
    jobs.delete(m.id);
  }
});
function call(method, params = {}) {
  return new Promise((r, j) => {
    const n = ++id;
    jobs.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => {
      if (jobs.has(n)) {
        jobs.delete(n);
        j(Error("CDP timeout"));
      }
    }, 20000).unref();
  });
}
async function evaluate(expression) {
  const m = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (m.result?.exceptionDetails) throw Error("Browser evaluation failed");
  return m.result?.result?.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 220; i++) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("UI state timed out");
}
async function input(selector, value, type = "HTMLInputElement") {
  await evaluate(
    `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${type}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await new Promise((r) => setTimeout(r, 100));
}
async function clickText(text) {
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`,
  );
}
async function settled() {
  await new Promise((r) => setTimeout(r, 200));
  await waitFor("!document.querySelector('.compact-progress')");
}
async function shot(path) {
  const s = await call("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(
    `${artifactDir}/${path.split("/").at(-1)}`,
    Buffer.from(s.result.data, "base64"),
  );
}

await call("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await call("Page.navigate", { url: appUrl });
await waitFor("Boolean(document.querySelector('#taste-input'))");
await evaluate(
  `window.__livePassport=null; window.__liveReply=null; const original=window.fetch; window.fetch=async(...args)=>{const r=await original(...args);const url=String(args[0]);if(url==='/api/passport')r.clone().json().then(b=>window.__livePassport=b);if(url==='/api/agent/turn')r.clone().text().then(text=>{for(const line of text.trim().split('\\n')){try{const b=JSON.parse(line);if(b.type==='result')window.__liveReply=b.reply;}catch{}}});return r;}`,
);
await input("#origin", "Bengaluru");
await input("#destination", "Toronto", "HTMLSelectElement");
const different = process.env.PASSPORT_PROFILE === "different";
for (const taste of different
  ? ["Taylor Swift", "Inception", "Specialty coffee"]
  : ["A.R. Rahman", "Interstellar", "Indian cuisine"]) {
  await input("#taste-input", taste);
  await evaluate(
    "document.querySelector('[aria-label=\"Add taste\"]').click()",
  );
}
await clickText("Find my taste matches");
await waitFor("Boolean(document.querySelector('.confirmation-list'))");
for (let i = 0; i < 3; i++) {
  const id = await evaluate(
    `(()=>{const s=document.querySelectorAll('.inline-match select')[${i}];return [...s.options].find(o=>o.value${i === 1 ? (different ? "&&o.textContent.includes('2010')" : "&&o.textContent.includes('2014')") : i === 2 && !different ? "&&o.value==='urn:tag:cuisine:qloo:indian'" : ""}).value})()`,
  );
  await input(
    `.confirmation-card:nth-child(${i + 1}) select`,
    id,
    "HTMLSelectElement",
  );
}
await clickText("Feels like home");
await clickText("Create my TastePassport");
await waitFor("Boolean(document.querySelector('.passport-cover'))");
await settled();
const before = await evaluate("window.__livePassport.session");
assert.ok(before);
console.log(
  different
    ? "Live browser different profile counts"
    : "Live browser original profile counts",
  JSON.stringify(
    Object.fromEntries(
      ["Eat", "Coffee", "Culture", "Music"].map((s) => [
        s,
        before.cards.filter((c) => c.section === s).length,
      ]),
    ),
  ),
);
await evaluate("document.querySelector('.assistant-launch').click()");
const message =
  "Show me museums or art galleries in Toronto for the culture stop, not restaurants";
await input("#conversation-input", message, "HTMLTextAreaElement");
await evaluate(
  "document.querySelector('[aria-label=\"Send message\"]').click()",
);
await waitFor(
  `document.querySelector('.concierge-body').textContent.includes(${JSON.stringify(message)})`,
);
await waitFor(
  "window.__liveReply !== null || Boolean(document.querySelector('#taste-concierge [role=alert]'))",
);
await settled();
assert.ok(
  await evaluate("!document.querySelector('#conversation-input').disabled"),
);
const reply = await evaluate("window.__liveReply");
assert.ok(reply, "Live refinement must complete");
assert.deepEqual(
  reply.state.cards.filter((c) => c.section !== "Culture"),
  before.cards.filter((c) => c.section !== "Culture"),
);
assert.ok(
  !reply.state.pending,
  "Generic venue categories should not require taste confirmation",
);
assert.ok(reply.state.cards.some((c) => c.section === "Culture"));
console.log(
  "Live browser refinement",
  JSON.stringify({
    mode: reply.mode,
    changed: reply.changed,
    unrelatedPreserved: true,
  }),
);
await evaluate(
  "document.querySelector('[aria-label=\"Close Taste Concierge\"]').click()",
);
await clickText("Plan a day");
for (const section of ["Coffee", "Culture", "Eat"]) {
  const value = await evaluate(
    `document.querySelector('#day-out-${section} option[value]:not([value=""])')?.value`,
  );
  if (value) await input("#day-out-" + section, value, "HTMLSelectElement");
}
const chosen = await evaluate(
  "[...document.querySelectorAll('.day-out-stops select')].filter(s=>s.value).map(s=>s.selectedOptions[0].textContent)",
);
await evaluate(
  "window.__outingBlob=null;window.__objectURL=URL.createObjectURL;URL.createObjectURL=b=>{window.__outingBlob=b;return window.__objectURL(b)};document.querySelector('.download-plan').click()",
);
const exported = await evaluate("window.__outingBlob.text()");
for (const name of chosen) assert.ok(exported.includes(name));
await evaluate("URL.createObjectURL=window.__objectURL");
for (const width of [320, 390, 768, 1440]) {
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  assert.equal(
    await evaluate("document.documentElement.scrollWidth>innerWidth"),
    false,
  );
  await shot(`/tmp/tastepassport-integrity-${width}.png`);
}
await evaluate("document.querySelector('.assistant-launch').focus()");
assert.equal(
  await evaluate(
    'document.activeElement.classList.contains("assistant-launch")',
  ),
  true,
);
console.log(
  "Live browser PASS: Toronto onboarding, immediate submitted message, bounded refinement, unrelated chapters preserved, planner selection/export, mobile containment and keyboard focus.",
);
ws.close();
