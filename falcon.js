/**
 * falcon.js — Falcon-Automation main entry point.
 *
 * Phase 1 patch (runtime fixes):
 *
 * 1. const → let for uiIssues
 *    The original code declared `const uiIssues` then immediately tried to
 *    reassign it (`uiIssues = []`) in the guard branch, producing a
 *    TypeError ("Assignment to constant variable") at runtime.
 *
 * 2. TestRunner constructor arity
 *    TestRunner now takes (page, testPlan) — two arguments.  The old call
 *    passed three positional arguments (page, uiIssues, visitedPages), so
 *    `uiIssues` landed in the `testPlan` slot and `visitedPages` was
 *    silently dropped.
 *
 * 3. executeExploratoryTest() arguments
 *    The method signature is executeExploratoryTest({ uiIssues, exploredPages }).
 *    The original call passed no arguments at all, so both arrays defaulted to
 *    [] and nothing was written to the report.
 *
 * 4. headless hardcoded to false
 *    falcon.js opened its own chromium instance with headless: false, ignoring
 *    the HEADLESS env var.  CI runs would therefore always launch a visible
 *    browser, break in headless environments, and fail the pipeline.
 *
 * 5. --url= argument is now optional
 *    When omitted, falcon.js defaults to https://www.saucedemo.com so the
 *    framework can be exercised with a plain `node falcon.js`.
 */

require("dotenv").config();
const { chromium } = require("playwright");
const ExploratoryAI = require("./src/core/ExploratoryAI");
const ClickExplorer = require("./src/core/ClickExplorer");
const TestRunner    = require("./src/core/TestRunner");
const Logger        = require("./utils/Logger");

const DEFAULT_URL = "https://www.saucedemo.com";

(async () => {
    const args    = process.argv.slice(2);
    const urlArg  = args.find((a) => a.startsWith("--url="));
    const rawUrl  = urlArg ? urlArg.split("=")[1] : DEFAULT_URL;
    const url     = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

    if (!urlArg) {
        Logger.info(`ℹ️  No --url supplied — defaulting to ${DEFAULT_URL}`);
    }

    // Respect the HEADLESS env var (default: true).
    // Set HEADLESS=false in .env to watch the browser during local debugging.
    const headless = process.env.HEADLESS !== "false";

    const browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page    = await context.newPage();

    Logger.info(`🌍 Navigating to ${url}...`);

    try {
        await page.goto(url, { waitUntil: "load" });
        Logger.info(`✅ Loaded website: ${url}`);

        // ── Step 1: Detect UI Issues ──────────────────────────────────────
        const exploratoryAI = new ExploratoryAI(page);
        // Use let so we can reassign the guard branch if detectUIIssues
        // returns something unexpected (null / undefined).
        let uiIssues = await exploratoryAI.detectUIIssues();
        if (!Array.isArray(uiIssues)) {
            Logger.warning("⚠️  detectUIIssues() did not return an array — defaulting to []");
            uiIssues = [];
        }

        // ── Step 2: Explore Click Paths ───────────────────────────────────
        const clickExplorer = new ClickExplorer(page);
        await clickExplorer.explore();
        let visitedPages = clickExplorer.visitedPages;
        if (!(visitedPages instanceof Set)) {
            Logger.warning("⚠️  clickExplorer.visitedPages is not a Set — defaulting to empty Set");
            visitedPages = new Set();
        }

        // ── Step 3: Summarise and persist exploratory results ─────────────
        // TestRunner(page, testPlan) — testPlan is optional for exploratory runs.
        const runner = new TestRunner(page, {});
        await runner.executeExploratoryTest({
            uiIssues,
            exploredPages: Array.from(visitedPages),
        });
    } catch (error) {
        Logger.error(`❌ Error: ${error.message}`);
        console.error(error);
    } finally {
        await Logger.flush();
        await browser.close();
    }
})();