import assert from "node:assert/strict";
import test from "node:test";
import * as helpers from "../tests/e2e/helpers.ts";

test("auth response observation starts before one click and never re-clicks after a timeout", async () => {
  assert.equal(typeof helpers.clickAndWaitForResponse, "function");
  const events = [];
  const timeout = new Error("response timeout");
  const locator = {
    page: () => ({ waitForResponse: () => { events.push("observe"); return Promise.reject(timeout); } }),
    click: async () => { events.push("click"); },
  };
  await assert.rejects(helpers.clickAndWaitForResponse(locator, () => true), error => error === timeout);
  assert.deepEqual(events, ["observe", "click"]);
});

test("auth response observation returns the first response without retrying a failed click", async () => {
  assert.equal(typeof helpers.clickAndWaitForResponse, "function");
  const response = {};
  let clicks = 0;
  const locator = {
    page: () => ({ waitForResponse: async () => response }),
    click: async () => { clicks += 1; },
  };
  assert.equal(await helpers.clickAndWaitForResponse(locator, () => true), response);
  const failure = new Error("click failed");
  locator.click = async () => { clicks += 1; throw failure; };
  await assert.rejects(helpers.clickAndWaitForResponse(locator, () => true), error => error === failure);
  assert.equal(clicks, 2);
});

test("API fixture transport failures report only sanitized context and never retry", async () => {
  const original = console.error;
  const diagnostics = [];
  let requests = 0;
  let requestOptions;
  const page = { request: { post: async (pathname, options) => {
    requests += 1;
    assert.equal(pathname, "/api/auth/register");
    requestOptions = options;
    throw new Error("apiRequestContext.post: read ECONNRESET https://private.test?token=secret email=password123 Authorization: Bearer private-cookie");
  } } };
  console.error = (...args) => diagnostics.push(args.join(" "));
  try {
    await assert.rejects(helpers.registerViaApi(page, "private-label"), error => {
      assert.match(error.message, /POST \/api\/auth\/register.*ECONNRESET/);
      assert.doesNotMatch(error.message, /private|password123|secret|Authorization/);
      return true;
    });
  } finally { console.error = original; }
  assert.equal(requests, 1);
  assert.equal(requestOptions.maxRetries, 0);
  assert.equal(diagnostics.length, 1);
  const diagnostic = JSON.parse(diagnostics[0]);
  assert.equal(diagnostic.event, "fixture-transport-failure");
  assert.equal(diagnostic.method, "POST");
  assert.equal(diagnostic.pathname, "/api/auth/register");
  assert.equal(diagnostic.code, "ECONNRESET");
  assert.ok(Number.isFinite(diagnostic.elapsedMs) && diagnostic.elapsedMs >= 0);
  assert.deepEqual(Object.keys(diagnostic).sort(), ["code", "elapsedMs", "event", "method", "pathname"]);
});
