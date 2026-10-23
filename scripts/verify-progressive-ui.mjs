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
async function verifyHeaderLayout() {
  assert.ok(await evaluate(`(()=>{
    const header=document.querySelector('.workspace-topbar').getBoundingClientRect();
    const brand=document.querySelector('.brand').getBoundingClientRect();
    const nav=document.querySelector('.header-controls').getBoundingClientRect();
    return brand.left>=header.left+11 && nav.right<=header.right-11 &&
      (brand.right<=nav.left+1 || brand.bottom<=nav.top+1);
  })()`), "Brand and navigation must fit without overlap");
}
async function verifyAccountCentering() {
  await evaluate("document.querySelector('.account-launch').focus();document.querySelector('.account-launch').click()");
  await waitFor("Boolean(document.querySelector('.account-dialog[open]'))");
  assert.ok(await evaluate(`(()=>{
    const r=document.querySelector('.account-dialog').getBoundingClientRect();
    return Math.abs(r.left+r.width/2-innerWidth/2)<2 &&
      Math.abs(r.top+r.height/2-innerHeight/2)<2 && r.left>=15 && r.right<=innerWidth-15 && r.top>=15 && r.bottom<=innerHeight-15;
  })()`), "Account dialog must be centered and contained in the viewport");
  if (await evaluate("innerWidth===390 || innerWidth===1440")) {
    await shot(`/tmp/tastepassport-account-${await evaluate("innerWidth")}.png`);
  }
  await evaluate("document.querySelector('[aria-label=\"Close account\"]').click()");
  await waitFor("document.activeElement.classList.contains('account-launch')");
}
async function verifyAssistantScrolling() {
  assert.ok(await evaluate(`(()=>{
    const dialog=document.querySelector('#taste-concierge');
    const body=dialog.querySelector('.concierge-body');
    const panel=body.querySelector('[role="tabpanel"]');
    const fixture=document.createElement('p');
    fixture.dataset.scrollFixture='true';
    fixture.textContent='Layout stress text. '.repeat(600);
    (panel.querySelector('.conversation') || panel).append(fixture);
    const scrollAreas=[dialog,...dialog.querySelectorAll('*')].filter(el=>{
      if(el.tagName==='TEXTAREA')return false;
      const style=getComputedStyle(el);
      return /auto|scroll/.test(style.overflowY) && el.scrollHeight>el.clientHeight+1;
    });
    const header=dialog.querySelector('.concierge-heading');
    const top=header.getBoundingClientRect().top;
    body.scrollTop=body.scrollHeight;
    const composer=dialog.querySelector('.composer');
    const rect=composer?.getBoundingClientRect();
    const valid=document.documentElement.style.overflow==='hidden' &&
      document.body.style.overflow==='hidden' && scrollAreas.length===1 &&
      scrollAreas[0]===body && Math.abs(header.getBoundingClientRect().top-top)<1 &&
      (!composer || (composer.parentElement===dialog && rect.top>=body.getBoundingClientRect().bottom-1 && rect.bottom<=innerHeight));
    fixture.remove();
    body.scrollTop=0;
    return valid;
  })()`), 'Assistant must have one content scroller, a pinned composer/header and a locked page');
}
await call("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
});
await call("Page.navigate", { url: appUrl });
await waitFor("Boolean(document.querySelector('#taste-input'))");
await new Promise((r) => setTimeout(r, 500));
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
assert.equal(await evaluate("document.activeElement.classList.contains('skip-link')"), true);
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
assert.equal(await evaluate("document.activeElement.id"), "passport-content");
assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('#taste-input')).fontSize)>=16"));
assert.ok(await evaluate("document.querySelector('.build-map').getBoundingClientRect().height>=52"));
for (const selector of ['#origin', '#destination', '#taste-input']) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  assert.ok(await evaluate(`(()=>{
    const input=document.querySelector(${JSON.stringify(selector)});
    const wrapper=input.closest('.field-with-icon,.taste-input-shell');
    const control=getComputedStyle(input), frame=getComputedStyle(wrapper);
    return control.outlineStyle==='none' && control.boxShadow==='none' &&
      control.borderTopWidth==='0px' && frame.boxShadow==='none' && parseFloat(frame.borderTopWidth)>0;
  })()`), 'Compound fields must show one frame, without an inner outline or glow');
}
for (const width of [320, 390, 640, 768, 1024, 1440]) {
  await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"), false);
  await verifyHeaderLayout();
  await verifyAccountCentering();
}
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
assert.ok(
  !(await evaluate(
    "Boolean(document.querySelector('.agent-pane,.activity-feed,.persona-story,.assistant-launch,.cultural-reveal'))",
  )),
);
assert.equal(
  await evaluate("document.querySelectorAll('.primary-button').length"),
  1,
);
assert.equal(
  await evaluate("document.querySelector('.primary-button').disabled"),
  true,
);
await shot("/tmp/tastepassport-step1.png");
await input("#origin", "Bengaluru");
await input("#destination", "Toronto", "HTMLSelectElement");
for (const taste of ["A.R. Rahman", "Interstellar", "Indian cuisine"])
  await clickText(taste);
