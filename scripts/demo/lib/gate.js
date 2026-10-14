"use strict";
/**
 * The functional gate for the News journey: starts the patched AI-agency and
 * the real `node falcon.js`, and records the evidence of each phase. It never
 * edits Falcon state, thresholds or locator memory — approval is a click on
 * the real dashboard control.
 *
 *   mode "hook-rename"  : stable id + data-testid; the refactor renames only the
 *                         data-testid. Expected: recovered, approved, reused.
 *   mode "structural"   : no stable hooks; a hidden status region shifts the
 *                         structural path. Expected: refused (insufficient_identity_evidence).
 *
 * With `capture: { dir }` the same run also records what the demo video needs:
 * videos of Falcon's browser and of two views of the real dashboard, still
 * images of the control, and a timeline of marks. Capture changes what is
 * recorded, not what is run or asserted.
 */

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { chromium } = require("playwright");
const E = require("./env");
const cursorScript = require("./cursor");
const { buildJourney, PHRASE } = require("./journey");
const { activateControl, HydrationError } = require("./hydration");

const PRELOAD = path.join(__dirname, "record-preload.js");
const VIEWS = { summary: { width: 1200, height: 210 }, locator: { width: 1200, height: 440 } };
// Pause after each browser action in recorded runs, so the journey is watchable.
const DEMO_SLOWMO_MS = 1500;
// In recorded runs the reviewer reads the pending proposal for this long before approving.
const DEMO_REVIEW_PAUSE_MS = 8000;

const MODES = {
  "hook-rename": { before: ["01-deterministic-news-seed.patch", "02-stable-test-hooks.patch"], change: "03-test-hook-rename.patch" },
  structural: { before: ["01-deterministic-news-seed.patch"], change: "negative/structural-hidden-status.patch" },
};

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

/** Targeted before/after facts about the Agents control (no pixel comparison). */
async function agentsFacts(browser, url, locatorOld, idSelector, shotBase) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.getByRole("button", { name: "Agents", exact: true }).waitFor();
    const btn = page.getByRole("button", { name: "Agents", exact: true });
    const facts = {
      oldLocatorMatches: await page.locator(locatorOld).count(),
      idMatches: idSelector ? await page.locator(idSelector).count() : null,
      roleNameMatches: await btn.count(),
      label: (await btn.textContent()).trim(),
      ariaSnapshot: await btn.ariaSnapshot(),
      html: await btn.evaluate((el) => el.outerHTML),
      box: await btn.boundingBox(),
      enabled: await btn.isEnabled(),
      pressed: await btn.getAttribute("aria-pressed"),
    };
    if (shotBase) await page.locator(".newsroom-filters").screenshot({ path: `${shotBase}-idle.png` });
    // Server-rendered buttons can be clicked before hydration attaches the
    // handler (bounded retry; fails with a hydration error rather than guessing).
    await activateControl(page, { name: "Agents" });
    const pressedControls = await page.locator(".newsroom-filters button[aria-pressed=true]").allTextContents();
    if (pressedControls.length !== 1 || pressedControls[0].trim() !== "Agents") {
      throw new HydrationError(`the Agents click pressed ${JSON.stringify(pressedControls)}, not only "Agents"`);
    }
    facts.pressedAfterClick = await btn.getAttribute("aria-pressed");
    facts.filteredTitles = await page.locator(".headline-lead h2, .headline-side h3, .news-stream h3").allTextContents();
    if (shotBase) await page.locator(".newsroom-filters").screenshot({ path: `${shotBase}-pressed.png` });
    return facts;
  } finally {
    await page.close();
  }
}

function sameControl(a, b, tol = 2) {
  const checks = {
    label: a.label === b.label,
    accessibleName: a.ariaSnapshot === b.ariaSnapshot,
    boundingBox: ["x", "y", "width", "height"].every((k) => Math.abs(a.box[k] - b.box[k]) <= tol),
    enabled: a.enabled === b.enabled,
    pressedState: a.pressed === b.pressed && a.pressedAfterClick === b.pressedAfterClick,
    filteringResult: JSON.stringify(a.filteredTitles) === JSON.stringify(b.filteredTitles),
  };
  return { checks, identical: Object.values(checks).every(Boolean) };
}

const MARKER = ".falcon-gate-workdir";

/**
 * Empty and prepare the gate's working directory. It is deleted recursively, so
 * it must be absent, empty, or a directory a previous gate run marked as its own;
 * a symlink or any other directory is refused.
 */
