/** Browser contracts with explicitly mocked account/intelligence APIs. Not live provider acceptance. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { runTurn } from "../src/agent/orchestrator.ts";
import { normalizeSession } from "../src/agent/session.ts";
import { nextWeekend } from "../src/account/plans.ts";
const base = process.env.PASSPORT_TEST_URL || "http://127.0.0.1:3001";
const tabs = await (await fetch((process.env.PASSPORT_CDP_URL || "http://127.0.0.1:9231")+"/json")).json();
const ws = new WebSocket(
  tabs.find((t) => t.type === "page").webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.delete(id)) reject(Error("Browser command timed out"));
    }, 15000).unref();
  });
}
async function evaluate(expression) {
  const response = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails)
    throw Error("Browser evaluation failed");
  return response.result.result.value;
}
async function wait(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(`Account UI state timed out: ${expression}`);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function textClick(text) {
  await evaluate(`(()=>{const nav=document.querySelector('.passport-navigation');if(nav && !nav.getClientRects().length && [...nav.querySelectorAll('button')].some(button=>button.textContent.includes(${JSON.stringify(text)})))document.querySelector('.passport-menu-toggle').click();})()`);

  await wait(
    `[...document.querySelectorAll('button')].some(b=>!b.disabled && b.textContent.includes(${JSON.stringify(text)}))`,
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>!b.disabled && b.textContent.includes(${JSON.stringify(text)})).click()`,
  );
}
async function input(selector, value, elementType = "HTMLInputElement") {
  await evaluate(
    `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(window[${JSON.stringify(elementType)}].prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
}
const uuid = "11111111-1111-4111-8111-111111111111";
const cards = ["Coffee", "Culture", "Eat"].map((section, index) => ({
  id: `fixture-${index}`,
  name: `Protocol ${section} stop`,
  section,
  types: ["urn:entity:place"],
  detail: "UI protocol fixture",
  address: "Fixture address",
  intelligence: {id:`fixture-${index}`,name:`Protocol ${section} stop`,type:"urn:entity:place",taste:{contributingSignals:[]},quality:{businessRating:4.7},commercial:{priceLevel:2},externalProof:{},location:{latitude:43.65+index*.001,longitude:-79.38}},
  evidence: {
    source: "Qloo",
    operation: "/v2/insights/",
    queryId: "fixture-query",
    recordedAt: new Date().toISOString(),
    destination: "Toronto",
    locality: "physical-city",
    mode: "familiar",
    pool: "direct",
    inputs: [],
    params: {},
    result: {
      id: `fixture-${index}`,
      type: "urn:entity:place",
      tags: [
        {
          id: "urn:tag:genre:place:fixture",
          type: "urn:tag:genre:place",
          name:
            section === "Coffee"
              ? "Coffee shop"
              : section === "Culture"
                ? "Museum"
                : "Restaurant",
        },
      ],
    },
  },
}));
const session = normalizeSession({
  id: uuid,
  revision: 0,
  expires: Date.now() + 1800000,
  city: "Toronto",
  selected: [1, 2, 3].map((n) => ({
    id: `taste-${n}`,
    name: `Protocol taste ${n}`,
    types: ["urn:entity:artist"],
    detail: "Fixture",
  })),
  tags: [],
  constraints: [],
  categoryConstraints: {},
  cards,
  previous: [],
  feedback: [],
  notices: [],
});
const passport = {
  city: "Toronto",
  selected: session.selected,
  cards,
  notices: [],
  explanation: "UI protocol fixture",
  session,
  agent: { sessionId: uuid, revision: 0, tags: [], constraints: [] },
};
let signedIn = false;
let reconnectExpired = false;
let reusableProfile = null;
let reusableName = "My tastes";
const profileRecord=()=>({id:uuid,name:reusableName,updated_at:"2026-10-18T00:00:00Z",profile:reusableProfile});
let libraryReads = 0,
  budgetUpdates = 0;
const passportSaves=[];
let themeUpdates = 0;
let plans = [];
let failure;
let turnScenario = "budget";
ws.addEventListener("message", async (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  if (message.method !== "Fetch.requestPaused") return;
  const { requestId, request } = message.params;
  try {
    const path = new URL(request.url).pathname;
    const body = request.postData ? JSON.parse(request.postData) : {};
    let value;
    let responseStatus=200;
    if (path === "/api/destinations") {
      value = { destinations: ["London", "New York City", "Toronto", "Lisbon"] };
    } else if (path === "/api/agent/session" && request.method === "POST") {
      responseStatus = reconnectExpired ? 410 : 200;
      value = reconnectExpired ? {error:"Refresh with your tastes to continue."} : {passport:{...passport,session,agent:{...passport.agent,revision:session.revision}}};
    } else if (path === "/api/agent/turn") {
      if (body.input.message) {
        if (turnScenario === "existing-choice") {
          session.cards=session.cards.map(card=>card.section==="Culture" ? {...card,evidence:{...card.evidence,result:{...card.evidence.result,tags:[{id:"urn:tag:genre:place:night_club",name:"Night club",type:"urn:tag:genre:place"}]}}} : card);
          session.history=[{role:"agent",text:"Previously shown choices",recommendationIds:session.cards.slice(0,3).map(card=>card.id)}];
          session.pending={query:"night club",sections:["Culture"],constraints:[],candidates:[{id:"urn:tag:genre:place:night_club",name:"Night club",types:["urn:tag"],detail:"Fixture"}]};
          const forbidden=async()=>{throw Error("No new tools are authorized when choosing an existing option");};
          const reply=await runTurn(session,body.input,{tools:forbidden,workflow:forbidden,discover:forbidden,provider:{interpret:forbidden,choose:forbidden}});
          assert.deepEqual(reply.changed,[]);
          assert.equal(reply.state.pending,undefined);
          assert.match(reply.message,/My pick/);
          reply.state.revision=body.revision+1;
          Object.assign(session,reply.state);
          await call("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"application/x-ndjson"}],body:Buffer.from(JSON.stringify({type:"result",reply})+"\n").toString("base64")});
          return;
        }
        if (turnScenario === "stall") return; // Cancelled by browser AbortSignal, never reaches the backend.
        const payload =
          turnScenario === "malformed"
            ? "invalid-json\n"
            : ["provider-error", "session-changed", "storage-unavailable", "session-missing"].includes(turnScenario)
              ? JSON.stringify({
                  type: "error",
                  code: {"session-changed":"SESSION_CHANGED", "storage-unavailable":"STORAGE_UNAVAILABLE", "session-missing":"SESSION_MISSING"}[turnScenario],
                  message: "Fixture service diagnostic must not reach the customer.",
                })
              : JSON.stringify({
                  type: "result",
                  reply: {
                    state: {
                      ...session,
                      revision: ++session.revision,
                      ...(turnScenario === "empty-food" ? {cards:session.cards.filter(card=>card.section!=="Eat"),activeCategories:["Eat","Coffee","Culture"],recovery:["Eat"]} : {}),
                      pending: turnScenario==="pending-choice" ? {query:"chicken",sections:["Eat"],constraints:[],request:"find chicken",candidates:[{id:"urn:tag:specialty_dish:fixture:chicken",name:"Chicken dishes",types:["urn:tag"],detail:"Returned fixture concept"}]} : undefined,
                      history: [
                        { role: "user", text: body.input.message },
                        {
                          role: "agent",
                          text: "Your existing matches remain available.",
                          recommendationIds: session.cards.slice(0,3).map(card=>card.id),
                        },
                      ],
                    },
                    changed: [],
                    events: [],
                    message: "Your matches remain available.",
                    mode: "deterministic",
                  },
                });
        await call("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/x-ndjson" },
          ],
          body: Buffer.from(payload).toString("base64"),
        });
        return;
      }
      if (body.input.discovery.preferences.includeTags) {
        assert.equal(body.input.discovery.section, "Music");
        assert.deepEqual(body.input.discovery.preferences.includeTags,["urn:tag:genre:music:fixture"]);
        assert.equal(session.queryPreferences.Eat.priceMax,2,"Theme request keeps dining budget");
        themeUpdates++;
      } else {
        assert.equal(body.input.discovery.section, "Eat");
        assert.equal(body.input.discovery.preferences.priceMax, 2);
        budgetUpdates++;
        session.queryPreferences.Eat = { priceMax: 2 };
      }
      session.revision++;
      value = {
        type: "result",
        reply: {
          state: session,
          changed: [body.input.discovery.section],
          events: [],
          message: "Budget updated.",
          mode: "deterministic",
        },
      };
    } else if (path === "/api/account") {
      if (request.method === "GET")
        value = {
          configured: true,
          storage: true,
          user: signedIn ? { email: "protocol@example.test" } : null,
        };
      else if (body.action === "register") {
        assert.equal(body.firstName,"Protocol");
        assert.equal(body.lastName,"Tester");
        if(body.email==="existing@example.test") {
          responseStatus=409;value={error:"An account already exists for this email. Sign in or use Forgot password.",signInRequired:true};
        } else value = { signedIn: false, confirmationRequired: true };
      }
      else if (body.action === "logout") {
        signedIn = false;
        value = { signedOut: true };
      } else if (body.action === "change-password") {
        assert.equal(body.currentPassword,"Protocol-only-1234");
        assert.equal(body.password,"Updated-protocol-1234");
        value={signedIn:true};
      } else {
        signedIn = true;
        value = { signedIn: true, confirmationRequired: false };
      }
    } else if (path === "/api/account/preferences/export") {
      value={schema:"tastepassport.profile-export",version:1,profiles:reusableProfile?[{name:reusableName,preferences:reusableProfile}]:[]};
    } else if (path === "/api/account/preferences") {
      if (request.method === "GET") value={profiles:reusableProfile?[profileRecord()]:[],profile:reusableProfile};
      else if (body.action === "save") {
        assert.equal(body.sessionId,uuid);
        reusableProfile={version:1,selected:session.selected,tags:[],constraints:[],categoryConstraints:{},categoryTags:{},queryPreferences:{Eat:{priceMax:2}},discoveryMode:"familiar",categoryModes:{},hiddenCategories:[],activeCategories:["Eat","Coffee","Music","Culture"]};
        reusableName=body.name;
        value={saved:true,profile:reusableProfile,entry:profileRecord()};
      } else if (body.action === "apply") {
        assert.equal(body.city,"London");
        assert.ok(reusableProfile);
        const fresh=structuredClone(passport);
        fresh.city="London";fresh.session.city="London";
        fresh.cards.forEach(card=>card.evidence.destination="London");
        fresh.session.cards=fresh.cards;
        value={passport:fresh};
      } else { reusableProfile=null;value={deleted:true}; }
    } else if (path === "/api/account/passports") {
      if (request.method === "GET") libraryReads++;
      if (request.method === "POST" && body.action === "save") {
        assert.equal(body.sessionId,uuid);
        passportSaves.push(body.revision);
      }
      value =
        request.method === "GET"
          ? {
              passports: [
                {
                  id: uuid,
                  city: "Toronto",
                  updated_at: new Date().toISOString(),
                },
              ],
            }
          : { passport };
    } else if (path === "/api/account/plans") {
      if (request.method === "POST") {
        assert.equal(body.sessionId, uuid);
        assert.equal(body.revision, session.revision);
        assert.deepEqual(
          body.ids,
          cards.map((c) => c.id),
        );
        assert.equal(body.stops, undefined);
        plans = [
          {
            id: uuid,
            city: "Toronto",
            scheduled_date: body.date,
            time_zone: "America/Toronto",
            stop_times: body.stopTimes,
            stops: cards,
            created_at: new Date().toISOString(),
          },
        ];
        value = { saved: true, plan: plans[0] };
      } else if (request.method === "DELETE") {
        plans = [];
        value = { deleted: true };
      } else value = { plans };
    } else if (path === "/api/agent/resolve") {
      value = {
        token: "protocol-only-token",
        items: body.seeds.map((query, i) => ({
          query,
          candidates: [
            {
              id: `partner-${i}`,
              name: `Protocol partner ${i}`,
              types: ["urn:entity:artist"],
              detail: "UI protocol fixture",
            },
          ],
        })),
      };
    } else if (path === "/api/agent/intelligence") {
      if (body.action === "analysis") {
        value={analysis:body.kind === "taste" ? {kind:"taste",tags:[{id:"urn:tag:genre:music:fixture",name:"Fixture cultural theme"}],recordedAt:new Date().toISOString()}
          : body.kind === "heatmap" ? {kind:"heatmap",points:[{latitude:43.65,longitude:-79.38,affinity:.9},{latitude:43.69,longitude:-79.42,affinity:.5},{latitude:43.61,longitude:-79.35,affinity:.7}],recordedAt:new Date().toISOString()}
          : {kind:"demographics",records:[{id:session.selected[0].id,age:{'25_to_29':.2},gender:{female:-.1}}],recordedAt:new Date().toISOString()}};
      } else {
      assert.equal(body.action, "together");
      assert.deepEqual(body.ids, ["partner-0", "partner-1", "partner-2"]);
      assert.equal(body.token, "protocol-only-token");
      value = {
        comparison: {
          shared: [
            { id: "urn:tag:genre:protocol", name: "Protocol common ground" },
          ],
          aOnly: [],
          bOnly: [],
          recordedAt: new Date().toISOString(),
        },
        cards,
        notice: "Protocol shared taste suggestions",
      };
      }
    } else value = { deleted: true };
    await call("Fetch.fulfillRequest", {
      requestId,
      responseCode: responseStatus,
      responseHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "Cache-Control", value: "no-store" },
      ],
      body: Buffer.from(JSON.stringify(value)).toString("base64"),
    });
  } catch (error) {
    failure = error;
    await call("Fetch.failRequest", { requestId, errorReason: "Failed" });
  }
});
await call("Fetch.enable", {
  patterns: [
    { urlPattern: "*://*/api/account*" },
    { urlPattern: "*://*/api/destinations" },
    { urlPattern: "*://*/api/agent/session" },
    { urlPattern: "*://*/api/agent/resolve" },
    { urlPattern: "*://*/api/agent/intelligence" },
    { urlPattern: "*://*/api/agent/turn" },
  ],
});
await call("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await call("Page.navigate", { url: base + "/?ui-contract=1" });
await wait(
  "location.search.includes('ui-contract=1') && document.readyState==='complete' && Boolean(document.querySelector('.account-launch'))",
);
await new Promise((r) => setTimeout(r, 600));
await wait("Array.from(document.querySelectorAll('#destination option')).some(option=>option.value==='Lisbon')");
assert.equal(await evaluate("Array.from(document.querySelectorAll('#destination option')).some(option=>option.value==='Tokyo')"), false, "Dropdown uses returned catalogue, not hardcoded cities");
await wait("document.querySelector('.journey-illustration')?.complete && document.querySelector('.journey-illustration').naturalWidth>0");
await evaluate("window.scrollTo({top:0,behavior:'instant'})");
const artworkShot=await call("Page.captureScreenshot",{format:"png"});
await fs.writeFile("/tmp/tastepassport-original-illustrations.png",Buffer.from(artworkShot.result.data,"base64"));
// Recover a guest view through trusted server state, with actionable expiry.
await evaluate(`sessionStorage.setItem('tastepassport.guest.recovery.v1', ${JSON.stringify(JSON.stringify({version:1,savedAt:Date.now(),expiresAt:Date.now()+7200000,passport}))})`);
await call("Page.reload");
await wait("Boolean(document.querySelector('.passport-cover')) && !document.querySelector('.passport-recovery')");
assert.equal(await evaluate("document.body.textContent.includes('active server session')"),false);
for (const [label,selector,file] of [["Discover",".discovery-concierge","discover"],["My Vibe",".vibe-intro","my-vibe"],["Taste insights",".analysis-intro","insights"],["Plan a day",".outing-intro","plan"]]) {
  await textClick(label);
  await wait(`Boolean(document.querySelector('${selector}'))`);
  for(const width of [320,390,1440]) {
    await call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<768});
    assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false,`${label} overflow at ${width}`);
  }
  await evaluate(`document.querySelector('${selector}').scrollIntoView({block:'start',behavior:'instant'})`);
  const shot=await call("Page.captureScreenshot",{format:"png"});
  await fs.writeFile(`/tmp/tastepassport-rich-${file}.png`,Buffer.from(shot.result.data,"base64"));
}
reconnectExpired=true;
await call("Page.reload");
await wait("document.querySelector('.passport-recovery')?.textContent.includes('Refresh with my tastes')");
assert.ok(await evaluate("Boolean(document.querySelector('.discovery-card'))"),"Expired editing window preserves browsable discoveries");
await evaluate("sessionStorage.removeItem('tastepassport.guest.recovery.v1')");
reconnectExpired=false;
await call("Page.reload");
await wait("Boolean(document.querySelector('.account-launch')) && !document.querySelector('.passport-cover')");
// Motion is optional and never required to reveal or operate the page.
await call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
assert.equal(await evaluate("getComputedStyle(document.querySelector('.move-form')).animationName"),"passport-arrive");
await call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
assert.equal(await evaluate("getComputedStyle(document.querySelector('.move-form')).animationName"),"none");
assert.equal(await evaluate("getComputedStyle(document.querySelector('.move-form')).opacity"),"1","Reduced motion must keep the form visible");
await call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
await click(".account-launch");
await wait(
  "Boolean(document.querySelector('.account-dialog[open] input[type=email]'))",
);
assert.equal(
  await evaluate(
    "document.documentElement.style.overflow==='hidden' && document.body.style.overflow==='hidden'",
  ),
  true,
  "Account modal locks background scroll",
);
assert.equal(await evaluate("document.querySelector('.account-tabs button[aria-pressed=true]').textContent.trim()"), "Sign in");
await textClick("Register");
assert.equal(await evaluate("document.querySelector('.account-tabs').compareDocumentPosition(document.querySelector('[autocomplete=given-name]')) & Node.DOCUMENT_POSITION_FOLLOWING"), 4, "Mode switch precedes all registration fields");
assert.equal(await evaluate("document.querySelectorAll('.account-dialog form .primary-button').length"), 1, "Registration has one submit action");
await click('[aria-label="Close account"]');
await click('.account-launch');
assert.equal(await evaluate("document.querySelector('.account-tabs button[aria-pressed=true]').textContent.trim()"), "Sign in", "Reopening Sign in resets registration mode");
await textClick("Register");
await input('.account-dialog input[autocomplete="given-name"]', "Protocol");
await input('.account-dialog input[autocomplete="family-name"]', "Tester");
await input(".account-dialog input[type=email]", "protocol@example.test");
await input(".account-dialog input[type=password]", "Protocol-only-1234");
await input(".account-dialog input[type=email]", "existing@example.test");
await evaluate("document.querySelector('.account-dialog form').requestSubmit()");
await wait("document.querySelector('.account-message')?.textContent.includes('already exists')");
assert.equal(await evaluate("document.querySelector('.account-tabs button[aria-pressed=true]').textContent.trim()"),"Sign in");
assert.equal(await evaluate("Boolean(document.querySelector('.verification-screen'))"),false);
await textClick("Register");
await input(".account-dialog input[type=email]", "protocol@example.test");
await input(".account-dialog input[type=password]", "Protocol-only-1234");
await evaluate(
  "document.querySelector('.account-dialog form').requestSubmit()",
);
await wait("Boolean(document.querySelector('.verification-screen'))");
assert.equal(
  await evaluate(
    "document.querySelector('.account-dialog input[type=password]')===null",
  ),
  true,
);
assert.ok(
  await evaluate(
    "document.querySelector('#account-title').textContent.includes('Verify your email')",
  ),
);
let screenshot = await call("Page.captureScreenshot", { format: "png" });
await fs.writeFile(
  "/tmp/tastepassport-verify-email.png",
  Buffer.from(screenshot.result.data, "base64"),
);
await textClick("I’ve verified");
await wait(
  "Boolean(document.querySelector('.account-dialog input[type=password]'))",
);
await input(".account-dialog input[type=password]", "Protocol-only-1234");
await evaluate(
  "window.__libraryFlashes=0;window.__profileFlashes=0;window.__libraryObserver=new MutationObserver(()=>{if(document.querySelector('.account-library-dialog[open]'))window.__libraryFlashes++;if(document.querySelector('.reusable-tastes'))window.__profileFlashes++});window.__libraryObserver.observe(document.body,{subtree:true,childList:true,attributes:true})",
);
await evaluate(
  "document.querySelector('.account-dialog form').requestSubmit()",
);
await wait(
  "Boolean(document.querySelector('.signout-button')) && !document.querySelector('.account-dialog[open]')",
);
assert.equal(libraryReads, 0, "Sign in does not wait for the saved library");
assert.equal(
  await evaluate("window.__libraryFlashes"),
  0,
  "Sign in never flashes the library modal",
);
await new Promise(resolve=>setTimeout(resolve,300));
assert.equal(await evaluate("window.__profileFlashes"),0,"Empty saved-profile lookup never flashes an onboarding panel");
await evaluate("window.__libraryObserver.disconnect()");
assert.equal(
  await evaluate(
    "document.documentElement.style.overflow!=='hidden' && document.body.style.overflow!=='hidden'",
  ),
  true,
  "Closing account restores page scrolling",
);
assert.ok(
  await evaluate(
    "document.querySelector('[aria-label=\"My plans & Passports\"]')!==null && document.querySelector('.signout-button')!==null",
  ),
);
await click(".account-launch");
await wait("Boolean(document.querySelector('.saved-passport-list article'))");
await click('[aria-label="Close account"]');
await textClick("Account settings");
await input('.account-dialog input[autocomplete="current-password"]', "Protocol-only-1234");
await input('.account-dialog input[autocomplete="new-password"]', "Updated-protocol-1234");
await evaluate(`(()=>{const fields=document.querySelectorAll('.account-dialog input[autocomplete="new-password"]');const field=fields[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'Updated-protocol-1234');field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await evaluate("document.querySelector('.account-dialog form').requestSubmit()");
await wait("!document.querySelector('.account-dialog[open]')");
await click(".account-launch");
await wait("Boolean(document.querySelector('.saved-passport-list article'))");
await click('[aria-label="Delete saved Toronto Passport"]');
await wait("Boolean(document.querySelector('.confirm-delete-dialog[open]'))");
assert.ok(await evaluate("document.querySelector('.confirm-delete-dialog').textContent.includes('Delete your saved Toronto Passport?')"), "Passport deletion uses an in-app dialog");
await textClick("Keep it");
assert.equal(await evaluate("Boolean(document.querySelector('.confirm-delete-dialog'))"), false);
await textClick("Open");
await wait(
  "Boolean(document.querySelector('.passport-cover')) && !document.querySelector('.account-dialog[open]')",
);
session.savedCards=[...cards];
session.queryPreferences={Eat:{priceMax:2},Coffee:{priceMax:1}};
await call("Page.reload");
await wait("Boolean(document.querySelector('.passport-cover')) && Boolean(document.querySelector('.signout-button'))");
await textClick("My Vibe");
await wait("document.querySelector('.vibe-summary')?.textContent.includes('3 saved discoveries')");
assert.ok(await evaluate("document.querySelector('.my-vibe').textContent.includes('Protocol Eat stop')"), "Signed-in refresh restores the current My Vibe from server state");
await textClick("Preferences");
await wait("Boolean(document.querySelector('.intelligence-preferences'))");
await input('.intelligence-section select',"Eat",'HTMLSelectElement');
await wait(`document.querySelector('[aria-label="Maximum price"]')?.value==='2'`);
await input('.intelligence-section select',"Coffee",'HTMLSelectElement');
await wait(`document.querySelector('[aria-label="Maximum price"]')?.value==='1'`);
await input('.intelligence-section select',"Eat",'HTMLSelectElement');
assert.equal(await evaluate(`document.querySelector('[aria-label="Maximum price"]').value`),"2","Preferences survive section switches and page refresh");
await textClick("Discover");
await wait(
  "document.querySelector('.plan-save-actions .primary-button').textContent.includes('Save to')",
);
await evaluate("document.querySelector('.passport-workspace').scrollIntoView({block:'start',behavior:'instant'})");
const discoveryShot=await call("Page.captureScreenshot",{format:"png"});
await fs.writeFile("/tmp/tastepassport-discover-layout.png",Buffer.from(discoveryShot.result.data,"base64"));
await click('.discovery-prompts button');
await wait("Boolean(document.querySelector('#taste-concierge[open]'))");
assert.equal(await evaluate("document.querySelector('#conversation-input').value"),"Find cheaper food. Keep my music and movies unchanged.","Conversation starter prepares a request without automatically changing results");
await click('[aria-label="Close Taste Concierge"]');
for (const width of [320, 390, 640, 768, 1024, 1440]) {
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  assert.equal(
    await evaluate("document.documentElement.scrollWidth>innerWidth"),
    false,
    `Signed-in layout overflow at ${width}`,
  );
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.passport-sidebar')).position"),"static","Passport navigation must not stick to the viewport");
  if(width<1100) {
    assert.equal(await evaluate("document.querySelector('.passport-menu-toggle').getAttribute('aria-expanded')"),"false");
    await click('.passport-menu-toggle');
    assert.equal(await evaluate("document.querySelector('.passport-navigation').getClientRects().length>0"),true);
    assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false,`Expanded menu overflow at ${width}`);
    if(width===390) {
      await evaluate("document.querySelector('.passport-sidebar').scrollIntoView({block:'start',behavior:'instant'})");
      const menuShot=await call("Page.captureScreenshot",{format:"png"});
      await fs.writeFile("/tmp/tastepassport-mobile-navigation.png",Buffer.from(menuShot.result.data,"base64"));
      await evaluate("document.querySelector('.passport-navigation button').focus()");
      await call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape"});
      await wait("document.querySelector('.passport-menu-toggle').getAttribute('aria-expanded')==='false'");
      assert.equal(await evaluate("document.activeElement===document.querySelector('.passport-menu-toggle')"),true,"Escape restores menu-toggle focus");
      await click('.passport-menu-toggle');

    }
    await click('.passport-navigation button');
    await wait("document.querySelector('.passport-menu-toggle').getAttribute('aria-expanded')==='false'");
    assert.equal(await evaluate("document.querySelector('.passport-navigation button[aria-current=page]').textContent.trim()"),"Discover");
  } else {
    assert.equal(await evaluate("document.querySelector('.passport-navigation').getClientRects().length>0"),true,"Desktop sections stay visible");
  }

  assert.ok(
    await evaluate(
      "(()=>{const h=document.querySelector('.workspace-topbar').getBoundingClientRect(), n=document.querySelector('.header-controls').getBoundingClientRect(), b=document.querySelector('.brand').getBoundingClientRect();return n.right<=h.right+1 && (b.right<=n.left+1 || b.bottom<=n.top+1)})()",
    ),
    `Signed-in nav overlap at ${width}`,
  );
}
await textClick("Plan a day");
await input("#plan-date", "2000-01-01");
assert.equal(await evaluate("document.querySelector('.download-plan').disabled"),true,"Past dates cannot be downloaded");
assert.equal(await evaluate("document.querySelector('.plan-save-actions .primary-button').disabled"),true,"Past dates cannot be saved");
assert.ok(await evaluate("[...document.querySelectorAll('.day-out-plan [role=alert]')].some(element=>element.textContent.includes('future date'))"),"Invalid plan date has actionable feedback");
await input("#plan-date", "2099-01-01");
await textClick("Next weekend");
assert.equal(
  await evaluate("document.querySelector('#plan-date').value"),
  nextWeekend("Toronto"),
);
assert.ok(
  await evaluate(
    "[...document.querySelectorAll('.day-out-plan [role=status]')].some(e => e.textContent.includes('Your plan is set'))",
  ),
);
await textClick("Preferences");
await evaluate("document.querySelector('.intelligence-preferences').scrollIntoView({block:'start',behavior:'instant'})");
const preferencesShot=await call("Page.captureScreenshot",{format:"png"});
await fs.writeFile("/tmp/tastepassport-preferences.png",Buffer.from(preferencesShot.result.data,"base64"));
await input('[aria-label=\"Maximum price\"]', "2", "HTMLSelectElement");
assert.equal(budgetUpdates,0,"Draft budget waits for the explicit Update action");
await textClick("Update suggestions");
await wait(
  "document.querySelector('.intelligence-content').textContent.includes('Moderate or less')",
);
for (let attempt=0; budgetUpdates===0 && attempt<100; attempt++) await new Promise(resolve=>setTimeout(resolve,50));
assert.equal(budgetUpdates, 1, "Explicit Update applies the chosen budget");
for (let attempt=0; !passportSaves.includes(session.revision) && attempt<100; attempt++) await new Promise(resolve=>setTimeout(resolve,50));
assert.ok(passportSaves.includes(session.revision),"Changing an already-saved Passport updates its server snapshot");
await textClick("Together");
assert.equal(await evaluate("document.querySelector('.intelligence-preferences').hidden"),true,"Together must not expose personal preference controls");
assert.equal(await evaluate("document.querySelectorAll('.partner-interests input').length"),1,"One partner interest is enough to begin");
for (let i = 0; i < 3; i++) {
  if (i > 0) await textClick("Add another interest");
  await input(
    `.partner-interests label:nth-child(${i + 1}) input`,
    `Protocol interest ${i}`,
  );
}
await textClick("Find their interests");
await wait("document.querySelectorAll('.partner-choice-list').length===3");
await evaluate(
  "document.querySelectorAll('.partner-choice-list button:first-child').forEach(button=>button.click())",
);
assert.equal(
  await evaluate(
    "document.querySelectorAll('.partner-selection').length",
  ),
  3,
  "Confirmed partner interests become compact selections",
);
await evaluate("document.querySelector('.partner-matches').scrollIntoView({block:'center',behavior:'instant'})");
let togetherShot=await call("Page.captureScreenshot",{format:"png"});
await fs.writeFile("/tmp/tastepassport-together-matches.png",Buffer.from(togetherShot.result.data,"base64"));
await textClick("Find something for both of us");
await wait("Boolean(document.querySelector('.common-tags'))");
assert.ok(
  await evaluate(
    "document.querySelector('.common-tags').textContent.includes('Protocol common ground')",
  ),
);
await evaluate("document.querySelector('.together-results').scrollIntoView({block:'start',behavior:'instant'})");
togetherShot=await call("Page.captureScreenshot",{format:"png"});
await fs.writeFile("/tmp/tastepassport-together-results.png",Buffer.from(togetherShot.result.data,"base64"));
await textClick("Taste insights");
assert.equal(await evaluate("Boolean(document.querySelector('.trend-analysis'))"),false,"Retired historical-data controls must stay absent");
await textClick("Find a new theme from my tastes");
await wait("Boolean(document.querySelector('.taste-theme-list'))");
assert.ok(await evaluate("document.querySelector('.taste-theme-list').textContent.includes('Fixture cultural theme')"));

assert.equal(await evaluate("document.querySelector('.theme-next-step button').disabled"),true);
await click('.taste-theme-list button');
await textClick("Find music with this theme");
for (let attempt=0; themeUpdates===0 && attempt<100; attempt++) await new Promise(resolve=>setTimeout(resolve,50));
assert.equal(themeUpdates,1,"Returned theme produces a structured scoped refinement");
await textClick("Taste insights");
await textClick("Start from a place in Toronto");
await wait("Boolean(document.querySelector('.area-guide .area-choices article'))");
assert.ok(await evaluate("document.querySelector('.area-guide').textContent.includes('Start at Protocol')"));
assert.equal(await evaluate("Boolean(document.querySelector('.taste-map-panel'))"),false,"Coordinate evidence is absent from customer insights");
assert.equal(await evaluate("Boolean(document.querySelector('.affinity-plot'))"),false);
assert.equal(await evaluate("document.querySelectorAll('.area-nearby li').length"),2,"Show actual nearby discoveries");
assert.equal(await evaluate("Boolean(document.querySelector('.audience-context'))"), false, "Demographic research is absent from the customer screen");
for(const width of [320,390,1440]) {
  await call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false,`Analysis UI overflow at ${width}`);
}
await textClick("Preferences");
await evaluate("document.querySelector('.advanced-taste-filters').open=true");
await input('.advanced-taste-filters input','Fixture unsaved area');
await input('.intelligence-section select','Coffee','HTMLSelectElement');
assert.equal(await evaluate("document.querySelector('.advanced-taste-filters input').value"),'','Unsaved dining geography must not leak into coffee');
await input('.intelligence-section select','Eat','HTMLSelectElement');
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
    `Intelligence UI overflow at ${width}`,
  );
}
await evaluate(
  "window.scrollTo({top:document.querySelector('.taste-intelligence').getBoundingClientRect().top+scrollY-200,behavior:'instant'})",
);
let intelligenceShot = await call("Page.captureScreenshot", { format: "png" });
await fs.writeFile(
  "/tmp/tastepassport-intelligence.png",
  Buffer.from(intelligenceShot.result.data, "base64"),
);
await wait(
  "document.querySelector('.plan-save-actions .primary-button').textContent.includes('Save to')",
);
await textClick("Plan a day");
const initialStops = await evaluate("[...document.querySelectorAll('.day-out-stops select')].map(s=>[s.id,s.value])");
await click('[aria-label="Move Culture earlier"]');
assert.deepEqual(await evaluate("[...document.querySelectorAll('.day-out-stops select')].map(s=>s.id)"), ["day-out-Culture","day-out-Coffee","day-out-Eat"]);
assert.deepEqual(await evaluate("[...document.querySelectorAll('.day-out-stops select')].map(s=>[s.id,s.value]).sort()"), [...initialStops].sort(), "Reordering preserves venue selections");
await click('[aria-label="Move Culture later"]');
await click('.outing-activities label:nth-of-type(4) input');
assert.ok(await evaluate("Boolean(document.querySelector('#day-out-Cinema'))"), "Cinema can be added as its own activity");
assert.deepEqual(await evaluate("[...document.querySelectorAll('.day-out-stops select')].filter(s=>s.id!=='day-out-Cinema').map(s=>[s.id,s.value])"), initialStops, "Adding an activity preserves other choices");
await click('.outing-activities label:nth-of-type(4) input');
await input("#plan-date", "2099-10-18");
await click(".plan-save-actions .primary-button");
await wait(
  "Boolean(document.querySelector('.toast-notice')) && document.querySelector('.day-out-plan').textContent.includes('Saved!')",
);
await click(".account-launch");
await click(".account-library-tabs button:last-child");
await wait("Boolean(document.querySelector('.saved-plan'))");
await textClick("Delete plan");
await wait("Boolean(document.querySelector('.confirm-delete-dialog[open]'))");
assert.ok(await evaluate("document.querySelector('.confirm-delete-dialog').textContent.includes('saved outing')"),"Plan deletion uses an in-app dialog");
await textClick("Keep it");
assert.ok(await evaluate("Boolean(document.querySelector('.saved-plan'))"),"Cancel keeps the saved plan");
assert.ok(
  await evaluate(
    "document.querySelector('.upcoming-plans').textContent.includes('Protocol Coffee stop')",
  ),
);
await evaluate(
  "window.__calendarBlob=null;window.__realObjectURL=URL.createObjectURL;URL.createObjectURL=b=>{window.__calendarBlob=b;return window.__realObjectURL(b)}",
);
await textClick("Add to calendar");
assert.match(
  await evaluate("window.__calendarBlob.text()"),
  /DTSTART;TZID=America\/Toronto:20991018T110000/,
);
await evaluate("URL.createObjectURL=window.__realObjectURL");
await textClick("Edit");
await wait("document.querySelector('#plan-date')?.value==='2099-10-18' && document.querySelector('.plan-save-actions .primary-button')?.textContent.includes('Update saved plan')");
await input('.day-out-stops input[type=time]',"12:00");
await click('.plan-save-actions .primary-button');
await click('.account-launch');
await click('.account-library-tabs button:last-child');
await wait("document.querySelector('.saved-plan')?.textContent.includes('12:00')");
assert.equal(await evaluate("document.querySelector('.saved-plan').textContent.includes('11:00')"),false,"Updating a plan replaces its old time in Upcoming plans");
for (const width of [320, 390, 768, 1440]) {
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  assert.ok(
    await evaluate(
      "(()=>{const r=document.querySelector('.account-dialog').getBoundingClientRect();return r.left>=15 && r.right<=innerWidth-15 && r.top>=15 && r.bottom<=innerHeight-15 && document.querySelector('.account-dialog').scrollWidth<=document.querySelector('.account-dialog').clientWidth})()",
    ),
    `Plan library containment at ${width}`,
  );
}
screenshot = await call("Page.captureScreenshot", { format: "png" });
await fs.writeFile(
  "/tmp/tastepassport-upcoming-plans.png",
  Buffer.from(screenshot.result.data, "base64"),
);
await click('[aria-label="Close account"]');
assert.ok(
  await evaluate(
    "(()=>{const b=document.querySelector('.assistant-launch'),r=b.getBoundingClientRect();return getComputedStyle(b).position==='fixed'&&r.height>=44&&r.right<=innerWidth&&r.bottom<=innerHeight})()",
  ),
  "Floating assistant stays inside viewport",
);
await click(".assistant-launch");
for (const scenario of ["provider-error", "session-changed", "storage-unavailable", "malformed", "stall", "deadline"]) {
  turnScenario = scenario === "deadline" ? "stall" : scenario;
  if (scenario === "deadline")
    await evaluate(
      "window.__realTimeout=AbortSignal.timeout;AbortSignal.timeout=ms=>window.__realTimeout(ms===100000?30:ms)",
    );
  await input(
    "#conversation-input",
    "Please refine Culture " + scenario,
    "HTMLTextAreaElement",
  );
  await click('[aria-label="Send message"]');
  await wait(
    `document.querySelector('.concierge-body').textContent.includes(${JSON.stringify("Please refine Culture ")}+${JSON.stringify(scenario)})`,
  );
  if (scenario === "stall") {
    await wait(
      "[...document.querySelectorAll('#taste-concierge button')].some(b=>b.textContent.includes('Cancel refinement'))",
    );
    await textClick("Cancel refinement");
  }
  await wait("!document.querySelector('#conversation-input').disabled");
  await wait("Boolean(document.querySelector('.conversation-recovery .primary-button')) && !document.querySelector('.conversation-recovery .primary-button').disabled");
  assert.ok(
    await evaluate(
      "[...document.querySelectorAll('#taste-concierge button')].some(b=>b.textContent.includes('Try my request again'))",
    ),
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.discovery-card').length"),
    3,
  );
  if (scenario === "deadline")
    await evaluate("AbortSignal.timeout=window.__realTimeout");
}
turnScenario = "success";
await textClick("Try my request again");
await wait(
  "!document.querySelector('#conversation-input').disabled && ![...document.querySelectorAll('#taste-concierge button')].some(b=>b.textContent.includes('Try my request again'))",
);
await wait("document.querySelectorAll('.chat-recommendations article').length===3");
const chatShot=await call("Page.captureScreenshot",{format:"png"});
await fs.writeFile("/tmp/tastepassport-chat-choices.png",Buffer.from(chatShot.result.data,"base64"));
for (const width of [320,390,1440]) {
  await call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false,`Chat choices overflow at ${width}`);
  assert.ok(await evaluate("[...document.querySelectorAll('.chat-choice-actions button,.chat-choice-actions a')].every(button=>button.getBoundingClientRect().height>=44)"),"Chat actions meet the 44px target size");
}
turnScenario="existing-choice";
await input("#conversation-input","From the above pick one best night club for mr","HTMLTextAreaElement");
await click('[aria-label="Send message"]');
await wait("[...document.querySelectorAll('.message.agent')].at(-1)?.textContent.includes('My pick')");
assert.equal(await evaluate("[...document.querySelectorAll('.message.agent')].at(-1).querySelectorAll('.chat-recommendations article').length"),1,"A one-choice request renders exactly one existing venue");
assert.equal(await evaluate("Boolean(document.querySelector('.pending-concept'))"),false,"Choosing an existing nightclub must not open taxonomy confirmation");
assert.equal(await evaluate("[...document.querySelectorAll('.message.agent')].at(-1).textContent.includes('Updated Culture')"),false);
turnScenario="success";
await click('[aria-label="Close Taste Concierge"]');
await textClick("Discover");
assert.ok(await evaluate("document.querySelector('#section-Eat').textContent.includes('Food')"),"Food heading uses the customer-facing label");
assert.ok(await evaluate("document.querySelector('#section-Coffee').textContent.includes('Coffee & cafés')"),"Café heading uses the customer-facing label");
turnScenario="pending-choice";
await click(".assistant-launch");
await input("#conversation-input","Find chicken","HTMLTextAreaElement");
await click('[aria-label="Send message"]');
await wait("Boolean(document.querySelector('.conversation .message.agent .pending-concept'))");
assert.equal(await evaluate("document.querySelectorAll('.pending-concept').length"),1,"Clarification appears once inside its assistant message");
assert.ok(await evaluate("document.querySelector('.concierge-body').scrollTop>0"),"Clarification stays at the conversation end rather than jumping to the top");
await click('[aria-label="Close Taste Concierge"]');
turnScenario="empty-food";
await click(".assistant-launch");
await input("#conversation-input","Fixture missing food","HTMLTextAreaElement");
await click('[aria-label="Send message"]');
await wait("Boolean(document.querySelector('.missing-discoveries'))");
assert.equal(await evaluate("document.querySelectorAll('.missing-discoveries').length"),1,"Empty category recovery is not duplicated in chat");
assert.ok(await evaluate("document.querySelector('.missing-discoveries').textContent.includes('Try Food again')"));
assert.ok(await evaluate("Boolean(document.querySelector('.message.agent .refinement-recovery'))"),"Recovery actions appear beneath the latest assistant reply");
assert.equal(await evaluate("document.querySelector('#passport-content').textContent.includes('Retry Eat')"),false);
await click('[aria-label="Close Taste Concierge"]');
turnScenario="success";
await textClick("Preferences");
assert.equal(await evaluate("Boolean(document.querySelector('.reusable-tastes'))"),false,'Saving tastes is offered only when starting another Passport');
await click('[aria-label="Start a new Passport"]');
await wait("Boolean(document.querySelector('.taste-profile-dialog[open]'))");
assert.equal(await evaluate("document.querySelector('#taste-profile-name').value"),'','Profile name must be deliberately entered');
assert.equal(await evaluate("document.querySelector('.taste-profile-dialog button[type=submit]').disabled"),true);
await click('[aria-label="Keep exploring this Passport"]');
await wait("!document.querySelector('.taste-profile-dialog')");
assert.ok(await evaluate("Boolean(document.querySelector('.passport-cover'))"),'Cancelling preserves the current Passport');
await click('[aria-label="Start a new Passport"]');
await wait("Boolean(document.querySelector('.taste-profile-dialog[open]'))");
await input('#taste-profile-name',"Weekend culture");
await textClick("Save profile & continue");
await wait("document.querySelector('#destination')?.disabled===false && Array.from(document.querySelector('#destination').options).some(option=>option.value==='London')");
await input("#destination","London","HTMLSelectElement");
assert.equal(await evaluate("document.querySelector('.profile-fields select').value"),'','New Passport clears the active profile selection');
await input('.profile-fields select',uuid,'HTMLSelectElement');
await textClick("Delete profile");
await wait("Boolean(document.querySelector('.confirm-delete-dialog[open]'))");
assert.ok(await evaluate("document.querySelector('.confirm-delete-dialog').textContent.includes('Weekend culture')"),"Taste profile deletion uses an in-app dialog");
await textClick("Keep it");
await wait("document.querySelectorAll('.taste-chip').length===3");
assert.ok(await evaluate("document.querySelector('.profile-status').textContent.includes('Loaded')"),"Selecting a named profile populates tastes");
assert.equal(await evaluate("document.querySelector('.reusable-tastes a[download]') === null"),true,"Taste profile export is hidden");
await input('#taste-input','Miles Davis');
await click('[aria-label="Add taste"]');
assert.equal(await evaluate("document.querySelectorAll('.taste-chip').length"),4,"A saved profile remains editable in onboarding");
assert.equal(await evaluate("document.querySelector('.reusable-tastes .primary-button').disabled"),true,"Direct reuse cannot discard an added taste");
await click('[aria-label="Remove Miles Davis"]');
assert.equal(await evaluate("document.querySelector('.reusable-tastes .primary-button').disabled"),false);
await textClick("Discover in London with saved preferences");
await wait("Boolean(document.querySelector('.passport-cover')) && document.querySelector('.passport-cover').textContent.includes('London')");
assert.ok(await evaluate("document.querySelector('#passport-content').textContent.includes('Fresh discoveries using your saved tastes')"),"Saved tastes apply to a different city without retyping preferences");
turnScenario="session-missing";
await click(".assistant-launch");
await input("#conversation-input","Please refine Food after restart","HTMLTextAreaElement");
await click('[aria-label="Send message"]');
await wait("document.querySelector('.conversation-recovery')?.textContent.includes('Refresh with my tastes')");
assert.equal(await evaluate("document.querySelector('.conversation-recovery').textContent.includes('Try my request again')"),false,"A lost session must offer refresh rather than a futile retry");
assert.equal(await evaluate("document.querySelector('.conversation-recovery').textContent.includes('Fixture service diagnostic')"),false);
assert.equal(await evaluate("document.querySelectorAll('.discovery-card').length"),3,"Lost-session recovery preserves discoveries");
await textClick("Keep exploring");
turnScenario="success";
await click(".signout-button");
await wait(
  "!document.querySelector('.signout-button') && !document.querySelector('.upcoming-launch') && !document.querySelector('.passport-cover')",
);
await call("Page.navigate", { url: base + "/about" });
await wait(
  "document.title.includes('About us') && Boolean(document.querySelector('.about-hero'))",
);
for (const width of [1440, 390, 320]) {
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
  await evaluate("document.fonts.ready");
  assert.ok(await evaluate("document.fonts.check('16px Manrope')"));
}
await call("Fetch.disable");
ws.close();
if (failure) throw failure;
console.log(
  "UI contract PASS (mocked APIs): signed-in refresh restores My Vibe and category preferences; saved edits update the snapshot; deletion uses in-app confirmation; empty profile loading does not flash; existing account, agent, planner, Together, responsive and recovery contracts pass. Live providers remain separate acceptance.",
);
