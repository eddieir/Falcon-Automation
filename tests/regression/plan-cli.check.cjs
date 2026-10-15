"use strict";
// --plan / --save-plan through the real `node falcon.js` entry point, run from
// a throw-away copy of the repository so data/ and reports/ start empty.
// Covers: replay, assertions in the report and exit code, rejected plans,
// recovery -> pending proposal -> approval through the real dashboard control
// -> reuse by a fresh process, and unchanged behaviour when the flags are absent.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const fixture = require("../fixtures/customer-demo/checkoutServer");
const E = require("../../scripts/demo/lib/env");

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const plan = (url, extra = []) => ({
  format: "falcon-test-plan",
  version: 1,
  url: `${url}/checkout`,
  journey: true,
  scenarios: [
    { action: "click", locator: "#checkout-submit", description: "Complete the order" },
    { action: "expect", check: "containsText", locator: '[data-testid="order-confirmation"]', value: "Order completed", description: "The order is confirmed" },
    ...extra,
  ],
});

let ctx;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-plan-cli-"));
  const falcon = path.join(dir, "falcon");
  await E.prepareFalconCopy(falcon);
  ctx = { dir, falcon, app: await fixture.start() };
});
test.after(async () => {
  await ctx.app.close();
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

const write = (name, doc) => {
  const file = path.join(ctx.dir, name);
  fs.writeFileSync(file, typeof doc === "string" ? doc : JSON.stringify(doc));
  return file;
};
const reset = () => {
  fs.rmSync(path.join(ctx.falcon, "data"), { recursive: true, force: true });
  fs.rmSync(path.join(ctx.falcon, "reports"), { recursive: true, force: true });
  ctx.app.reset();
};
const report = () => JSON.parse(fs.readFileSync(path.join(ctx.falcon, "reports", "test-report.json"), "utf8"));
const falcon = async (args, env = {}) => {
  const log = new E.OutputLog();
  const run = E.startFalcon(ctx.falcon, args, { log, env });
  const code = await run.exit;
  return { code, out: log.lines.map((l) => l.line).join("\n") };
};

test("rejected plans exit 2 before any browser work, and name no plan contents", async () => {
  const cases = [
    ["missing", path.join(ctx.dir, "nope.json")],
    ["not-json", write("bad.json", "{ nope")],
    ["wrong-version", write("v9.json", { ...plan(ctx.app.url), version: 9 })],
    ["unknown-prop", write("unk.json", { ...plan(ctx.app.url), surprise: true })],
    ["bad-selector", write("sel.json", (() => { const p = plan(ctx.app.url); p.scenarios[0].locator = "button["; return p; })())],
  ];
  for (const [name, file] of cases) {
    const { code, out } = await falcon([`--plan=${file}`, "--no-dashboard"]);
    assert.equal(code, 2, `${name}: exit code`);
    assert.match(out, /Plan (rejected|file)|Cannot read plan|not valid JSON/, name);
    assert.doesNotMatch(out, /Navigating to/, `${name}: must stop before navigating`);
  }
});

test("--url must share the plan's origin; flag combinations are refused", async () => {
  const file = write("ok.json", plan(ctx.app.url));
  assert.equal((await falcon([`--plan=${file}`, "--url=http://127.0.0.1:1/", "--no-dashboard"])).code, 2);
  assert.equal((await falcon([`--plan=${file}`, "--single-page", "--no-dashboard"])).code, 1);
  assert.equal((await falcon([`--plan=${file}`, `--save-plan=${path.join(ctx.dir, "x.json")}`, "--no-dashboard"])).code, 1);
  assert.equal((await falcon([`--save-plan=${path.join(ctx.dir, "y.json")}`, `--url=${ctx.app.url}/checkout`, "--no-dashboard"])).code, 1);
  assert.equal(fs.existsSync(path.join(ctx.dir, "y.json")), false);
});

test("without the new flags the CLI behaves as before and writes no plan", async () => {
  reset();
  const before = new Set(fs.readdirSync(ctx.falcon));
  const { code } = await falcon([`--url=${ctx.app.url}/checkout`, "--single-page", "--no-dashboard"]);
  assert.equal(code, 0);
  assert.equal(report().result, "PASSED");
  assert.deepEqual(new Set(fs.readdirSync(ctx.falcon).filter((n) => !["data", "reports"].includes(n))), new Set([...before].filter((n) => !["data", "reports"].includes(n))));
});

test("--save-plan writes the versioned plan Falcon generated, and --plan replays it", async () => {
  reset();
  const file = path.join(ctx.dir, "saved.json");
  const saved = await falcon([`--url=${ctx.app.url}/checkout`, "--single-page", "--no-dashboard", `--save-plan=${file}`]);
  assert.equal(saved.code, 0);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(doc.format, "falcon-test-plan");
  assert.equal(doc.version, 1);
  assert.ok(doc.scenarios.some((s) => s.action === "click"));
  assert.doesNotMatch(saved.out, /test_value/, "values are not logged");
  reset();
  const replay = await falcon([`--plan=${file}`, "--no-dashboard"]);
  assert.equal(replay.code, 0);
  assert.equal(report().result, "PASSED");
  assert.equal(report().summary.total, doc.scenarios.length);
});

test("a failing assertion is reported with evidence and fails the process, without healing", async () => {
  reset();
  const file = write("wrong.json", plan(ctx.app.url, [
    { action: "expect", check: "containsText", locator: '[data-testid="order-confirmation"]', value: "Refunded", description: "Wrong expectation", timeoutMs: 500 },
  ]));
  const { code } = await falcon([`--plan=${file}`, "--no-dashboard"]);
  assert.equal(code, 1);
  const r = report();
  const bad = r.tests.find((t) => t.name === "Wrong expectation");
  assert.equal(bad.status, "failed");
  assert.equal(bad.assertion.outcome, "assertion_failed");
  assert.equal(bad.assertion.actual, "Order completed");
  assert.equal(r.healingEvents.length, 0);
  assert.equal(r.summary.failed, 1);
});

test("unchanged plan: baseline passes, locator-only change recovers, approval persists, a fresh process reuses it", async (t) => {
  reset();
  const file = write("journey.json", plan(ctx.app.url));

  const base = await falcon([`--plan=${file}`, "--no-dashboard"]);
  assert.equal(base.code, 0, base.out);
  assert.equal(report().healingEvents.length, 0, "the baseline needs no recovery");

  ctx.app.setVersion(2);
  const port = await freePort();
  const log = new E.OutputLog();
  const run = E.startFalcon(ctx.falcon, [`--plan=${file}`], { log, env: { DASHBOARD_PORT: String(port), DASHBOARD_LINGER_MS: "15000" } });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 2400 } });
  for (let i = 0; i < 100; i++) { try { await page.goto(`http://127.0.0.1:${port}/`, { timeout: 1500 }); break; } catch { await E.sleep(200); } }
  const approve = page.locator("#locator-entries-list .btn-approve").first();
  await approve.waitFor({ state: "visible", timeout: 30000 });
  assert.match(await page.locator("#locator-entries-list").innerText(), /Pending review/);
  assert.ok(Number(await page.locator("#t-heal").innerText()) >= 1, "the dashboard counts the recovery before approval");
  // The panel re-renders on every dashboard event, so click by position and
  // retry until the decision lands (a click on a node that was just replaced is lost).
  let approved = false;
  for (let i = 0; i < 8 && !approved; i++) {
    const box = await page.locator("#locator-entries-list .btn-approve").first().boundingBox().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(700);
    approved = /Approved for scoped reuse/.test(await page.locator("#locator-entries-list").innerText());
  }
  assert.ok(approved, "the dashboard shows the replacement as approved");
  assert.equal(await run.exit, 0, "recovery run passes after the original locator failed");

  const healed = report();
  assert.equal(healed.result, "PASSED");
  const ev = healed.healingEvents.filter((e) => e.resolved);
  assert.ok(ev.length >= 1, "a resolved recovery is in the report");
  assert.equal(ev[0].original, "#checkout-submit");
  assert.match(ev[0].resolved, /place-order|checkout-complete/);
  const memory = JSON.parse(fs.readFileSync(path.join(ctx.falcon, "data", "locator_memory.json"), "utf8"));
  const entry = Object.values(memory.entries || memory)[0];
  assert.ok(entry.approvedAlternative, "approval is persisted on disk");
  assert.ok(!entry.pendingCandidate, "no pending proposal remains");

  const reuse = await falcon([`--plan=${file}`, "--no-dashboard"]);
  assert.equal(reuse.code, 0, reuse.out);
  const r3 = report();
  assert.equal(r3.result, "PASSED");
  assert.ok(r3.healingEvents.some((e) => e.status === "approved_reuse"), "the approved locator is reused");
  assert.ok(!r3.healingEvents.some((e) => e.status === "refused" || e.status === "pending"), "no new candidate recovery");
});
