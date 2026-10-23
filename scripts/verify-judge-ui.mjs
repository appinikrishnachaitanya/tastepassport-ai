/** Real-browser/live-backend acceptance. Requires an isolated Chromium CDP profile. */
import fs from "node:fs/promises";
const conversation = process.env.PASSPORT_JUDGE_SCENARIO === "conversation";
const vegetarian = conversation || process.env.PASSPORT_JUDGE_SCENARIO === "vegetarian";
const city = vegetarian ? "Toronto" : "London";
const request = vegetarian ? "Find cheaper vegetarian Indian food in Toronto and explain why it fits my tastes." : "Find quieter Indian restaurants in London, moderate budget, minimum rating 4.5. Keep my music and movies unchanged.";
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
  await evaluate(`(()=>{const nav=document.querySelector('.passport-navigation');if(nav && !nav.getClientRects().length && [...nav.querySelectorAll('button')].some(button=>button.textContent.includes(${JSON.stringify(text)})))document.querySelector('.passport-menu-toggle').click();})()`);

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

try {
await call("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await call("Page.navigate",{url:appUrl});
await waitFor("Boolean(document.querySelector('#destination:not(:disabled)'))");
await evaluate(`(()=>{const native=window.fetch;window.__judgeReplies=[];window.fetch=async(...args)=>{const response=await native(...args);const url=String(args[0]);if(url==='/api/passport')response.clone().json().then(value=>window.__judgeInitial=value);if(url==='/api/agent/turn')response.clone().text().then(text=>{for(const line of text.trim().split('\\n')){try{const message=JSON.parse(line);if(message.type==='result')window.__judgeReplies.push(message.reply);}catch{}}});return response;};})()`);
await input('#destination',city,'HTMLSelectElement');
for(const seed of ['A.R. Rahman','Interstellar','Indian cuisine'])await clickText(seed);
for(const activity of ['Dining','Music','Movies'])await evaluate(`[...document.querySelectorAll('.activity-options button')].find(button=>button.textContent.trim()===${JSON.stringify(activity)}).click()`);
await clickText('Find my taste matches');
await waitFor("document.querySelectorAll('.inline-match select').length===3");
for(let index=0;index<3;index++) {
 const value=await evaluate(`(()=>{const select=document.querySelectorAll('.inline-match select')[${index}];return [...select.options].find(option=>option.value&&${index===0?"option.textContent.includes('artist')":index===1?"option.textContent.includes('2014')":"option.value==='urn:tag:cuisine:qloo:indian'"}).value})()`);
 await input(`.confirmation-card:nth-child(${index+1}) select`,value,'HTMLSelectElement');
}
await clickText('Create my TastePassport');
await waitFor("Boolean(document.querySelector('.passport-cover')) && Boolean(window.__judgeInitial)");
await evaluate("document.querySelector('.assistant-launch').click()");
await input('#conversation-input',request,'HTMLTextAreaElement');
await evaluate("document.querySelector('[aria-label=\"Send message\"]').click()");
await waitFor("window.__judgeReplies.length===1 && !document.querySelector('#conversation-input').disabled");
assert.deepEqual(await evaluate("window.__judgeReplies[0].changed"),['Eat']);
assert.equal(await evaluate("window.__judgeReplies[0].state.providerHealth"),'healthy','Native model must complete, not silently fall back');
for(const section of ['Music','Movies'])assert.equal(await evaluate(`JSON.stringify(window.__judgeInitial.cards.filter(card=>card.section===${JSON.stringify(section)}))===JSON.stringify(window.__judgeReplies[0].state.cards.filter(card=>card.section===${JSON.stringify(section)}))`),true);
assert.equal(await evaluate(vegetarian
 ? "window.__judgeReplies[0].state.cards.filter(card=>card.section==='Eat').every(card=>card.intelligence.commercial.priceLevel<=2&&card.evidence.params['filter.tags'].includes(':dietary_option:'))"
 : "window.__judgeReplies[0].state.cards.filter(card=>card.section==='Eat').every(card=>card.intelligence.commercial.priceLevel<=2&&card.intelligence.quality.businessRating>=4.5)"),true);
assert.equal(await evaluate("Boolean(window.__judgeReplies[0].state.pending)"),false);
assert.equal(await evaluate(`document.querySelector('[aria-label="Maximum price"]').value`),'2','Budget control must reflect the cap applied by conversation');
assert.equal(await evaluate("document.querySelector('.together-reveal').textContent.includes('cannot be used as Together comparison inputs')"),true);
let repliesBeforeCinema = 1;
if (conversation) {
 for (const question of ['Why these suggestions?', 'What filters are saved?']) {
  await input('#conversation-input',question,'HTMLTextAreaElement');
  await evaluate("document.querySelector('[aria-label=\"Send message\"]').click()");
  repliesBeforeCinema++;
  await waitFor(`window.__judgeReplies.length===${repliesBeforeCinema} && !document.querySelector('#conversation-input').disabled`);
  assert.deepEqual(await evaluate(`window.__judgeReplies[${repliesBeforeCinema-1}].changed`),[]);
  assert.equal(await evaluate(`JSON.stringify(window.__judgeReplies[0].state.cards)===JSON.stringify(window.__judgeReplies[${repliesBeforeCinema-1}].state.cards)`),true);
 }
 await input('#conversation-input','Make those cheaper. Keep music and movies unchanged.','HTMLTextAreaElement');
 await evaluate("document.querySelector('[aria-label=\"Send message\"]').click()");
 repliesBeforeCinema++;
 await waitFor(`window.__judgeReplies.length===${repliesBeforeCinema} && !document.querySelector('#conversation-input').disabled`);
 assert.equal(await evaluate(`window.__judgeReplies[${repliesBeforeCinema-1}].state.queryPreferences.Eat.priceMax`),1);
 assert.equal(await evaluate(`Boolean(window.__judgeReplies[${repliesBeforeCinema-1}].state.pending)`),false);
 for(const section of ['Music','Movies'])assert.equal(await evaluate(`JSON.stringify(window.__judgeInitial.cards.filter(card=>card.section===${JSON.stringify(section)}))===JSON.stringify(window.__judgeReplies[${repliesBeforeCinema-1}].state.cards.filter(card=>card.section===${JSON.stringify(section)}))`),true);
}
await evaluate("document.querySelector('[aria-label=\"Close Taste Concierge\"]').click()");
if(conversation) assert.equal(await evaluate(`document.querySelector('[aria-label="Maximum price"]').value`),'1','Budget control must refresh after a contextual cheaper follow-up');
await clickText('Plan a day');
let dinner=await evaluate("document.querySelector('#day-out-Eat').value");
if (!dinner) {
 await evaluate("(()=>{const select=document.querySelector('#day-out-Eat');select.value=[...select.options].find(option=>option.value)?.value ?? '';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
 dinner=await evaluate("document.querySelector('#day-out-Eat').value");
}
assert.ok(dinner,'A dinner venue must be selected for the complete two-stop scenario');
await evaluate("[...document.querySelectorAll('.outing-activities label')].find(label=>label.textContent.trim()==='Cinema').querySelector('input').click()");
await waitFor(`window.__judgeReplies.length===${repliesBeforeCinema+1} && Boolean(document.querySelector('#day-out-Cinema:not(:disabled)'))`);
assert.equal(await evaluate("document.querySelector('#day-out-Eat').value"),dinner,'Finding cinemas must keep the chosen dinner');
assert.equal(await evaluate("document.querySelectorAll('.day-out-stops select:not(:disabled)').length"),2);
assert.ok(await evaluate("document.querySelector('#day-out-Cinema').value"));
const chosenVenues = await evaluate("[...document.querySelectorAll('.day-out-stops select')].map(select=>[select.id,select.value]).sort()");
await evaluate("document.querySelector('[aria-label=\"Move Cinema earlier\"]').click()");
assert.deepEqual(await evaluate("[...document.querySelectorAll('.day-out-stops select')].map(select=>[select.id,select.value]).sort()"),chosenVenues,'Reordering physical venues must preserve both selected defaults');
assert.equal(await evaluate("document.querySelector('.day-out-plan').textContent.includes('Download partial plan')"),false,'A complete two-stop plan is not partial');

await evaluate("document.querySelector('.day-out-plan').scrollIntoView({block:'start',behavior:'instant'})");
await shot('/tmp/tastepassport-judge-plan.png');
await call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
await shot('/tmp/tastepassport-judge-plan-mobile.png');
if(conversation) {
 await clickText('Preferences');
 const previous=await evaluate('window.__judgeReplies.length');
 await input('[aria-label="Maximum price"]','4','HTMLSelectElement');
 await waitFor(`window.__judgeReplies.length===${previous+1} && !document.querySelector('[aria-label="Maximum price"]').disabled`);
 assert.deepEqual(await evaluate(`window.__judgeReplies[${previous}].changed`),['Eat']);
 assert.equal(await evaluate(`window.__judgeReplies[${previous}].state.queryPreferences.Eat.priceMax`),4);
 assert.equal(await evaluate(`window.__judgeReplies[${previous}].state.cards.filter(card=>card.section==='Eat').every(card=>!card.evidence.params['filter.price_level.max'])`),true,'Any budget must remove the actual query cap');
 assert.equal(await evaluate(`document.querySelector('[aria-label="Maximum price"]').value`),'4');
}
console.log(`Judge browser/live-backend PASS: ${conversation ? 'consecutive refinement, read-only explanations/filters, relative-budget follow-up and real Any-budget cap clearing; ' : ''}exact constrained native chat updated Eat only; Music/Movies preserved; planner fetched actual cinema choices and kept dinner; desktop/mobile containment.`);
} finally {ws.close();}
