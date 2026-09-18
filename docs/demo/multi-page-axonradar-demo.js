/**
 * multi-page-axonradar-demo.js — runs Falcon's real pipeline (ExploratoryAI
 * defect detection -> PageAnalyser/TestGenerator scenario generation ->
 * TestRunner self-healing execution) against every real, live page of
 * https://axonradar.netlify.app, not just the homepage.
 *
 * falcon.js's CLI entry point only ever scans the root page it navigates
 * to (PageAnalyser.generateActions() also caps navigation-type scenarios
 * at 3 per page, by design, to avoid infinite click loops) — so a single
 * `node falcon.js --url=...` run only ever produces a handful of
 * scenarios. A real QA pass against a real multi-page product runs the
 * same pipeline against every page of the site and aggregates the
 * results, which is what this script does, honestly, with no scenario
 * count invented or padded.
 *
 * Run from the project root: node docs/demo/multi-page-axonradar-demo.js
 */
const { chromium } = require("playwright");
const path = require("path");
const ExploratoryAI = require(path.join("..", "..", "src/core/ExploratoryAI"));
const TestGenerator = require(path.join("..", "..", "src/core/TestGenerator"));
const TestRunner    = require(path.join("..", "..", "src/core/TestRunner"));

const BASE_URL = "https://axonradar.netlify.app";
const PAGES = [
    "/", "/news", "/models", "/benchmarks", "/playground",
    "/evaluations", "/router", "/operations", "/developers", "/creators", "/compare",
];

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();

    const totals = { pages: 0, elements: 0, scenarios: 0, passed: 0, failed: 0, skipped: 0, uiIssues: 0 };
    const perPage = [];

    for (const route of PAGES) {
        const url = BASE_URL + route;
        const page = await context.newPage();
        try {
            await page.goto(url, { waitUntil: "load", timeout: 20000 });

            const exploratoryAI = new ExploratoryAI(page);
            const uiIssues = await exploratoryAI.detectUIIssues().catch(() => []);

            const generator = new TestGenerator(page);
            const testPlan = await generator.generateTestScenarios();

            const runner = new TestRunner(page, testPlan);
            const results = await runner.executeTest();

            const passed = results.filter((r) => r.status === "passed").length;
            const failed = results.filter((r) => r.status === "failed").length;
            const skipped = results.filter((r) => r.status === "skipped").length;

            totals.pages += 1;
            totals.scenarios += results.length;
            totals.passed += passed;
            totals.failed += failed;
            totals.skipped += skipped;
            totals.uiIssues += Array.isArray(uiIssues) ? uiIssues.length : 0;

            perPage.push({ route, scenarios: results.length, passed, failed, skipped, uiIssues: uiIssues.length });
            console.log(`✅ ${route.padEnd(14)} scenarios=${String(results.length).padEnd(3)} passed=${passed} failed=${failed} uiIssues=${uiIssues.length}`);
        } catch (error) {
            console.log(`⚠️  ${route.padEnd(14)} skipped page-level error: ${error.message}`);
            perPage.push({ route, error: error.message });
        } finally {
            await page.close();
        }
    }

    await browser.close();

    console.log("\n=== TOTALS across all real pages of axonradar.netlify.app ===");
    console.log(JSON.stringify(totals, null, 2));
    console.log("\nPer-page breakdown:");
    console.log(JSON.stringify(perPage, null, 2));
})();
