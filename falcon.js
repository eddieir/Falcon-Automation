/**
 * falcon.js — Falcon-Automation main entry point.
 *
 * Phase 10 — whole-app coverage:
 *   - A run now covers the whole application, not just its entry page.
 *     SiteSweep discovers the frontier with ClickExplorer and then, for
 *     every page it keeps, runs ExploratoryAI + TestGenerator + TestRunner
 *     on that page. Until Phase 10 this file threw the crawler's results
 *     away: it logged the page count, re-navigated to the root URL and
 *     generated scenarios for that one page. The header comment below
 *     claimed per-page generation for seven phases while the code did no
 *     such thing — that claim is now true rather than aspirational.
 *   - Pages Falcon deliberately did not test (over --max-pages, past the
 *     budget, cross-origin, unreachable) are reported with a reason instead
 *     of vanishing. "What we didn't cover" is half of a coverage claim.
 *   - New flags: --max-pages=N, --budget-ms=N, --no-dedupe,
 *     --allow-cross-origin, and --single-page, which restores the
 *     pre-Phase-10 one-page pipeline verbatim for anyone depending on it.
 *
 * Phase 3 additions (retained):
 *   - Real-time live dashboard (http://localhost:3000) — express + socket.io
 *     were already installed; now wired into every execution pipeline.
 *   - Dashboard events emitted for every test lifecycle moment so the live
 *     UI reflects the run in real time without polling.
 *   - --no-dashboard flag disables the server for headless CI environments
 *     that don't need a browser window.
 *
 * Phase 1/2 fixes (retained):
 *   const → let for uiIssues, TestRunner arity, executeExploratoryTest args,
 *   headless env var respected, --url= optional (defaults to saucedemo).
 */

require("dotenv").config();
const { chromium }    = require("playwright");
const ExploratoryAI   = require("./src/core/ExploratoryAI");
const ClickExplorer   = require("./src/core/ClickExplorer");
const TestRunner      = require("./src/core/TestRunner");
const TestGenerator   = require("./src/core/TestGenerator");
const SiteSweep       = require("./src/core/SiteSweep");
const Dashboard       = require("./src/core/Dashboard");
const Logger          = require("./utils/Logger");
const ReportManager   = require("./src/core/ReportManager");
const HealingReport   = require("./src/core/AIHealer/HealingReport");

const DEFAULT_URL = "https://www.saucedemo.com";

/**
 * Read a `--flag=<number>` argument.
 *
 * A typo'd or negative bound is treated as "not supplied" rather than as an
 * instruction: `--max-pages=abc` silently becoming NaN would disable the cap
 * altogether, which is the opposite of what someone passing a cap wants.
 */
const numericArg = (args, name, fallback) => {
    const prefix = `--${name}=`;
    const raw = args.find((a) => a.startsWith(prefix));
    if (!raw) return fallback;
    const value = Number(raw.slice(prefix.length));
    if (!Number.isFinite(value) || value <= 0) {
        Logger.warning(`⚠️  Ignoring ${raw} — expected a positive number; using ${fallback}.`);
        return fallback;
    }
    return value;
};

/** Count a page's scenario outcomes, "deduped" included. */
const tally = (results) => results.reduce((counts, r) => {
    counts[r.status] = (counts[r.status] || 0) + 1;
    return counts;
}, {});

/**
 * Per-page row for the report.
 *
 * The scenario objects themselves already appear once in the report's flat
 * `tests` array; repeating them under every page would roughly double the
 * size of every report to say nothing new, so a page carries its tally and
 * its counts instead.
 */
const pageBreakdown = (p) => ({
    url: p.url,
    status: p.status,
    ...(p.reason ? { reason: p.reason } : {}),
    scenariosGenerated: p.scenariosGenerated || 0,
    scenariosDeduplicated: p.scenariosDeduplicated || 0,
    durationMs: p.durationMs || 0,
    uiIssues: p.uiIssues.length,
    summary: tally(p.results),
});

/** Coverage totals derived from a page list, for callers that don't build their own. */
const deriveCoverage = (pages) => ({
    pagesDiscovered: pages.length,
    pagesTested: pages.filter((p) => p.status === "tested").length,
    pagesSkipped: pages.filter((p) => p.status === "skipped").length,
    pagesUnreachable: pages.filter((p) => p.status === "unreachable").length,
    scenariosGenerated: pages.reduce((n, p) => n + (p.scenariosGenerated || 0), 0),
    scenariosDeduplicated: pages.reduce((n, p) => n + (p.scenariosDeduplicated || 0), 0),
    budgetExhausted: false,
});

/**
 * Coerce whatever SiteSweep returned into the documented SweepResult shape.
 *
 * Everything downstream — the tally, the exit code, the coverage line —
 * indexes into this structure, and a missing array here would turn a
 * reporting gap into a crash that loses the whole run's results. This file
 * has guarded ClickExplorer's return value the same way since Phase 2.
 */
