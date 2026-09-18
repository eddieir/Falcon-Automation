/**
 * multi-page-axonradar-dashboard-demo.js — same real pipeline as
 * multi-page-axonradar-demo.js (ExploratoryAI -> TestGenerator ->
 * TestRunner, self-healing included) run against every real page of
 * https://axonradar.netlify.app, but this version streams every event to
 * the live Dashboard so the on-screen counters reflect the real,
 * aggregated totals across all 11 pages instead of just one.
 *
 * Run from the project root: node docs/demo/multi-page-axonradar-dashboard-demo.js
 */
const { chromium } = require("playwright");
const path = require("path");
const ExploratoryAI = require(path.join("..", "..", "src/core/ExploratoryAI"));
const TestGenerator = require(path.join("..", "..", "src/core/TestGenerator"));
const TestRunner    = require(path.join("..", "..", "src/core/TestRunner"));
const Dashboard      = require(path.join("..", "..", "src/core/Dashboard"));

const BASE_URL = "https://axonradar.netlify.app";
const PAGES = [
    "/", "/news", "/models", "/benchmarks", "/playground",
    "/evaluations", "/router", "/operations", "/developers", "/creators", "/compare",
];

(async () => {
    const dashboard = new Dashboard({ port: Number(process.env.DASHBOARD_PORT) || 3000 });
    await dashboard.start();

    const browser = await chromium.launch();
    const context = await browser.newContext();

    for (const route of PAGES) {
        const url = BASE_URL + route;
        const page = await context.newPage();
        try {
            await page.goto(url, { waitUntil: "load", timeout: 20000 });
            dashboard.emit("explorerPage", { url });

            const exploratoryAI = new ExploratoryAI(page);
            await exploratoryAI.detectUIIssues().catch(() => []);

            const generator = new TestGenerator(page);
            const testPlan = await generator.generateTestScenarios();

            const runner = new TestRunner(page, testPlan);
            const results = await runner.executeTest();

            for (const r of results) {
                if (r.status === "passed") dashboard.emit("testPass", { name: `[${route}] ${r.name}`, duration: r.duration });
                else if (r.status === "failed") dashboard.emit("testFail", { name: `[${route}] ${r.name}`, error: r.error });
                else if (r.status === "skipped") dashboard.emit("testSkip", { name: `[${route}] ${r.name}`, reason: r.reason });
            }

            console.log(`✅ ${route.padEnd(14)} scenarios=${results.length}`);
        } catch (error) {
            console.log(`⚠️  ${route.padEnd(14)} skipped page-level error: ${error.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    console.log("\n✅ Full 11-page sweep complete — dashboard reflects the real aggregate totals.");
    console.log(`🖥  Dashboard staying up at ${dashboard.url} for screenshotting — Ctrl-C to exit.`);

    // Stay up so a capture script can screenshot the final aggregate state.
    await new Promise(() => {});
})();
