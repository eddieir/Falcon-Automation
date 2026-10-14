"use strict";
// The two outcomes of the News-journey gate, hermetically, through the real
// `node falcon.js` from a throw-away copy of the repository:
//   1. stable identity + renamed test hook  -> recovered, pending, approved, reused
//   2. structural movement, no stable identity -> refused before scoring, nothing performed
// No clone of AI-agency and no network access is needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const news = require("../fixtures/customer-demo/newsServer");
const E = require("../../scripts/demo/lib/env");

const PHRASE = "Lighthouse Agent Protocol";
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

let ctx;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-news-recovery-"));
  const falcon = path.join(dir, "falcon");
  await E.prepareFalconCopy(falcon);
  ctx = { dir, falcon, app: await news.start() };
});
test.after(async () => {
  await ctx.app.close();
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

const reset = () => {
  fs.rmSync(path.join(ctx.falcon, "data"), { recursive: true, force: true });
  fs.rmSync(path.join(ctx.falcon, "reports"), { recursive: true, force: true });
};
const report = () => JSON.parse(fs.readFileSync(path.join(ctx.falcon, "reports", "test-report.json"), "utf8"));
const memory = () => {
  const file = path.join(ctx.falcon, "data", "locator_memory.json");
  return fs.existsSync(file) ? Object.values(JSON.parse(fs.readFileSync(file, "utf8")).entries || {}) : [];
};
const falcon = async (args, env = {}) => {
  const run = E.startFalcon(ctx.falcon, args, { log: new E.OutputLog(), env });
  return run.exit;
};

/** Falcon discovers the page; the saved journey uses the Agents locator it captured. */
async function discoverJourney(name) {
  const discovered = path.join(ctx.dir, `${name}-discovered.json`);
  assert.equal(await falcon([`--url=${ctx.app.url}/news`, "--single-page", "--no-dashboard", `--save-plan=${discovered}`]), 0);
  const click = JSON.parse(fs.readFileSync(discovered, "utf8")).scenarios.find((s) => s.action === "click" && s.description === "Click Agents");
  assert.ok(click, "Falcon captured the Agents control");
  const planFile = path.join(ctx.dir, `${name}-plan.json`);
  fs.writeFileSync(planFile, JSON.stringify({
    format: "falcon-test-plan",
    version: 1,
    url: `${ctx.app.url}/news`,
    journey: true,
    scenarios: [
      { action: "click", locator: click.locator, description: "Select the Agents category" },
      { action: "expect", check: "containsText", locator: "h2.lead", value: PHRASE, description: "Only the Agents briefing is listed" },
    ],
  }));
  return { planFile, locator: click.locator };
}

async function matches(selectors) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${ctx.app.url}/news`);
    const out = {};
    for (const s of selectors) out[s] = await page.locator(s).count();
    return out;
  } finally {
    await browser.close();
  }
}

test("renamed test hook with stable identity: recovered, pending, approved through the dashboard, reused by a fresh process", async (t) => {
  reset();
  ctx.app.setVersion("hooks");
  const { planFile, locator } = await discoverJourney("hooks");
  assert.equal(locator, '[data-testid="news-category-agents"]', "the captured selector is the original data-testid");

  reset();
  assert.equal(await falcon([`--plan=${planFile}`, "--no-dashboard"]), 0, "baseline passes");
  assert.equal(report().summary.passed, 2);
  assert.equal(report().healingEvents.length, 0, "the baseline needs no recovery");

  ctx.app.setVersion("renamed");
  const probe = await matches([locator, "#news-category-agents"]);
  assert.equal(probe[locator], 0, "the old data-testid matches nothing");
  assert.equal(probe["#news-category-agents"], 1, "the preserved id matches exactly one control");

  const port = await freePort();
  const run = E.startFalcon(ctx.falcon, [`--plan=${planFile}`], { log: new E.OutputLog(), env: { DASHBOARD_PORT: String(port), DASHBOARD_LINGER_MS: "15000" } });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 2400 } });
  for (let i = 0; i < 100; i++) { try { await page.goto(`http://127.0.0.1:${port}/`, { timeout: 1500 }); break; } catch { await E.sleep(200); } }
  await page.locator("#locator-entries-list .btn-approve").first().waitFor({ state: "visible", timeout: 30000 });
  assert.match(await page.locator("#locator-entries-list").innerText(), /Pending review/);
  assert.ok(Number(await page.locator("#t-heal").innerText()) >= 1, "the dashboard counts the recovery before approval");
  const pending = memory()[0];
  assert.ok(pending.pendingCandidate && pending.pendingCandidate.proposalId, "a pending proposal exists");
  assert.equal(pending.pendingCandidate.selector, '[data-testid="news-filter-agents"]');
  assert.ok(pending.pendingCandidate.total >= 0.85, "accepted at the unchanged threshold");

  let approved = false;
  for (let i = 0; i < 8 && !approved; i++) {
    const box = await page.locator("#locator-entries-list .btn-approve").first().boundingBox().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(700);
    approved = /Approved for scoped reuse/.test(await page.locator("#locator-entries-list").innerText());
  }
  assert.ok(approved, "approval was made through the real dashboard control");
  assert.equal(await run.exit, 0, "the unchanged journey completes");
  const healed = report();
  assert.equal(healed.summary.passed, 2);
  assert.ok(healed.healingEvents.some((e) => e.resolved === '[data-testid="news-filter-agents"]' && e.original === locator));
  const entry = memory()[0];
  assert.ok(entry.approvedAlternative && !entry.pendingCandidate, "approval is persisted");

  assert.equal(await falcon([`--plan=${planFile}`, "--no-dashboard"]), 0, "fresh process passes");
  const again = report();
  assert.ok(again.healingEvents.some((e) => e.status === "approved_reuse"));
  assert.ok(!again.healingEvents.some((e) => e.status === "refused" || e.status === "pending"), "no new candidate search");
});

test("structural movement without stable identity: refused before scoring, no proposal, no action", async () => {
  reset();
  ctx.app.setVersion("bare");
  const { planFile, locator } = await discoverJourney("bare");
  assert.match(locator, /nth-of-type/, "without hooks the captured selector is structural");

  reset();
  assert.equal(await falcon([`--plan=${planFile}`, "--no-dashboard"]), 0, "baseline passes");
  assert.equal(report().summary.passed, 2);

  ctx.app.setVersion("structural");
  assert.equal((await matches([locator]))[locator], 0, "the structural path no longer matches");

  assert.equal(await falcon([`--plan=${planFile}`, "--no-dashboard"]), 1);
  const r = report();
  const refusal = r.healingEvents.find((e) => e.status === "refused");
  assert.ok(refusal, "the recovery was refused");
  assert.equal(refusal.reason, "insufficient_identity_evidence");
  for (const key of ["winner", "total", "runnerUp", "contributions"]) assert.equal(refusal[key], undefined, `no candidate was scored (${key})`);
  assert.equal(refusal.resolved, null);
  assert.deepEqual(r.tests.map((x) => x.status), ["unavailable", "skipped"], "the click was not performed and the outcome step never ran");
  assert.equal(r.summary.passed, 0);
  assert.ok(!memory().some((e) => e.pendingCandidate || e.approvedAlternative), "no proposal was created");
});