async function resetWorkDir(workDir) {
  let stat = null;
  try { stat = await fs.promises.lstat(workDir); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("the working directory must be a real directory");
    const entries = await fs.promises.readdir(workDir);
    if (entries.length > 0 && !entries.includes(MARKER)) throw new Error("refusing to reuse a non-empty directory that a gate run did not create");
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
  await fs.promises.mkdir(workDir, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(path.join(workDir, MARKER), "created by scripts/demo/gate-run.js; safe to delete\n");
}

async function runScenario({ mode, workDir, agencySource, agencyPort = 5173, lingerMs = 25000, capture = null }) {
  const cfg = MODES[mode];
  if (!cfg) throw new Error(`unknown mode ${mode}`);
  await resetWorkDir(workDir);
  const log = new E.OutputLog();
  const agencyDir = path.join(workDir, "agency");
  const falconDir = path.join(workDir, "falcon");
  const out = { mode, steps: {}, evidence: {} };
  const marks = [];
  const videos = [];
  const mark = (name, detail) => marks.push({ t: Date.now() - log.t0, name, ...(detail !== undefined ? { detail } : {}) });
  const step = (name, ok, detail) => {
    out.steps[name] = { ok: !!ok, ...(detail !== undefined ? { detail } : {}) };
    mark(`step:${name}`, ok ? "pass" : "fail");
    if (!ok) throw Object.assign(new Error(`gate step failed: ${name}`), { out });
  };
  if (capture) fs.mkdirSync(capture.dir, { recursive: true });

  /** Start `node falcon.js` (recording its browser when capturing). */
  const falconRun = (label, args, env = {}) => {
    const slow = label === "falcon-discover" ? 0 : DEMO_SLOWMO_MS;
    const extra = capture ? { NODE_OPTIONS: `--require ${PRELOAD}`, FALCON_DEMO_VIDEO_DIR: path.join(capture.dir, `video-${label}`), FALCON_DEMO_SLOWMO_MS: String(slow), ...env } : env;
    mark(`${label}:start`);
    const run = E.startFalcon(falconDir, args, { log, label, env: extra });
    run.exit.then(() => mark(`${label}:exit`));
    return run;
  };

  /**
   * The real dashboard of a Falcon run. When capturing, two recorded views of it:
   * the counters, and the locator-evidence panel (kept in view). Otherwise one page.
   */
  const openDashboard = async (port, label) => {
    if (!capture) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 2400 } });
      for (let i = 0; i < 150; i++) { try { await page.goto(`http://127.0.0.1:${port}/`, { timeout: 1500 }); break; } catch { await E.sleep(200); } }
      return { summary: page, locator: page, close: async () => page.close() };
    }
    const open = async (view) => {
      const dir = path.join(capture.dir, `dash-${label}-${view}`);
      const context = await browser.newContext({ viewport: VIEWS[view], recordVideo: { dir, size: VIEWS[view] } });
      const page = await context.newPage();
      const startedAt = Date.now();
      if (view === "locator") await page.addInitScript(cursorScript);
      for (let i = 0; i < 150; i++) { try { await page.goto(`http://127.0.0.1:${port}/`, { timeout: 1500 }); break; } catch { await E.sleep(200); } }
      if (view === "locator") {
        // A viewer-side convenience: keep the locator panel in view as the page grows.
        await page.evaluate(() => {
          setInterval(() => {
            const row = [...document.querySelectorAll("#locator-entries-list .locator-row")].find((r) => r.textContent.includes("news-category-agents"));
            const target = row || document.getElementById("locator-section");
            if (target) window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - 54));
          }, 250);
        });
      }
      return { context, page, view, dir, startedAt };
    };
    const [summary, locator] = [await open("summary"), await open("locator")];
    return {
      summary: summary.page,
      locator: locator.page,
      close: async () => {
        for (const v of [summary, locator]) {
          const video = v.page.video();
          await v.context.close();
          videos.push({ label: `dash-${label}-${v.view}`, startedAt: v.startedAt, file: path.relative(capture.dir, await video.path()) });
        }
      },
    };
  };

  let agency = null;
  let browser = null;
  try {
    out.agencySha = await E.prepareAgency(agencyDir, { source: agencySource, patches: cfg.before });
    await E.prepareFalconCopy(falconDir);
    mark("agency:starting");
    agency = await E.startAgency(agencyDir, { port: agencyPort, log });
    mark("agency:ready");
    out.evidence.listening = agency.listening;
    step("agency-loopback-only", agency.listening.every(E.isLoopback), agency.listening);
    browser = await chromium.launch();

    // Falcon discovers; the saved journey uses the locators Falcon captured.
    const discoveredFile = path.join(workDir, "discovered-plan.json");
    const disc = falconRun("falcon-discover", [`--url=${agency.url}`, "--single-page", "--no-dashboard", `--save-plan=${discoveredFile}`]);
    step("discovery-run", (await disc.exit) === 0);
    const discovered = readJson(discoveredFile);
    const journey = buildJourney({ scenarios: discovered.scenarios }, agency.url);
    const planFile = path.join(workDir, "journey-plan.json");
    fs.writeFileSync(planFile, JSON.stringify(journey, null, 2));
    const agentsLocator = journey.scenarios[0].locator;
    out.evidence.capturedAgentsLocator = agentsLocator;
    out.evidence.journeyPlan = journey;
    if (mode === "hook-rename") step("captured-locator-is-original-testid", agentsLocator === '[data-testid="news-category-agents"]', agentsLocator);
    else step("captured-locator-is-structural", /nth-of-type/.test(agentsLocator), agentsLocator);

    // Clean state for the recorded sequence, then the baseline.
    fs.rmSync(path.join(falconDir, "data"), { recursive: true, force: true });
    fs.rmSync(path.join(falconDir, "reports"), { recursive: true, force: true });
    const before = await agentsFacts(browser, agency.url, agentsLocator, mode === "hook-rename" ? "#news-category-agents" : null, capture && path.join(capture.dir, "control-before"));
    out.evidence.before = before;
    let baselineArgs = [`--plan=${planFile}`, "--no-dashboard"];
    let baselineEnv = {};
    if (capture) {
      baselineEnv = { DASHBOARD_PORT: String(await freePort()), DASHBOARD_LINGER_MS: "5000" };
      baselineArgs = [`--plan=${planFile}`];
    }
    const baseline = falconRun("falcon-baseline", baselineArgs, baselineEnv);
    const baseViews = capture ? await openDashboard(Number(baselineEnv.DASHBOARD_PORT), "baseline") : null;
    step("baseline-exit-0", (await baseline.exit) === 0);
    if (baseViews) await baseViews.close();
    const baseReport = readJson(path.join(falconDir, "reports", "test-report.json"));
    out.evidence.baseline = { result: baseReport.result, summary: baseReport.summary, healingEvents: baseReport.healingEvents.length };
    step("baseline-7-of-7-without-recovery", baseReport.summary.passed === 7 && baseReport.summary.total === 7 && baseReport.healingEvents.length === 0, out.evidence.baseline);

    // The controlled change.
    mark("change:stopping-agency");
    E.stopTree(agency.child);
    await E.waitPortFree(agencyPort);
    await E.applyPatch(agencyDir, cfg.change);
    out.evidence.appliedChange = cfg.change;
    agency = await E.startAgency(agencyDir, { port: agencyPort, log });
    mark("change:agency-ready");
    step("agency-loopback-only-after-change", agency.listening.every(E.isLoopback));
    const after = await agentsFacts(browser, agency.url, agentsLocator, mode === "hook-rename" ? "#news-category-agents" : null, capture && path.join(capture.dir, "control-after"));
    out.evidence.after = after;
    step("old-locator-matches-zero", after.oldLocatorMatches === 0, after.oldLocatorMatches);
    if (mode === "hook-rename") {
      step("preserved-id-matches-exactly-one", after.idMatches === 1, after.idMatches);
      const same = sameControl(before, after);
      out.evidence.sameControl = same;
      step("same-control-by-targeted-assertions", same.identical, same.checks);
    }

    // Unchanged saved plan against the changed application, with the dashboard up.
    const port = await freePort();
    const run = falconRun("falcon-recovery", [`--plan=${planFile}`], { DASHBOARD_PORT: String(port), DASHBOARD_LINGER_MS: String(capture ? 16000 : lingerMs) });
    const views = await openDashboard(port, "recovery");
    mark("recovery:dashboard-open");

    if (mode === "structural") {
      const code = await run.exit;
      await views.close();
      const rep = readJson(path.join(falconDir, "reports", "test-report.json"));
      const refusal = rep.healingEvents.find((e) => e.status === "refused");
      out.evidence.refusal = refusal || null;
      out.evidence.exitCode = code;
      out.evidence.summary = rep.summary;
      step("original-locator-failed-and-refused", code === 1 && refusal && refusal.reason === "insufficient_identity_evidence", refusal && refusal.reason);
      step("no-proposal-created", !fs.existsSync(path.join(falconDir, "data", "locator_memory.json")) || !JSON.stringify(readJson(path.join(falconDir, "data", "locator_memory.json"))).includes("pendingCandidate\":{"));
      return finish(out, log, marks, videos, capture);
    }

    const approveBtn = views.locator.locator("#locator-entries-list .btn-approve").first();
    await approveBtn.waitFor({ state: "visible", timeout: 60000 });
    mark("recovery:pending-visible");
    const healedBefore = Number(await views.summary.locator("#t-heal").innerText());
    out.evidence.healedBeforeApproval = healedBefore;
    mark("recovery:healed-counter", healedBefore);
    step("healed-count-at-least-1-before-approval", healedBefore >= 1, healedBefore);
    const memBefore = readJson(path.join(falconDir, "data", "locator_memory.json"));
    const entryBefore = Object.values(memBefore.entries || memBefore)[0];
    out.evidence.pendingProposal = entryBefore.pendingCandidate;
    step("proposal-pending-before-approval", !!(entryBefore.pendingCandidate && entryBefore.pendingCandidate.proposalId && !entryBefore.approvedAlternative));
    out.evidence.pendingPanelText = await views.locator.locator("#locator-entries-list").innerText();
    if (capture) await E.sleep(DEMO_REVIEW_PAUSE_MS); // a reviewer reads the pending proposal first
    let approved = false;
    for (let i = 0; i < 10 && !approved; i++) {
      const box = await views.locator.locator("#locator-entries-list .btn-approve").first().boundingBox().catch(() => null);
      if (box) {
        if (i === 0) mark("approval:click");
        await views.locator.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
        await views.locator.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      await views.locator.waitForTimeout(700);
      approved = /Approved for scoped reuse/.test(await views.locator.locator("#locator-entries-list").innerText());
    }
    if (approved) mark("approval:confirmed");
    step("approved-through-dashboard", approved);
    const code2 = await run.exit;
    await views.close();
    const rep2 = readJson(path.join(falconDir, "reports", "test-report.json"));
    const resolvedEvents = rep2.healingEvents.filter((e) => e.resolved);
    out.evidence.recovery = { exitCode: code2, result: rep2.result, summary: rep2.summary, events: rep2.healingEvents };
    step("journey-passes-after-recovery", code2 === 0 && rep2.summary.passed === 7 && rep2.summary.total === 7, rep2.summary);
    step("report-contains-recovery", resolvedEvents.length >= 1 && resolvedEvents[0].original === agentsLocator, resolvedEvents[0]);
    out.evidence.resolvedLocator = resolvedEvents[0].resolved;
    const memAfter = readJson(path.join(falconDir, "data", "locator_memory.json"));
    const entryAfter = Object.values(memAfter.entries || memAfter)[0];
    out.evidence.approvedAlternative = entryAfter.approvedAlternative;
    step("approval-persisted", !!entryAfter.approvedAlternative && !entryAfter.pendingCandidate);

    // A fresh process reuses it.
    let reuseArgs = [`--plan=${planFile}`, "--no-dashboard"];
    let reuseEnv = {};
    if (capture) {
      reuseEnv = { DASHBOARD_PORT: String(await freePort()), DASHBOARD_LINGER_MS: "6000" };
      reuseArgs = [`--plan=${planFile}`];
    }
    const reuse = falconRun("falcon-reuse", reuseArgs, reuseEnv);
    const reuseViews = capture ? await openDashboard(Number(reuseEnv.DASHBOARD_PORT), "reuse") : null;
    const code3 = await reuse.exit;
    if (reuseViews) await reuseViews.close();
    const rep3 = readJson(path.join(falconDir, "reports", "test-report.json"));
    out.evidence.reuse = { exitCode: code3, result: rep3.result, summary: rep3.summary, events: rep3.healingEvents };
    step("reuse-run-passes", code3 === 0 && rep3.summary.passed === 7, rep3.summary);
    step("approved-reuse-without-new-candidate-search", rep3.healingEvents.some((e) => e.status === "approved_reuse") && !rep3.healingEvents.some((e) => e.status === "refused" || e.status === "pending"), rep3.healingEvents.map((e) => e.status || e.tier));
    return finish(out, log, marks, videos, capture);
  } catch (e) {
    e.out = out;
    e.log = log;
    throw e;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await E.stopAll();
    await E.waitPortFree(agencyPort).catch(() => {});
  }
}

function finish(out, log, marks, videos, capture) {
  out.ok = Object.values(out.steps).every((s) => s.ok);
  out.log = log.lines;
  if (capture) out.capture = { t0: log.t0, marks, videos, commands: log.commands };
  return out;
}

module.exports = { runScenario, resetWorkDir, MARKER, sameControl, MODES, PHRASE };