// Activities are now explicit; tastes alone must not force these chapters.
for(const activity of ['Dining','Coffee','Music','Places & culture'])
  await evaluate(`[...document.querySelectorAll('.activity-options button')].find(b=>b.textContent.trim()===${JSON.stringify(activity)}).click()`);
assert.equal(
  await evaluate("document.querySelectorAll('.taste-chip').length"),
  3,
);
await clickText("Find my taste matches");
await waitFor(
  "Boolean(document.querySelector('.confirmation-list')) || Boolean(document.querySelector('.error-message'))",
);
assert.ok(
  !(await evaluate("Boolean(document.querySelector('.error-message'))")),
);
assert.equal(
  await evaluate("document.querySelectorAll('.confirmation-card').length"),
  3,
);
for (let i = 0; i < 3; i++) {
  const selected = await evaluate(
    `(()=>{const s=document.querySelectorAll('.inline-match select')[${i}];return [...s.options].find(o=>o.value${i === 1 ? "&&o.textContent.includes('2014')" : i === 2 ? "&&o.value==='urn:tag:cuisine:qloo:indian'" : ""}).value})()`,
  );
  await input(
    `.confirmation-card:nth-child(${i + 1}) select`,
    selected,
    "HTMLSelectElement",
  );
}
assert.equal(
  await evaluate(
    "document.querySelectorAll('.confirmation-card.confirmed').length",
  ),
  3,
);
await clickText("Help me explore");
await shot("/tmp/tastepassport-step2.png");
await clickText("Create my TastePassport");
await waitFor(
  "Boolean(document.querySelector('.passport-cover')) || Boolean(document.querySelector('.error-message'))",
);
await settled();
assert.ok(
  !(await evaluate("Boolean(document.querySelector('.error-message'))")),
);
assert.equal(
  await evaluate(
    "document.querySelector('#passport-title').innerText.replace(/\\s+/g,' ')",
  ),
  "Your Toronto TastePassport",
);
assert.ok(
  await evaluate("document.querySelectorAll('.discovery-card').length>0"),
);
assert.ok(await evaluate("!document.querySelector('.passport-cover').innerText.includes('Qloo')"));
assert.ok(await evaluate("document.querySelector('.day-out-reveal > summary').innerText.includes('Plan a day out')"));
for (const width of [320, 390, 640, 768, 1024, 1440]) {
  await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"), false);
  await verifyHeaderLayout();
  await verifyAccountCentering();
  assert.ok(await evaluate(`(()=>{

    const button=document.querySelector('.assistant-launch').getBoundingClientRect();
    return getComputedStyle(document.querySelector('.assistant-launch')).position==='fixed' && button.left>=0 && button.right<=innerWidth && button.top>=0 && button.bottom<=innerHeight && button.height>=44;
  })()`), "Ask action must stay inside the viewport");
}
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
assert.equal(
  await evaluate(
    "document.querySelector('.familiarity-options button:nth-child(3)').getAttribute('aria-pressed')",
  ),
  "true",
);
assert.ok(!(await evaluate("document.querySelector('.cultural-reveal').open")));
assert.ok(
  !(await evaluate("Boolean(document.querySelector('.why-section[open]'))")),
);
assert.ok(!(await evaluate("document.querySelector('#taste-concierge').open")));
await clickText('Plan a day');
await evaluate("document.querySelector('.day-out-reveal').scrollIntoView({behavior:'instant',block:'start'})");
const outingBefore = await evaluate("[...document.querySelectorAll('.day-out-stops select')].map(s=>s.value)");
assert.ok(outingBefore.some(Boolean));
assert.ok(await evaluate("[...document.querySelectorAll('#day-out-Eat option')].length>2"));
await input("#day-out-Eat", await evaluate("document.querySelector('#day-out-Eat option:last-child').value"), "HTMLSelectElement");
const outingAfter = await evaluate("[...document.querySelectorAll('.day-out-stops select')].map(s=>s.value)");
assert.deepEqual(outingAfter.slice(0, 2), outingBefore.slice(0, 2));
assert.notEqual(outingAfter[2], outingBefore[2]);
assert.ok(await evaluate("document.querySelector('.day-out-plan').textContent.includes('not a timed route or a reservation')"));
// Inspect the actual download payload without writing Qloo data into the repository.
await evaluate("window.__outingBlob=null;window.__originalCreateObjectURL=URL.createObjectURL;URL.createObjectURL=(blob)=>{window.__outingBlob=blob;return window.__originalCreateObjectURL(blob)}");
await evaluate("document.querySelector('.download-plan').click()");
assert.match(await evaluate("window.__outingBlob.text()"), /My day out in Toronto/);
await evaluate("URL.createObjectURL=window.__originalCreateObjectURL");await clickText('Discover');
assert.equal(
  await evaluate(
    "document.querySelector('#section-Eat').closest('section').querySelectorAll('.discovery-card').length",
  ),
  3,
);
await evaluate(
  "document.querySelector('#section-Eat').closest('section').querySelector('.category-more').click()",
);
assert.ok(
  await evaluate(
    "document.querySelector('#section-Eat').closest('section').querySelectorAll('.discovery-card').length>3",
  ),
);
await evaluate(
  "document.querySelector('#section-Eat').closest('section').querySelector('.category-more').click()",
);
await evaluate(
  "document.querySelector('#section-Eat').closest('section').querySelector('.feedback-actions button').click()",
);
await settled();
await evaluate(
  "document.querySelector('.passport-navigation button:nth-child(2)').click()",
);
assert.equal(
  await evaluate(
    "document.querySelectorAll('.my-vibe .discovery-card').length",
  ),
  1,
);
await evaluate(
  "document.querySelector('.passport-navigation button:first-child').click()",
);
await clickText("Sign in");
await waitFor("Boolean(document.querySelector('.account-dialog[open]'))");
assert.ok(
  await evaluate(
    "document.querySelector('.account-dialog').textContent.includes('Accounts are coming online')",
  ),
);
await evaluate(
  "document.querySelector('[aria-label=\"Close account\"]').click()",
);
await shot("/tmp/tastepassport-step3.png");
const initialIds = await evaluate(
  "[...document.querySelectorAll('.discovery-card')].map(c=>c.dataset.entityId)",
);
await evaluate("document.querySelector('.assistant-launch').focus()");
await clickText("Ask TastePassport");
await waitFor("document.querySelector('#taste-concierge').open");
assert.ok(await evaluate("!document.querySelector('.conversation').textContent.includes('looking up your cultural signals')"));
assert.ok(await evaluate("Boolean(document.querySelector('.concierge-starters')) && !document.querySelector('.conversation').textContent.includes('Updated Eat')"));
if (await evaluate("Boolean(document.querySelector('.concierge-starters button'))")) {
  await evaluate("document.querySelector('.concierge-starters button').click()");
  assert.equal(await evaluate("document.querySelector('#conversation-input').value"), 'Find somewhere quieter to eat');
}
for (const [width, height] of [[1440, 900], [768, 900], [390, 844], [320, 640], [390, 480]]) {
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width<768 });
  await verifyAssistantScrolling();
  assert.equal(await evaluate("document.querySelector('#taste-concierge').scrollWidth>document.querySelector('#taste-concierge').clientWidth"), false);
}
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await shot('/tmp/tastepassport-assistant-desktop.png');
await clickText("Adjust filters");
assert.ok(
  await evaluate(
    "Boolean(document.querySelector('#manual-panel .guided-panel'))",
  ),
);
await verifyAssistantScrolling();
assert.ok(await evaluate("[...document.querySelectorAll('#manual-panel input[type=checkbox]')].every(el=>el.getBoundingClientRect().height<=22)"));
await shot('/tmp/tastepassport-assistant-filters.png');
await evaluate(
  "document.querySelector('[aria-label=\"Close Taste Concierge\"]').click()",
);
await waitFor("!document.querySelector('#taste-concierge').open");
assert.ok(await evaluate("document.documentElement.style.overflow!=='hidden' && document.body.style.overflow!=='hidden'"));
assert.ok(await evaluate("document.activeElement.classList.contains('assistant-launch')"));
assert.deepEqual(
  await evaluate(
    "[...document.querySelectorAll('.discovery-card')].map(c=>c.dataset.entityId)",
  ),
  initialIds,
);
await evaluate("document.querySelector('.why-section').open=true");
assert.equal(await evaluate("document.querySelector('.qloo-evidence')===null"),true);
await evaluate("document.querySelector('.why-section').open=false");
await clickText('Your connections');
assert.ok(
  await evaluate("document.querySelectorAll('.connection-routes button').length>0 && document.querySelectorAll('.connected-results li').length>0"),
);
await clickText('Discover');
const first = await evaluate(
  "document.querySelector('#section-Eat').closest('section').querySelectorAll('.discovery-card')[1].dataset.entityId",
);
const music = await evaluate(
  "document.querySelector('#section-Music').closest('section').innerText",
);
await evaluate(
  "document.querySelector('#section-Eat').closest('section').querySelectorAll('.discovery-card')[1].querySelectorAll('.feedback-actions button')[1].click()",
);
await waitFor("Boolean(document.querySelector('.match-dialog[open]'))");
await evaluate(
  "[...document.querySelectorAll('.feedback-reasons label')].find(l=>l.textContent.includes('Too mainstream')).querySelector('input').click()",
);
await new Promise((r) => setTimeout(r, 100));
await evaluate(
  "document.querySelector('.match-dialog .primary-button').click()",
);
await settled();
assert.ok(
  !(await evaluate(
    `Boolean(document.querySelector('[data-entity-id='+CSS.escape(${JSON.stringify(first)})+']'))`,
  )),
);
assert.equal(
  await evaluate(
    "document.querySelector('#section-Music').closest('section').innerText",
  ),
  music,
);
await clickText("Ask TastePassport");
await clickText("Adjust filters");
await input(".guided-panel select", "Culture", "HTMLSelectElement");
await evaluate(
  "document.querySelector('.guided-panel .primary-button').click()",
);
await settled();
await evaluate(
  "document.querySelector('[aria-label=\"Close Taste Concierge\"]').click()",
);
assert.ok(
  await evaluate("Boolean(document.querySelector('#section-Culture'))"),
);
assert.equal(
  await evaluate(
    "document.querySelector('#section-Music').closest('section').innerText",
  ),
  music,
);
await clickText("Ask TastePassport");
await evaluate("document.querySelector('#ask-tab').click()");
await input(
  "#conversation-input",
  "Forget food. Show me something cultural.",
  "HTMLTextAreaElement",
);
await evaluate("document.querySelector('.composer button').click()");
await settled();
assert.ok(!(await evaluate("Boolean(document.querySelector('#section-Eat'))")));
await evaluate(
  "document.querySelector('[aria-label=\"Close Taste Concierge\"]').click()",
);
const comparisonAvailable = await evaluate(
  "Boolean(document.querySelector('.comparison-reveal'))",
);
if (comparisonAvailable) {
  assert.ok(
    !(await evaluate("document.querySelector('.comparison-reveal').open")),
  );
  await evaluate("document.querySelector('.comparison-reveal').open=true");
  await clickText("Compare recommendation approaches");
  await waitFor(
    "Boolean(document.querySelector('.comparison-panel')) || Boolean(document.querySelector('.compare-control [role=status]'))",
  );
  if (await evaluate("Boolean(document.querySelector('.comparison-panel'))")) {
    console.log("Live browser same-request comparison: PASS");
  } else {
    console.log("Live comparison generation unavailable; recovery displayed.");
  }
  await evaluate("document.querySelector('.comparison-reveal').open=false");
} else {
  console.log(
    "Model-only comparison UNRUN: this production view hides the development-only comparison. Native Gemini acceptance is checked separately.",
  );
  assert.ok(
    !(await evaluate("Boolean(document.querySelector('.compare-control'))")),
  );
}
await evaluate(
  "document.querySelector('.passport-navigation button:nth-child(2)').click()",
);
assert.equal(
  await evaluate(
    "document.querySelectorAll('.my-vibe .discovery-card').length",
  ),
  1,
);
await evaluate(
  "document.querySelector('.passport-navigation button:first-child').click()",
);
await clickText("Ask TastePassport");
const beforeReset = await evaluate(
  "[...document.querySelectorAll('.discovery-card')].map(c=>c.dataset.entityId)",
);
await clickText("Reset conversation");
await settled();
assert.deepEqual(
  await evaluate(
    "[...document.querySelectorAll('.discovery-card')].map(c=>c.dataset.entityId)",
  ),
  beforeReset,
);
await evaluate(
  "document.querySelector('[aria-label=\"Close Taste Concierge\"]').click()",
);
await call("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});
await clickText('Plan a day');
assert.equal(
  await evaluate("document.documentElement.scrollWidth>innerWidth"),
  false,
);
await evaluate("document.querySelector('.day-out-reveal').scrollIntoView({behavior:'instant',block:'start'})");
await shot("/tmp/tastepassport-day-out-mobile.png");
await clickText("Ask TastePassport");
assert.ok(
  await evaluate(
    "document.querySelector('#taste-concierge').getBoundingClientRect().bottom<=innerHeight+1",
  ),
);
await shot("/tmp/tastepassport-assistant-mobile.png");
await evaluate(
  "document.querySelector('[aria-label=\"Close Taste Concierge\"]').click()",
);
await clickText("New Passport");
await waitFor("Boolean(document.querySelector('#taste-input'))");
assert.equal(
  await evaluate("document.querySelectorAll('.taste-chip').length"),
  0,
);
assert.equal(await evaluate("document.querySelector('#origin').value"), "");
assert.equal(
  await evaluate("document.querySelector('#destination').value"),
  "",
);
assert.ok(
  !(await evaluate(
    "Boolean(document.querySelector('.discovery-card,.assistant-launch,.cultural-reveal'))",
  )),
);
assert.equal(
  await evaluate("document.documentElement.scrollWidth>innerWidth"),
  false,
);
await shot("/tmp/tastepassport-onboarding-mobile.png");
console.log(
  "Production browser progressive UX: PASS. Three steps, curated previews, editable day-out plan and download, My Vibe persistence, account setup fallback, initial Explore queries, collapsed evidence/bridge, drawer persistence, manual refinement, feedback, both resets, 390px layout.",
);
ws.close();