const normalizeSweep = (result, entryUrl) => {
    const raw = result && typeof result === "object" ? result : {};
    if (!Array.isArray(raw.pages)) {
        Logger.warning("⚠️  SiteSweep returned no page list — reporting the run as covering nothing.");
    }
    const pages = (Array.isArray(raw.pages) ? raw.pages : [])
        .filter((p) => p && typeof p === "object")
        .map((p) => ({
            ...p,
            results:  Array.isArray(p.results)  ? p.results  : [],
            uiIssues: Array.isArray(p.uiIssues) ? p.uiIssues : [],
        }));
    return {
        entryUrl: raw.entryUrl || entryUrl,
        pages,
        coverage: raw.coverage && typeof raw.coverage === "object"
            ? raw.coverage
            : deriveCoverage(pages),
    };
};

/** Phase 10 default: sweep the whole application from the entry URL. */
const runWholeApp = async (context, entryUrl, emit, opts) => {
    Logger.info(
        `🧭 Sweeping ${entryUrl} — up to ${opts.maxPages} page(s), ` +
        `${(opts.budgetMs / 1000).toFixed(0)} s budget, dedupe ${opts.dedupe ? "on" : "off"}, ` +
        `${opts.sameOriginOnly ? "same-origin only" : "cross-origin allowed"}…`
    );

    // pageStart/pageComplete stream straight through to the dashboard's
    // coverage panel; per-scenario events are emitted by the caller once the
    // sweep's results have been flattened.
    const sweep = new SiteSweep(context, { ...opts, onEvent: emit });
    const result = normalizeSweep(await sweep.run(entryUrl), entryUrl);

    for (const p of result.pages) emit("explorerPage", { url: p.url });
    return result;
};

/**
 * --single-page: the pre-Phase-10 pipeline, unchanged.
 *
 * Kept verbatim — same steps, same order, same log lines, same discarded
 * crawl — because the flag exists precisely for anyone whose scripts or
 * expectations are pinned to that behaviour. Its one page is returned in
 * SweepResult shape so the reporting path below stays common to both modes.
 */
const runEntryPageOnly = async (context, url, emit) => {
    Logger.warning("⚠️  --single-page: only the entry page will be tested (pre-Phase-10 behaviour).");
    const startedAt = Date.now();

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    Logger.info(`✅ Loaded: ${url}`);
    emit("explorerPage", { url });

    // ── Step 1: Detect UI Issues ─────────────────────────────────────────────
    Logger.info("🔍 Step 1: Detecting UI issues with ExploratoryAI…");
    const exploratoryAI = new ExploratoryAI(page);
    let uiIssues = await exploratoryAI.detectUIIssues();
    if (!Array.isArray(uiIssues)) {
        Logger.warning("⚠️  detectUIIssues() did not return an array — defaulting to []");
        uiIssues = [];
    }
    Logger.info(`  → ${uiIssues.length} issue(s) found`);

    // ── Step 2: Explore Click Paths ──────────────────────────────────────────
    Logger.info("🔍 Step 2: Mapping site with ClickExplorer…");
    const clickExplorer = new ClickExplorer(page);
    await clickExplorer.explore();
    let visitedPages = clickExplorer.visitedPages;
    if (!(visitedPages instanceof Set)) {
        Logger.warning("⚠️  visitedPages is not a Set — defaulting to empty Set");
        visitedPages = new Set();
    }

    Array.from(visitedPages).forEach((u) => emit("explorerPage", { url: u }));
    Logger.info(`  → ${visitedPages.size} page(s) explored`);

    // ── Step 3: AI Test Generation ───────────────────────────────────────────
    Logger.info("🤖 Step 3: Generating test scenarios from DOM analysis…");

    // Re-navigate to the root to generate scenarios from the main page
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});

    const generator = new TestGenerator(page);
    const testPlan  = await generator.generateTestScenarios();
    Logger.info(`  → ${testPlan.test_scenarios.length} scenario(s) generated for ${testPlan.url}`);

    // ── Step 4: Execute Generated Test Plan ──────────────────────────────────
    Logger.info("▶  Step 4: Executing AI-generated test scenarios…");
    const runner  = new TestRunner(page, testPlan);
    const results = await runner.executeTest();

    const only = {
        url,
        status: "tested",
        scenariosGenerated: testPlan.test_scenarios.length,
        scenariosDeduplicated: 0,
        results,
        uiIssues,
        durationMs: Date.now() - startedAt,
    };
    // The crawl's own page list is reported as discovered-but-skipped rather
    // than dropped: --single-page is a deliberate narrowing, and the report
    // should say what that narrowing cost.
    const skipped = Array.from(visitedPages)
        .filter((u) => u !== url)
        .map((u) => ({
            url: u,
            status: "skipped",
            reason: "single-page",
            scenariosGenerated: 0,
            scenariosDeduplicated: 0,
            results: [],
            uiIssues: [],
            durationMs: 0,
        }));

    const pages = [only, ...skipped];
    return { entryUrl: url, pages, coverage: deriveCoverage(pages) };
};

