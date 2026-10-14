"use strict";
// `expect` scenarios and journey mode in TestRunner, against a real page.
const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const TestRunner = require("../../src/core/TestRunner");
const ReportManager = require("../../src/core/ReportManager");

const HTML = `<!doctype html><html><body>
<h1 id="title">Lighthouse briefing</h1>
<a id="src" class="src" href="https://example.org/x" rel="noopener noreferrer">Original</a>
<a class="dup">one</a><a class="dup">two</a>
<div id="hidden" style="display:none">secret</div>
<button id="late" type="button">late</button>
<script>setTimeout(function(){var p=document.createElement('p');p.id='late-p';p.textContent='arrived';document.body.appendChild(p);},300);</script>
</body></html>`;

async function withPage(t, fn) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(HTML);
  return fn(page);
}

function runner(page, scenarios, extra = {}) {
  const r = new TestRunner(page, { url: "about:blank", test_scenarios: scenarios, ...extra }, { healerOptions: { tier1: { maxAttempts: 1, baseDelayMs: 1, selectorTimeoutMs: 200 } } });
  // Healing must never be involved in an assertion.
  for (const m of ["healAndClick", "healAndType", "healAndSelect"]) r.healer[m] = async () => { throw new Error("healer must not be called for expect"); };
  return r;
}
const ex = (check, locator, more = {}) => ({ action: "expect", check, locator, description: `${check} ${locator}`, timeoutMs: 600, ...more });

test("every supported check passes and records evidence", (t) => withPage(t, async (page) => {
  const r = runner(page, [
    ex("visible", "#title"),
    ex("containsText", "#title", { value: "Lighthouse" }),
    ex("attributeExists", "#src", { attribute: "href" }),
    ex("attributeEquals", "#src", { attribute: "rel", value: "noopener noreferrer" }),
  ]);
  const results = await r.executeTest();
  assert.deepEqual(results.map((x) => x.status), ["passed", "passed", "passed", "passed"]);
  for (const x of results) {
    assert.equal(x.assertion.outcome, "passed");
    assert.equal(x.assertion.matches, 1);
    assert.equal(x.assertion.timeoutMs, 600);
  }
  assert.equal(results[1].assertion.expected, "Lighthouse");
  assert.equal(results[3].assertion.actual, "noopener noreferrer");
}));

test("a condition that does not hold is a failed assertion, not an unavailable target", (t) => withPage(t, async (page) => {
  const results = await runner(page, [
    ex("visible", "#hidden"),
    ex("containsText", "#title", { value: "Nope" }),
    ex("attributeExists", "#src", { attribute: "download" }),
    ex("attributeEquals", "#src", { attribute: "rel", value: "other" }),
  ]).executeTest();
  assert.deepEqual(results.map((x) => x.status), ["failed", "failed", "failed", "failed"]);
  for (const x of results) {
    assert.equal(x.assertion.outcome, "assertion_failed");
    assert.equal(x.errorType, "assertion");
    assert.match(x.error, /^Assertion failed: /);
  }
  assert.equal(results[1].assertion.actual, "Lighthouse briefing");
  assert.equal(results[3].assertion.actual, "noopener noreferrer");
}));

test("a missing target is unavailable and a multi-match target is ambiguous", (t) => withPage(t, async (page) => {
  const results = await runner(page, [ex("visible", "#absent"), ex("visible", ".dup")]).executeTest();
  assert.deepEqual(results.map((x) => x.status), ["unavailable", "unavailable"]);
  assert.equal(results[0].assertion.outcome, "target_unavailable");
  assert.equal(results[1].assertion.outcome, "target_ambiguous");
  assert.equal(results[1].assertion.matches, 2);
  assert.match(results[0].reason, /not found/);
}));

test("an element that arrives within the timeout still passes", (t) => withPage(t, async (page) => {
  const results = await runner(page, [ex("containsText", "#late-p", { value: "arrived", timeoutMs: 3000 })]).executeTest();
  assert.equal(results[0].status, "passed");
}));

test("assertion results flow into the report tally and make the run fail", (t) => withPage(t, async (page) => {
  const results = await runner(page, [ex("visible", "#title"), ex("containsText", "#title", { value: "Nope" })]).executeTest();
  const report = ReportManager.buildReport({ tests: results, runId: "r", duration: "0s" });
  assert.equal(report.result, "PARTIAL");
  assert.equal(report.summary.failed, 1);
  assert.equal(report.tests[1].assertion.check, "containsText");
  const onlyUnavailable = ReportManager.buildReport({ tests: await runner(page, [ex("visible", "#absent")]).executeTest(), runId: "r", duration: "0s" });
  assert.equal(onlyUnavailable.result, "FAILED");
}));

test("a locator failure on a click is healed or unavailable, and an assertion is never healed", (t) => withPage(t, async (page) => {
  const r = runner(page, [{ action: "click", locator: "#nothing-here", description: "Click missing" }]);
  r.healer.healAndClick = async () => { const e = new Error("gone"); e.code = "TARGET_UNAVAILABLE"; throw e; };
  const [click] = await r.executeTest();
  assert.equal(click.status, "unavailable");
  assert.equal(click.assertion, undefined);
}));

test("journey mode stops at the first step that does not pass and reports the rest as skipped", (t) => withPage(t, async (page) => {
  const results = await runner(page, [
    ex("visible", "#title"),
    ex("containsText", "#title", { value: "Nope" }),
    ex("visible", "#src"),
  ], { journey: true }).executeTest();
  assert.deepEqual(results.map((x) => x.status), ["passed", "failed", "skipped"]);
  assert.match(results[2].reason, /earlier step did not pass/);
}));

async function servers(t) {
  const http = require("node:http");
  const make = async (body) => {
    const server = http.createServer((q, res) => { res.setHeader("content-type", "text/html"); res.end(body(q.url)); });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => server.close());
    return `http://127.0.0.1:${server.address().port}`;
  };
  return make;
}

test("journey mode does not reset the page between steps; plain mode returns to the plan URL", async (t) => {
  const make = await servers(t);
  const base = await make((u) => (u.startsWith("/b") ? "<p id=b>b</p>" : "<p id=a>a</p>"));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const plan = (journey) => ({ url: `${base}/a`, journey, test_scenarios: [ex("visible", "#b"), ex("visible", "#b")] });
  await page.goto(`${base}/b`);
  const journey = await new TestRunner(page, plan(true), {}).executeTest();
  assert.deepEqual(journey.map((x) => x.status), ["passed", "passed"]);
  assert.match(page.url(), /\/b$/);
  await page.goto(`${base}/b`);
  const plain = await new TestRunner(page, plan(false), {}).executeTest();
  assert.deepEqual(plain.map((x) => x.status), ["passed", "unavailable"]);
});

test("journey mode fails the run if a step leaves the plan's origin", async (t) => {
  const make = await servers(t);
  const other = await make(() => "<p>elsewhere</p>");
  const base = await make(() => `<a id=out href="${other}/">x</a>`);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${base}/`);
  const r = new TestRunner(page, { url: `${base}/`, journey: true, test_scenarios: [
    { action: "click", locator: "#out", description: "Leave" },
    ex("visible", "#out"),
  ] }, {});
  r.healer.healAndClick = async (sel) => { await page.click(sel); await page.waitForLoadState("load"); };
  const results = await r.executeTest();
  assert.equal(results[0].status, "passed");
  assert.equal(results[1].status, "failed");
  assert.equal(results[1].errorType, "unexpected_navigation");
  assert.equal(results[2].status, "skipped");
});
