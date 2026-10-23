import test from "node:test";
import assert from "node:assert/strict";
import { refinementErrorMessage } from "../src/agent/customer-error.ts";
test("network and timeout failures give customers a clear next action",()=>{
 assert.match(refinementErrorMessage(new TypeError("Network Error")),/couldn’t connect.*discoveries are still here.*Try again/);
 assert.match(refinementErrorMessage(new DOMException("timeout","TimeoutError")),/longer than expected/);
 assert.match(refinementErrorMessage(Error("aborted"),true),/Stopped this request/);
});
test("untrusted error payloads never become customer messages",()=>{
 const raw="database internal stack trace provider secret placeholder";
 assert.ok(!refinementErrorMessage(Error(raw)).includes(raw));
 assert.match(refinementErrorMessage(Error(raw)),/keep exploring/);
 assert.match(refinementErrorMessage(Error("Your refinement session expired")),/needs a refresh/);
});
