const fs = require("fs");
const path = require("path");
const Logger = require("../../utils/Logger");
const AIHealer = require("./AIHealer/AIHealer");
const HealingReport = require("./AIHealer/HealingReport");

/**
 * TestRunner — orchestrates scenario-based and exploratory test execution.
 *
 * Phase 1 fixes:
 * 1. Added missing `fs` and `path` imports (logResults() used both without
 *    importing them, causing a ReferenceError at runtime).
 * 2. Fixed require paths: TestRunner is in src/core/, so relative paths to
 *    AIHealer and HealingReport no longer need the extra "../core/" segment.
 * 3. executeExploratoryTest() referenced `this.uiIssues` and
 *    `this.exploredPages` which were never initialised on the instance,
 *    producing "Cannot read properties of undefined" at runtime.
 *    The method now accepts these values as arguments, matching the call
 *    signature used in falcon.js.
 */
class TestRunner {
    constructor(page, testPlan) {
        this.page = page;
        this.healer = new AIHealer(page);
        this.testPlan = testPlan || { url: "", test_scenarios: [] };
        this.results = [];
    }

    /**
     * Execute a structured test plan with per-scenario retry and AI healing.
     */
    async executeTest() {
        Logger.info(`🛠 Running adaptive AI-healing tests for: ${this.testPlan.url}`);

        for (const scenario of this.testPlan.test_scenarios) {
            const isVisible = await this.isElementVisible(scenario.locator);

            if (!isVisible) {
                Logger.warning(`⏭ Skipping ${scenario.description}: Element is not visible.`);
                this.results.push({
                    name: scenario.description,
                    status: "skipped",
                    reason: "Element not visible",
                });
                continue;
            }

            await this.runScenario(scenario);
        }

        return this.results;
    }

    async isElementVisible(selector) {
        try {
            return await this.page.evaluate((sel) => {
                const el = document.querySelector(sel);
                return el !== null && el.offsetParent !== null;
            }, selector);
        } catch {
            return false;
        }
    }

    async runScenario(scenario) {
        const startTime = Date.now();

        if (scenario.action !== "click" && scenario.action !== "type" && scenario.action !== "select") {
            Logger.warning(`⚠️ Unknown action "${scenario.action}" for ${scenario.description} — skipping.`);
            this.results.push({
                name: scenario.description,
                status: "skipped",
                reason: `Unknown action "${scenario.action}"`,
            });
            return;
        }

        // "click" already goes through AIHealer.healAndClick(), which has its
        // own AdaptiveRetry + Tier 2/3 healing chain internally — wrapping it
        // in another 3-attempt loop here used to re-trigger the whole chain
        // (including live OpenAI calls) up to 3x per scenario. Give it one
        // attempt at this level; "type"/"select" have no internal retry, so
        // they keep the raw 3-attempt loop.
        const maxAttempts = scenario.action === "click" ? 1 : 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                Logger.info(`▶ Executing [${attempt}/${maxAttempts}]: ${scenario.description} (${scenario.action})`);

                if (scenario.action === "click") {
                    await this.healer.healAndClick(scenario.locator, scenario.description);
                } else if (scenario.action === "type") {
                    await this.page.fill(scenario.locator, scenario.value);
                } else if (scenario.action === "select") {
                    await this.page.selectOption(scenario.locator, scenario.value);
                }

                const duration = Date.now() - startTime;
                Logger.info(`✅ Passed: ${scenario.description} (${duration}ms)`);
                this.results.push({ name: scenario.description, status: "passed", duration });
                return;
            } catch (error) {
                Logger.warning(`⚠️ Attempt ${attempt} failed for ${scenario.description}: ${error.message}`);

                if (attempt === maxAttempts) {
                    Logger.error(`❌ Test Failed: ${scenario.description}`);
                    HealingReport.log({
                        original: scenario.locator,
                        resolved: null,
                        tier: "exhausted",
                        description: scenario.description,
                        error: error.message,
                    });
                    const duration = Date.now() - startTime;
                    this.results.push({
                        name: scenario.description,
                        status: "failed",
                        duration,
                        error: error.message,
                    });
                }
            }
        }
    }

    /**
     * Execute an exploratory run and persist a JSON summary.
     * Called from falcon.js after ExploratoryAI and ClickExplorer have run.
     *
     * @param {Object} opts
     * @param {Array}  opts.uiIssues      - Issues found by ExploratoryAI
     * @param {Array}  opts.exploredPages - Pages visited by ClickExplorer
     */
    async executeExploratoryTest({ uiIssues = [], exploredPages = [] } = {}) {
        Logger.info("🛠 Running AI-powered exploratory test summary...");
        this.logResults({ uiIssues, exploredPages });
    }

    /**
     * Write exploratory results to disk.
     * Uses fs and path — both imported at the top of this file.
     *
     * @param {Object} opts
     * @param {Array}  opts.uiIssues
     * @param {Array}  opts.exploredPages
     */
    logResults({ uiIssues = [], exploredPages = [] } = {}) {
        Logger.info("📊 Exploratory Test Summary:");
        Logger.info(`❗ UI Issues Found:  ${uiIssues.length}`);
        Logger.info(`🌍 Pages Explored:  ${exploredPages.length}`);

        const reportsDir = path.join(__dirname, "..", "..", "reports");
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const reportPath = path.join(reportsDir, "exploratory_test_results.json");
        fs.writeFileSync(
            reportPath,
            JSON.stringify(
                {
                    timestamp: new Date().toISOString(),
                    summary: {
                        uiIssuesCount: uiIssues.length,
                        pagesExploredCount: exploredPages.length,
                    },
                    uiIssues,
                    exploredPages,
                },
                null,
                2
            )
        );

        Logger.info(`📜 Report saved to: ${reportPath}`);
    }
}

module.exports = TestRunner;
