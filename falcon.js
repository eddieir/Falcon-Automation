/**
 * falcon.js — Falcon-Automation main entry point.
 *
 * Phase 3 additions:
 *   - Real-time live dashboard (http://localhost:3000) — express + socket.io
 *     were already installed; now wired into every execution pipeline.
 *   - AI test generation pipeline: after ClickExplorer maps the site,
 *     PageAnalyser + TestGenerator produce a scenario plan for each visited
 *     page and TestRunner executes them with full self-healing.
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
const Dashboard       = require("./src/core/Dashboard");
const Logger          = require("./utils/Logger");
const ReportManager   = require("./src/core/ReportManager");
const HealingReport   = require("./src/core/AIHealer/HealingReport");

const DEFAULT_URL = "https://www.saucedemo.com";

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
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "load" });
        Logger.info(`✅ Loaded: ${url}`);
        emit("explorerPage", { url });

        // ── Step 1: Detect UI Issues ─────────────────────────────────────────
        Logger.info("🔍 Step 1: Detecting UI issues with ExploratoryAI…");
        const exploratoryAI = new ExploratoryAI(page);
        let uiIssues = await exploratoryAI.detectUIIssues();
        if (!Array.isArray(uiIssues)) {
            Logger.warning("⚠️  detectUIIssues() did not return an array — defaulting to []");
            uiIssues = [];
        }
        Logger.info(`  → ${uiIssues.length} issue(s) found`);

        // ── Step 2: Explore Click Paths ──────────────────────────────────────
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

        // ── Step 3: AI Test Generation ───────────────────────────────────────
        Logger.info("🤖 Step 3: Generating test scenarios from DOM analysis…");

        // Re-navigate to the root to generate scenarios from the main page
        await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});

        const generator = new TestGenerator(page);
        const testPlan  = await generator.generateTestScenarios();
        Logger.info(`  → ${testPlan.test_scenarios.length} scenario(s) generated for ${testPlan.url}`);

        // ── Step 4: Execute Generated Test Plan ──────────────────────────────
        Logger.info("▶  Step 4: Executing AI-generated test scenarios…");
        const runner  = new TestRunner(page, testPlan);
        const results = await runner.executeTest();

        // Emit each result to the dashboard
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

        // ── Step 5: Write Exploratory Report ─────────────────────────────────
        Logger.info("📊 Step 5: Writing exploratory report…");
        await runner.executeExploratoryTest({
            uiIssues,
            exploredPages: Array.from(visitedPages),
        });

        reportManager.generateReport({ tests: results, uiIssues, healingEvents: HealingReport._instance.logs });
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