(async () => {
    const args        = process.argv.slice(2);
    const urlArg      = args.find((a) => a.startsWith("--url="));
    const rawUrl      = urlArg ? urlArg.slice("--url=".length) : DEFAULT_URL;
    const url         = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    // Default off in CI (process.env.CI is the conventional signal nearly
    // every CI system sets) so a headless run never blocks on a dashboard
    // server nobody can see; --dashboard forces it back on if ever needed.
    const noDashboard = args.includes("--no-dashboard")
        || (process.env.CI === "true" && !args.includes("--dashboard"));

    // Sweep bounds. The defaults match SiteSweep's own so that passing
    // nothing and passing the documented default produce the same run.
    const singlePage       = args.includes("--single-page");
    const maxPages         = numericArg(args, "max-pages", 20);
    const budgetMs         = numericArg(args, "budget-ms", 600_000);
    const dedupe           = !args.includes("--no-dedupe");
    const sameOriginOnly   = !args.includes("--allow-cross-origin");

    if (!urlArg) {
        Logger.info(`ℹ️  No --url supplied — defaulting to ${DEFAULT_URL}`);
    }

    const headless = process.env.HEADLESS !== "false";

    // ── Dashboard ─────────────────────────────────────────────────────────────
    const dashboard = new Dashboard({ port: Number(process.env.DASHBOARD_PORT) || 3000 });
    let dashboardUp = false;
    if (!noDashboard) {
        try {
            await dashboard.start(); // prints http://localhost:3000
            dashboardUp = true;
        } catch (error) {
            Logger.warning(`⚠️  Dashboard failed to start (${error.message}) — continuing without it.`);
        }
    }

    const emit = (name, payload) => {
        if (dashboardUp) dashboard.emit(name, payload);
    };

    // ── Browser ───────────────────────────────────────────────────────────────
    let browser;
    const reportManager = new ReportManager();
    reportManager.startRun();

    Logger.info(`🌍 Navigating to ${url}…`);

    try {
        browser = await chromium.launch({ headless });
        const context = await browser.newContext();

        const sweep = singlePage
            ? await runEntryPageOnly(context, url, emit)
            : await runWholeApp(context, url, emit, {
                maxPages,
                budgetMs,
                dedupe,
                sameOriginOnly,
            });

        // One flat array for ReportManager: the tally, the pass/fail branch
        // and the exit code are properties of the run, not of any one page.
        // The per-page breakdown rides alongside in `pages`.
        const results  = sweep.pages.flatMap((p) => p.results);
        const uiIssues = sweep.pages.flatMap((p) => p.uiIssues);

        // Emit each result to the dashboard. "deduped" is deliberately not
        // emitted: it is a bookkeeping entry for a scenario that was never
        // executed on this page, so surfacing it as a test lifecycle event
        // would inflate the live counters with work that did not happen.
        for (const r of results) {
            if (r.status === "passed") {
                emit("testPass", { name: r.name, duration: r.duration });
            } else if (r.status === "failed") {
                emit("testFail", { name: r.name, error: r.error });
            } else if (r.status === "skipped") {
                emit("testSkip", { name: r.name, reason: r.reason });
            } else if (r.status === "quarantined") {
                emit("testQuarantined", { name: r.name, error: r.error });
            }
        }

        // The numbered step banners only describe the single-page pipeline;
        // a sweep has no fixed step count, so it gets an unnumbered line
        // rather than a stale "Step 5".
        Logger.info(singlePage
            ? "📊 Step 5: Writing exploratory report…"
            : "📊 Writing exploratory report…");
        // executeExploratoryTest() only formats and writes the summary — it
        // never touches this.page — and SiteSweep has already closed the
        // pages it opened, so there is no live page to hand it here.
        await new TestRunner(null, null).executeExploratoryTest({
            uiIssues,
            exploredPages: sweep.pages.map((p) => p.url),
        });

        reportManager.generateReport({
            tests: results,
            uiIssues,
            healingEvents: HealingReport._instance.logs,
            coverage: sweep.coverage,
            pages: sweep.pages.map(pageBreakdown),
        });
    } catch (error) {
        reportManager.generateReport({ tests: [{ name: "falcon.js", status: "failed", error: error.message }] });
        Logger.error(`❌ Fatal error: ${error.message}`);
        console.error(error);
        emit("testFail", { name: "falcon.js", error: error.message });
    } finally {
        await Logger.flush();
        if (browser) await browser.close();

        if (dashboardUp) {
            const lingerMs = Number(process.env.DASHBOARD_LINGER_MS) || 60_000;
            Logger.info(`🖥  Dashboard will stay up for ${(lingerMs / 1000).toFixed(0)} s — open ${dashboard.url} to review results.`);
            Logger.info("    Press Ctrl-C to exit early.");
            await new Promise((r) => setTimeout(r, lingerMs));
            await dashboard.stop();
        }
    }
})();
