"use strict";
/**
 * Customer-demo run engine. Drives the REAL Falcon healer against the local
 * checkout fixture and the REAL dashboard; nothing is faked. Any refusal by
 * Falcon is surfaced as a failure with the healer's own reason.
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");
const { captionFor, sceneFor, evidenceRows, endCard } = require("./captions");

const ROOT = path.join(__dirname, "..", "..", "..");
const req = (p) => require(path.join(ROOT, p));

const LAYOUTS = {
  wide: { app: { width: 960, height: 840 }, dashboard: { width: 960, height: 840 }, stage: { width: 1920, height: 1080 } },
  portrait: { app: { width: 1080, height: 500 }, dashboard: { width: 1080, height: 560 }, stage: { width: 1080, height: 1350 } },
};
const ZOOM = { wide: 1.15, portrait: 1.45 };
// Dwell AFTER each action so viewers can read; only used when recording.
// The recovery phase now also spends real wall-clock time inside the healer
// itself (pacing.stageDelayMs separating original_failed -> recovery_started
// -> candidate_selected -> action_completed -> proposal_pending, see
// STAGE_PACING below), so these post-action dwell values are reduced from
// their pre-pacing originals to keep total runtime in the agreed band.
const RECORD_DWELL = {
  wide: { baseline: 8000, "locator-changed": 6000, failure: 4000, recovery: 6000, approval: 8000, "approved-reuse": 8000, evidence: 6000, endcard: 6000 },
  portrait: { baseline: 5000, "locator-changed": 4000, failure: 3000, recovery: 4000, approval: 5000, "approved-reuse": 5000, evidence: 4000, endcard: 4000 },
};
// Real await inside AIHealer between each healingStage event (see
// AIHealer._emitStage / `pacing` ctor option) so the viewer sees the
// original selector fail, then the candidate get chosen, BEFORE the real
// click fires — only used when recording; 0/absent elsewhere (production).
const STAGE_PACING = { wide: 1800, portrait: 1200 };
const STAGE_HTML = path.join(__dirname, "stage", "stage.html");
const DEFAULT_DWELL = {
  baseline: 1200, "locator-changed": 1500, failure: 1200, recovery: 1800, approval: 1500, "approved-reuse": 2000,
};
const PROVIDER_KEYS = [
  "OPENAI_API_KEY", "OPENAI_ORG_ID", "OPENAI_ORGANIZATION", "OPENAI_PROJECT", "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
];
// Any env var whose name starts with one of these prefixes is also a
// provider credential/selector and must not survive into the engine run
// (covers AZURE_OPENAI_* and every FALCON_LLM_* key ConfigManager/LlmConfig
// read, e.g. FALCON_LLM_PROVIDER, FALCON_LLM_API_KEY, FALCON_LLM_MODEL, the
// Azure FALCON_LLM_AZURE_* trio, FALCON_LLM_ENDPOINT, and the
// FALCON_LLM_ALLOW_* escape hatches).
const PROVIDER_KEY_PREFIXES = ["AZURE_OPENAI_", "FALCON_LLM_"];
function stripProviderEnv() {
  for (const k of PROVIDER_KEYS) delete process.env[k];
  for (const k of Object.keys(process.env)) {
    if (PROVIDER_KEY_PREFIXES.some((p) => k.startsWith(p))) delete process.env[k];
  }
}
const SCENARIO = { action: "click", locator: "#checkout-submit", description: "Complete order" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
class DemoAssertion extends Error {}

/** Serialises real-event scenes onto the stage page; each item may hold for reading time. */
function makeStage(page, startMs) {
  const queue = [];
  const waiters = [];
  const api = { changes: [], evidenceAt: null };
  let busy = false;
  // Records the card title (if any) alongside the scene so compose.js can
  // cross-check it against the real timeline event that proves it (see
  // CARD_TRIGGERS in captions.js); card:null scenes are caption-only and are
  // exempt from that check.
  const stamp = (s) => api.changes.push({ t: Date.now() - startMs, scene: s.scene, card: s.card ? s.card.title : null });
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const { s, hold } = queue.shift();
      try {
        await page.evaluate((st) => window.stageApi.setState(st), s);
        stamp(s);
      } catch { /* page closing */ }
      if (hold) await sleep(hold);
    }
    busy = false;
    while (waiters.length) waiters.shift()();
  }
  api.push = (s, hold = 0) => { if (!s) return; queue.push({ s, hold }); pump(); };
  api.drain = () => (busy || queue.length ? new Promise((r) => waiters.push(r)) : Promise.resolve());
  api.evidence = (rows, note) => { api.evidenceAt = Date.now() - startMs; stamp("evidence"); return page.evaluate(([r, n]) => window.stageApi.showEvidence(r, n), [rows, note]); };
  api.endCard = (lines) => { stamp("endcard"); return page.evaluate((l) => window.stageApi.showEndCard(l), lines); };
  return api;
}

async function run({ layout = "wide", record = false, outDir, pace = {}, onEvent = () => {}, onPhase = () => {} } = {}) {
  const Logger = req("utils/Logger");
  const vp = LAYOUTS[layout];
  if (!vp) throw new Error(`Unknown layout "${layout}" (use wide|portrait)`);
  if (process.env.DASHBOARD_TOKEN) {
    throw new Error("DASHBOARD_TOKEN is set in the environment; the customer demo runs a tokenless loopback dashboard. Unset it and retry.");
  }
  if (!outDir) throw new Error("outDir is required");
  const dwell = { ...DEFAULT_DWELL, ...(record ? RECORD_DWELL[layout] : {}), ...(pace.dwellMs || {}) };
  // Load ConfigManager FIRST (it runs `dotenv.config()` at require-time, see
  // src/core/ConfigManager.js), so a `.env` file's provider keys are already
  // pulled into process.env before we strip them below. Stripping before
  // this point would be defeated by dotenv re-populating the same names.
  req("src/core/ConfigManager");
  stripProviderEnv();

  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-customer-demo-"));
  let browser, fixture, dashboard, Middleware, origEmitter, emitterWrapped = false;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (emitterWrapped) { try { Middleware.setEmitter(origEmitter); } catch { /* best effort */ } }
    try { if (browser) await browser.close(); } catch { /* best effort */ }
    try { if (dashboard) await dashboard.stop(); } catch { /* best effort */ }
    try { if (fixture) await fixture.close(); } catch { /* best effort */ }
    await fs.promises.rm(tmp, { recursive: true, force: true });
  };
  const onSignal = (sig) => { cleanup().finally(() => process.exit(sig === "SIGINT" ? 130 : 143)); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const t0 = Date.now();
  const timeline = [];
  const phases = [];
  const checks = [];
  const ok = (label, cond, detail) => {
    if (!cond) throw new DemoAssertion(`Assertion failed: ${label}${detail ? ` (${detail})` : ""}`);
    checks.push(label);
    Logger.info(`  ok  ${label}`);
  };
  let curPhase = "";
  const versionIds = {};
  let stage = null; // stage driver, only when recording
  const phase = async (name) => {
    curPhase = name;
    const t = Date.now() - t0;
    phases.push({ name, t });
    Logger.info(`== ${name} (t=${t}ms)`);
    onPhase(name, t);
    if (stage && ["baseline", "approval", "approved-reuse"].includes(name)) stage.push(sceneFor(name, sctx()));
  };
  const sctx = () => ({ phase: curPhase, versionIds, scenario: SCENARIO });
  const ev = (name) => timeline.filter((e) => e.name === name);

  try {
    // State isolation: every persistent store goes to the temp dir.
    const LocatorStore = req("src/core/AIHealer/LocatorStore");
    LocatorStore.storePath = path.join(tmp, "locator_store.json");
    LocatorStore.data = {};
    const HealingTrust = req("src/core/AIHealer/HealingTrust");
    HealingTrust.pendingPath = path.join(tmp, "healing_pending.json");
    HealingTrust.decisionsPath = path.join(tmp, "healing_decisions.json");
    HealingTrust._reload();
    const FlakinessTracker = req("src/core/FlakinessTracker");
    FlakinessTracker.historyPath = path.join(tmp, "scenario_history.json");
    FlakinessTracker.decisionsPath = path.join(tmp, "quarantine_decisions.json");
    FlakinessTracker._reload();
    const HealingReport = req("src/core/AIHealer/HealingReport");
    HealingReport._instance.filePath = path.join(tmp, "healing_logs.json");
    HealingReport._instance.logs = [];

    const LocatorMemory = req("src/core/locator/LocatorMemory");
    const memory = new LocatorMemory({ memoryPath: path.join(tmp, "locator_memory.json"), env: { FALCON_LOCATOR_SALT: "customer-demo" } });
    const Dashboard = req("src/core/Dashboard");
    const TestRunner = req("src/core/TestRunner");
    Middleware = req("src/core/Middleware");
    const { start: startFixture } = req("tests/fixtures/customer-demo/checkoutServer");

    fixture = await startFixture({ port: await freePort() });
    dashboard = new Dashboard({ port: await freePort(), host: "127.0.0.1", locatorMemory: memory });
    await dashboard.start();
    const dashUrl = dashboard.url.replace("localhost", "127.0.0.1");

    // Dashboard.emit is the single funnel for both Middleware events (via its
    // registered emitter) and dashboard-originated ones such as locatorDecision.
    const dashEmit = dashboard.emit.bind(dashboard);
    dashboard.emit = (name, payload) => {
      const row = { t: Date.now() - t0, name, payload: payload === undefined ? {} : JSON.parse(JSON.stringify(payload)) };
      timeline.push(row);
      try { onEvent(row); } catch { /* observer must not break the run */ }
      if (stage) {
        try {
          // Apply each scene the moment its real event arrives — no queued
          // per-scene hold here. The healer's own `pacing.stageDelayMs`
          // (real await, see AIHealer._emitStage) is what actually separates
          // consecutive healingStage events in wall-clock time now, so the
          // caption for a stage and the real action it describes stay in
          // the order the viewer sees them.
          const c = captionFor(row, sctx());
          if (c) stage.push(c, 0);
        } catch { /* stage must not break the run */ }
      }
      return dashEmit(name, payload);
    };

    browser = await chromium.launch();
    const startedAt = {};
    const mkCtx = async (key) => {
      const viewport = vp[key];
      const opts = { viewport, deviceScaleFactor: 1 };
      if (record) opts.recordVideo = { dir: path.join(record.dir, key), size: viewport };
      startedAt[key] = Date.now();
      const ctx = await browser.newContext(opts);
      if (key !== "stage") await ctx.addInitScript(require("./cursor"));
      return ctx;
    };
    const screens = path.join(outDir, "screens");
    if (record) await fs.promises.rm(record.dir, { recursive: true, force: true });
    let stageCtx, stagePage;
    if (record) {
      await fs.promises.mkdir(screens, { recursive: true });
      stageCtx = await mkCtx("stage");
      stagePage = await stageCtx.newPage();
      await stagePage.goto(`${pathToFileURL(STAGE_HTML).href}?layout=${layout}`);
      await stagePage.waitForFunction(() => window.stageReady === true);
      stage = makeStage(stagePage, startedAt.stage);
    }
    const appCtx = await mkCtx("app");
    const dashCtx = await mkCtx("dashboard");
    const app = await appCtx.newPage();
    const dash = await dashCtx.newPage();
    await dash.goto(dashUrl);
    if (record) {
      await dash.evaluate((z) => { document.documentElement.style.zoom = String(z); }, ZOOM[layout]);
      // Zoom scales everything together but the run-panel row (Mode/Workers)
      // sits tight above the coverage heading; give it breathing room so the
      // two never visually overlap at either recording zoom level.
      await dash.addStyleTag({ content: `
        #run-panel { position: relative !important; display: flex !important; flex-wrap: wrap !important;
          gap: 4px 10px !important; overflow: visible !important; margin-bottom: 14px !important; }
        #coverage-section { position: relative !important; margin-top: 10px !important; clear: both !important; }
        /* The Tier 3 (AI-inferred) healing-trust review panel is always-empty
           in this demo (no provider-assisted path is exercised); hide it in
           recordings only so it cannot be mistaken for part of the local
           recovery story. Never edited in src/dashboard/index.html. */
        #healing-section, #healing-trend-table { display: none !important; }
      ` });
    }
    const shot = async (name) => { if (stagePage) await stagePage.screenshot({ path: path.join(screens, `${name}.png`) }); };

    const runner = new TestRunner(app, {}, {
      healerOptions: {
        locatorMemory: memory, tier1: { maxAttempts: 2, baseDelayMs: 150, selectorTimeoutMs: 800 },
        ...(record ? { pacing: { stageDelayMs: STAGE_PACING[layout] } } : {}),
      },
    });
    runner.healer.getAlternativeSelector = async () => { throw new Error("Tier 3 (LLM) must be unreachable in the customer demo"); };
    const runScenario = async () => {
      const before = runner.results.length;
      await runner.runScenario({ ...SCENARIO });
      const r = runner.results.slice(before).pop();
      // Drive the dashboard's real Total/Passed/Failed tiles from the actual
      // result row (same public API documented in Dashboard.js); never
      // fabricate numbers independent of what TestRunner actually recorded.
      if (r && r.status === "passed") dashboard.emit("testPass", { name: r.name, duration: r.duration || 0 });
      else if (r) dashboard.emit("testFail", { name: r.name, error: r.error || r.status });
      return r;
    };
    const completed = async () => {
      const loc = app.locator('[data-testid="order-confirmation"]');
      await loc.waitFor({ state: "visible", timeout: 5000 });
      return (await loc.innerText()).includes("Order completed");
    };
    const checkoutUrl = `${fixture.url}/checkout`;
    const memEntries = () => Object.values(memory.list());
    const refusal = () => ev("healingEvent").map((e) => e.payload).find((p) => /refus|below_threshold/i.test(String(p.status)));
    const failOnRefusal = () => {
      const r = refusal();
      if (r) throw new DemoAssertion(`Falcon refused the heal: status=${r.status} reason=${r.reason || JSON.stringify(r.reasons || r.detail || "")}`);
    };
    const stageNames = () => ev("healingStage").map((e) => e.payload.stage);
    const counts = { passed: 0, healed: 0, refused: 0 };

    // 1 baseline
    await phase("baseline");
    await app.goto(checkoutUrl);
    versionIds.v1 = await app.getAttribute('[data-testid="checkout-complete"]', "id");
    let r = await runScenario();
    ok("baseline scenario passed", r && r.status === "passed", r && r.status);
    ok("baseline order count is 1", fixture.orderCount() === 1);
    ok("baseline shows 'Order completed'", await completed());
    ok("baseline has no healingStage events", ev("healingStage").length === 0);
    ok("baseline has no healed events", !ev("healingEvent").some((e) => e.payload.resolved));
    ok("memory holds a trusted entry", memEntries().some((e) => e.trust === "trusted"), memEntries().map((e) => e.trust).join(","));
    counts.passed++;
    if (stage) stage.push(sceneFor("baseline-passed", sctx()));
    await sleep(dwell.baseline);

    // 2 locator changed
    await phase("locator-changed");
    fixture.setVersion(2);
    await app.goto(checkoutUrl);
    versionIds.v2 = await app.getAttribute('[data-testid="checkout-complete"]', "id");
    if (stage) { stage.push(sceneFor("locator-changed", sctx())); }
    ok("v1 and v2 ids differ", versionIds.v1 && versionIds.v2 && versionIds.v1 !== versionIds.v2, `${versionIds.v1}/${versionIds.v2}`);
    ok("old selector no longer matches", (await app.locator(`#${versionIds.v1}`).count()) === 0);
    ok("new selector matches", (await app.locator(`#${versionIds.v2}`).count()) === 1);
    if (stage) await shot("stage-compare");
    await sleep(dwell["locator-changed"]);

    // 3+4 failure and recovery
    if (record) {
      // Scroll the dashboard, before the scenario runs, so the locator-evidence
      // panel and the event feed header are both in view for the whole
      // recovery phase. The feed prepends new rows under its header, so
      // anchoring on the header keeps the five incoming recovery events
      // (original_failed..proposal_pending) readable without further motion.
      await dash.bringToFront();
      await dash.evaluate(() => {
        const feedHeader = document.querySelector("#feed-header");
        if (!feedHeader) return;
        // Leave a fixed band above the feed header (the tail of the
        // locator-evidence panel) so it stays visible for context, and
        // dedicate the rest of the viewport below the header to the feed
        // body itself so the incoming recovery rows are actually readable,
        // not just the "Event feed" header label.
        const contextAbovePx = 220;
        const headerTop = feedHeader.getBoundingClientRect().top + window.scrollY;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const target = Math.min(Math.max(headerTop - contextAbovePx, 0), Math.max(maxScroll, 0));
        window.scrollTo({ top: target, behavior: "smooth" });
      });
      await sleep(600);
    }
    await phase("failure");
    r = await runScenario();
    failOnRefusal();
    await phase("recovery");
    ok("healed scenario passed", r && r.status === "passed", r && r.status);
    const order = ["original_failed", "recovery_started", "candidate_selected", "action_completed", "proposal_pending"];
    const seen = stageNames();
    let idx = -1;
    const inOrder = order.every((s) => { const i = seen.indexOf(s, idx + 1); if (i < 0) return false; idx = i; return true; });
    ok("healingStage order original_failed..proposal_pending", inOrder, seen.join(">"));
    const accepted = ev("healingEvent").map((e) => e.payload).find((p) => p.tier === "LocatorMemory" && p.status === "accepted" && p.resolved);
    ok("healingEvent LocatorMemory accepted with resolved", !!accepted, ev("healingEvent").map((e) => e.payload.status).join(","));
    ok("healed order count is 2", fixture.orderCount() === 2);
    ok("healed shows 'Order completed'", await completed());
    ok("memory has a pending candidate", memEntries().some((e) => e.pendingCandidate && e.pendingCandidate.proposalId));
    const candStage = ev("healingStage").map((e) => e.payload).find((p) => p.stage === "candidate_selected");
    counts.passed++; counts.healed++;
    if (stage) { await sleep(2500); await shot("stage-recovery"); await stage.drain(); }
    else await sleep(dwell.recovery);

    // 5 human approval
    await phase("approval");
    await dash.bringToFront();
    const approveBtn = dash.locator("#locator-entries-list .btn-approve").first();
    await approveBtn.waitFor({ state: "visible", timeout: 10000 });
    if (record) {
      await approveBtn.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      await sleep(1200);
      await dash.screenshot({ path: path.join(screens, "dashboard-approval.png") });
    } else await approveBtn.scrollIntoViewIfNeeded();
    const box = await approveBtn.boundingBox();
    ok("approve button has a bounding box", !!box);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await dash.mouse.move(cx, cy, { steps: 25 });
    await sleep(400);
    await dash.mouse.click(cx, cy);
    const deadline = Date.now() + 8000;
    while (!ev("locatorDecision").length && Date.now() < deadline) await sleep(100);
    const entries = await (await fetch(`${dashUrl}/locator/entries`)).json();
    const approved = Object.values(entries).find((e) => e.approvedAlternative);
    ok("approvedAlternative is set", !!approved);
    ok("pendingCandidate cleared", !approved.pendingCandidate);
    ok("locatorDecision event received", ev("locatorDecision").length > 0);
    await sleep(dwell.approval);

    // 6 approved reuse (fresh page load; version stays 2, memory untouched)
    await phase("approved-reuse");
    const stagesBefore = ev("healingStage").length;
    await app.bringToFront();
    await app.goto(checkoutUrl);
    r = await runScenario();
    failOnRefusal();
    ok("reuse scenario passed", r && r.status === "passed", r && r.status);
    ok("healingEvent status approved_reuse", ev("healingEvent").some((e) => e.payload.status === "approved_reuse"));
    const newStages = ev("healingStage").slice(stagesBefore).map((e) => e.payload);
    ok("no new proposal_pending", !newStages.some((p) => p.stage === "proposal_pending"));
    ok("action_completed via approved", newStages.some((p) => p.stage === "action_completed" && p.via === "approved"), newStages.map((p) => `${p.stage}:${p.via}`).join(","));
    ok("no pending candidate remains", !memEntries().some((e) => e.pendingCandidate));
    ok("reuse order count is 3", fixture.orderCount() === 3);
    ok("reuse shows 'Order completed'", await completed());
    counts.passed++; counts.healed++;
    await sleep(dwell["approved-reuse"]);

    const lastStage = ev("healingStage").slice(stagesBefore).map((e) => e.payload);
    const result = {
      layout, phases, versionIds,
      viewports: record ? { app: vp.app, dashboard: vp.dashboard, stage: vp.stage } : { app: vp.app, dashboard: vp.dashboard },
      facts: {
        originalFailed: stageNames().includes("original_failed"),
        recovered: counts.healed >= 1 && ev("healingEvent").some((e) => e.payload.status === "accepted" && !!e.payload.resolved),
        businessActionCompleted: fixture.orderCount() === 3,
        approved: ev("locatorDecision").some((e) => e.payload.kind === "approve") && !!approved && !approved.pendingCandidate,
        reusedApproved: ev("healingEvent").some((e) => e.payload.status === "approved_reuse") && lastStage.some((p) => p.stage === "action_completed" && p.via === "approved"),
      },
      startedAt, counts, scenario: SCENARIO,
      selectors: { original: SCENARIO.locator, resolved: accepted.resolved },
      healing: {
        candidate: candStage ? { resolved: candStage.resolved, score: candStage.score, margin: candStage.margin, reasons: candStage.reasons } : null,
      },
      assertions: checks.length,
    };
    if (stage) {
      await stage.drain();
      stage.evidence(evidenceRows(result), `${result.assertions} checks passed on a local fixture`);
      await shot("stage-evidence");
      await sleep(dwell.evidence);
      stage.endCard(endCard());
      await shot("stage-end");
      await sleep(dwell.endcard);
    }
    const scrub = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === "string"
      ? x.split(tmp).join("<tmp>").split(ROOT).join(".").split(os.tmpdir()).join("<tmp>") : x)));
    await fs.promises.mkdir(outDir, { recursive: true });
    const endedAt = Date.now();
    const pages = { app, dashboard: dash, stage: stagePage };
    const ctxs = [appCtx, dashCtx, stageCtx];
    const vids = record ? Object.fromEntries(Object.entries(pages).filter(([, pg]) => pg).map(([k, pg]) => [k, pg.video()])) : {};
    for (const c of ctxs) if (c) await c.close();
    if (record) {
      result.videoPaths = {};
      for (const [k, v] of Object.entries(vids)) result.videoPaths[k] = path.relative(outDir, await v.path());
      result.startedAt = startedAt;
      result.stage = { startedAt: startedAt.stage, sceneChanges: stage.changes, evidenceCutoffMs: stage.evidenceAt, durationMs: endedAt - startedAt.stage };
      result.durationMs = result.stage.durationMs;
      // Absolute epoch for t0 (the base of every timeline.json "t") so
      // compose.js can convert stage.sceneChanges (relative to startedAt.stage)
      // and timeline events (relative to t0) into comparable absolute times.
      result.t0 = t0;
      result.notes = [
        "The dashboard's HEALING TRUST / Tier 3 (AI-inferred) review panel is hidden in this recording via engine-injected CSS because the provider-assisted healing path is not exercised in this demo; it is not removed from the product.",
      ];
    }
    await fs.promises.writeFile(path.join(outDir, "timeline.json"), JSON.stringify(scrub(timeline), null, 2));
    await fs.promises.writeFile(path.join(outDir, "result.json"), JSON.stringify(scrub(result), null, 2));
    return result;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await cleanup();
  }
}

module.exports = { run, LAYOUTS, SCENARIO };
