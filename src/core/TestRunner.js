const fs = require("fs");
const path = require("path");
const Logger = require("../../utils/Logger");
const AIHealer = require("./AIHealer/AIHealer");
const HealingReport = require("./AIHealer/HealingReport");
const AdaptiveRetry = require("./AIHealer/AdaptiveRetry");
const FlakinessTracker = require("./FlakinessTracker");

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
 *
 * Phase 9 — flaky-test detection. Every passed/failed scenario outcome is
 * fed to FlakinessTracker, keyed by page URL + action + locator (stable
 * across regenerated descriptions). If a scenario is currently quarantined
 * (an explicit human decision — see FlakinessTracker), a failure is
 * reported as "quarantined" rather than "failed": still visible, still
 * recorded, just no longer blocking the run. Nothing is ever silently
 * hidden or auto-quarantined.
 *
 * Phase 11 — healing for every action, and no silent green.
 * 1. `type` and `select` used to bypass AIHealer entirely — a bare
 *    page.fill()/page.selectOption() in a raw 3-attempt loop, with no Tier
 *    2/3 chain at all. They now go through AIHealer.healAndType()/
 *    healAndSelect(), the same three-tier chain `click` already had, so a
 *    renamed input heals exactly as a renamed button does.
 * 2. A non-click scenario whose target wasn't visible used to be marked
 *    `skipped` before ever reaching the healer — silently discarding
 *    coverage. Every supported action now reaches the healing chain
 *    unconditionally; `skipped` is reserved for a genuinely unknown action
 *    type.
 * 3. Once a scenario navigates the page (e.g. a nav-link click), every
 *    later scenario in the same plan used to keep running against whatever
 *    page that left the browser on. executeTest() now returns to
 *    `testPlan.url` between scenarios whenever the page actually drifted.
 */
class TestRunner {
    constructor(page, testPlan, options = {}) {
        this.page = page;
        this.healer = new AIHealer(page, { ...options.healerOptions, providerContext: options.providerContext });
        this.testPlan = testPlan || { url: "", test_scenarios: [] };
        this.results = [];
    }

    /**
     * Execute a structured test plan with per-scenario retry and AI healing.
     */
    async executeTest() {
        Logger.info(`🛠 Running adaptive AI-healing tests for: ${this.testPlan.url}`);

        for (const scenario of this.testPlan.test_scenarios) {
            // Phase 11: a target that isn't visible no longer short-circuits
            // to "skipped" here — every supported action (click/type/select)
            // must reach AIHealer's own Tier 1/2/3 chain, which is exactly
            // what discovers and repairs a renamed or moved element. Only a
            // genuinely unsupported action is skipped, and that decision is
            // made inside runScenario() itself.
            await this.runScenario(scenario);

            // Journey plans (--plan with "journey": true) are ordered steps of
            // one user flow: later steps depend on the state earlier steps
            // left behind, so the page is not reset between steps, the first
            // step that does not pass ends the journey, and a step that
            // carried the browser to another origin is never followed.
            if (this.testPlan.journey) {
                const last = this.results[this.results.length - 1];
                if (!last || last.status !== "passed") {
                    this._skipRemaining(scenario, "an earlier step did not pass");
                    break;
                }
                if (this._leftPlanOrigin()) {
                    this.results.push({
                        name: "Stay on the application under test",
                        status: "failed",
                        error: "The journey navigated to a different origin than the plan's URL.",
                        errorType: "unexpected_navigation",
                    });
                    this._skipRemaining(scenario, "the journey left the plan's origin");
                    break;
                }
                continue;
            }

            // Phase 11: a scenario that navigated the page (typically a
            // click on a link) must not leave every later scenario in this
            // plan running against the DOM it left behind.
            await this._returnToPlanUrl();
        }

        return this.results;
    }

    _skipRemaining(current, reason) {
        const list = this.testPlan.test_scenarios;
        for (const rest of list.slice(list.indexOf(current) + 1)) {
            this.results.push({ name: rest.description, status: "skipped", reason: `Not run: ${reason}` });
        }
    }

    _leftPlanOrigin() {
        if (typeof this.page.url !== "function") return false;
        try {
            return new URL(this.page.url()).origin !== new URL(this.testPlan.url).origin;
        } catch {
            return false;
        }
    }

    /**
     * `expect` — a read-only check. It never goes through AIHealer: a wrong
     * expectation is a finding, not a broken locator, and must not be "healed".
     * Two distinct failures: `unavailable` (the target never appeared within the
     * timeout, or matched more than one element) and `failed` (the target was
     * there but the condition did not hold). Both fail the run.
     */
    async runExpect(scenario) {
        const startTime = Date.now();
        const timeout = scenario.timeoutMs ?? 5000;
        const evidence = {
            check: scenario.check,
            locator: scenario.locator,
            ...(scenario.attribute ? { attribute: scenario.attribute } : {}),
            ...(scenario.value !== undefined ? { expected: scenario.value } : {}),
            timeoutMs: timeout,
        };
        const row = (status, extra) => {
            const duration = Date.now() - startTime;
            this.results.push({ name: scenario.description, status, duration, assertion: { ...evidence, ...extra } });
        };
        Logger.info(`▶ Asserting: ${scenario.description} (${scenario.check})`);
        const locator = this.page.locator(scenario.locator);
        let count = 0;
        try {
            await locator.first().waitFor({ state: "attached", timeout });
            count = await locator.count();
        } catch {
            Logger.error(`❌ Assertion target unavailable: ${scenario.description}`);
            row("unavailable", { outcome: "target_unavailable", matches: 0 });
            this.results[this.results.length - 1].reason = "Assertion target was not found within the timeout";
            return;
        }
        if (count !== 1) {
            Logger.error(`❌ Assertion target ambiguous: ${scenario.description} (${count} matches)`);
            row("unavailable", { outcome: "target_ambiguous", matches: count });
            this.results[this.results.length - 1].reason = `Assertion target matched ${count} elements`;
            return;
        }
        let ok = false;
        let actual;
        try {
            if (scenario.check === "visible") {
                await locator.waitFor({ state: "visible", timeout });
                ok = true;
            } else if (scenario.check === "containsText") {
                const deadline = Date.now() + timeout;
                do {
                    actual = (await locator.textContent({ timeout: 1000 })) || "";
                    ok = actual.includes(scenario.value);
                    if (!ok) await this.page.waitForTimeout(100);
                } while (!ok && Date.now() < deadline);
                actual = actual.slice(0, 200);
            } else {
                const deadline = Date.now() + timeout;
                do {
                    actual = await locator.getAttribute(scenario.attribute, { timeout: 1000 });
                    ok = scenario.check === "attributeExists" ? actual !== null : actual === scenario.value;
                    if (!ok) await this.page.waitForTimeout(100);
                } while (!ok && Date.now() < deadline);
            }
        } catch {
            ok = false;
        }
        if (ok) {
            Logger.info(`✅ Assertion passed: ${scenario.description}`);
            row("passed", { outcome: "passed", matches: 1, ...(actual !== undefined && actual !== null ? { actual } : {}) });
            return;
        }
        Logger.error(`❌ Assertion failed: ${scenario.description}`);
        row("failed", { outcome: "assertion_failed", matches: 1, ...(actual !== undefined ? { actual } : {}) });
        const failed = this.results[this.results.length - 1];
        failed.error = `Assertion failed: ${scenario.check}`;
        failed.errorType = "assertion";
    }

    /**
     * If the page has drifted away from the URL this test plan was
     * generated from, navigate back to it before the next scenario runs.
     * Compares normalised URLs (SiteSweep.normalizeUrl) so a harmless
     * difference — trailing slash, fragment — never triggers an extra page
     * load. Required lazily to avoid a load-order cycle with SiteSweep,
     * which itself requires TestRunner.
     *
     * Silent no-op for lightweight test doubles that don't implement
     * page.url()/page.goto(); a failed return is logged, not thrown, so it
     * never aborts the remaining scenarios.
     */
    async _returnToPlanUrl() {
        if (!this.testPlan.url) return;
        if (typeof this.page.url !== "function" || typeof this.page.goto !== "function") return;

        let current;
        try {
            current = this.page.url();
        } catch {
            return;
        }

        const SiteSweep = require("./SiteSweep");
        const target = SiteSweep.normalizeUrl(this.testPlan.url);
        if (!target || SiteSweep.normalizeUrl(current) === target) return;

        try {
            await this.page.goto(this.testPlan.url, { waitUntil: "load" });
        } catch (error) {
            Logger.warning(`⚠️ Could not return to ${this.testPlan.url} after the page navigated away: ${error.message}`);
        }
    }

    async runScenario(scenario) {
        const startTime = Date.now();

        if (scenario.action === "expect") {
            await this.runExpect(scenario);
            return;
        }

        if (scenario.action !== "click" && scenario.action !== "type" && scenario.action !== "select") {
            Logger.warning(`⚠️ Unknown action "${scenario.action}" for ${scenario.description} — skipping.`);
            this.results.push({
                name: scenario.description,
                status: "skipped",
                reason: `Unknown action "${scenario.action}"`,
            });
            return;
        }

        // Phase 11: every supported action now goes through AIHealer, which
        // has its own AdaptiveRetry + Tier 2/3 healing chain internally —
        // wrapping it in another multi-attempt loop here would re-trigger
        // the whole chain (including live OpenAI calls) redundantly. One
        // attempt at this level is correct for all three actions.
        const maxAttempts = 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                Logger.info(`▶ Executing [${attempt}/${maxAttempts}]: ${scenario.description} (${scenario.action})`);

                if (scenario.action === "click") {
                    await this.healer.healAndClick(scenario.locator, scenario.description);
                } else if (scenario.action === "type") {
                    await this.healer.healAndType(scenario.locator, scenario.value, scenario.description);
                } else if (scenario.action === "select") {
                    await this.healer.healAndSelect(scenario.locator, scenario.value, scenario.description);
                }

                const duration = Date.now() - startTime;
                Logger.info(`✅ Passed: ${scenario.description} (${duration}ms)`);
                this.results.push({ name: scenario.description, status: "passed", duration });
                FlakinessTracker.record({
                    url: this.testPlan.url,
                    action: scenario.action,
                    locator: scenario.locator,
                    description: scenario.description,
                    status: "passed",
                    duration,
                });
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
                        action: scenario.action,
                    });
                    const duration = Date.now() - startTime;
                    const errorType = AdaptiveRetry.classify(error);
                    // AC-05 (Q6/Q8): AIHealer marks its two "chain exhausted"
                    // throws with error.code === "TARGET_UNAVAILABLE". That
                    // is a sub-classification of "failed" for classification
                    // purposes — FlakinessTracker.record() still only ever
                    // sees status "passed"/"failed" — but its own reporting
                    // bucket for the result row, distinct from an ordinary
                    // failure and never conflated with "skipped" (a genuinely
                    // unknown action, handled earlier in this method).
                    const outcome = error.code === "TARGET_UNAVAILABLE" ? "unavailable" : null;
                    FlakinessTracker.record({
                        url: this.testPlan.url,
                        action: scenario.action,
                        locator: scenario.locator,
                        description: scenario.description,
                        status: "failed",
                        duration,
                        errorType,
                        outcome,
                    });

                    const scenarioKey = FlakinessTracker.keyFor({
                        url: this.testPlan.url,
                        action: scenario.action,
                        locator: scenario.locator,
                    });
                    if (FlakinessTracker.isQuarantined(scenarioKey)) {
                        Logger.warning(`🧯 ${scenario.description} failed but is quarantined — not blocking this run.`);
                        this.results.push({
                            name: scenario.description,
                            status: "quarantined",
                            duration,
                            error: error.message,
                            errorType,
                            ...(outcome ? { outcome } : {}),
                        });
                    } else if (outcome === "unavailable") {
                        this.results.push({
                            name: scenario.description,
                            status: "unavailable",
                            duration,
                            reason: error.message,
                            error: error.message,
                            errorType,
                        });
                    } else {
                        this.results.push({
                            name: scenario.description,
                            status: "failed",
                            duration,
                            error: error.message,
                            errorType,
                        });
                    }
                }
            }
        }
    }

    /**
     * Execute an exploratory run and persist a JSON summary.
     * Called from falcon.js after DOMIssueScanner and ClickExplorer have run.
     *
     * @param {Object} opts
     * @param {Array}  opts.uiIssues      - Issues found by DOMIssueScanner
     * @param {Array}  opts.exploredPages - Pages visited by ClickExplorer
     */
    async executeExploratoryTest({ uiIssues = [], exploredPages = [] } = {}) {
        Logger.info("🛠 Writing exploratory scan summary...");
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

/**
 * Repeat orchestration (Phase 12, AC-02/AC-03, design Q1-Q5): generate a test
 * plan once, execute it `repeatCount` times, so a target that fails
 * intermittently gets multiple samples in a single run rather than requiring
 * `repeatCount` separate invocations of falcon.js.
 *
 * - Both existing call sites (SiteSweep._sweepPage, falcon.js's
 *   runEntryPageOnly) already generate `testPlan` exactly once per page, so
 *   this sits at that same boundary — it never re-generates the plan.
 * - A NEW TestRunner is constructed per iteration so `.results` never
 *   accumulates across repetitions.
 * - Before every iteration after the first, the page is navigated back to
 *   `testPlan.url` unconditionally (not the drift-check `_returnToPlanUrl`
 *   uses between scenarios within one repetition) so no repetition starts on
 *   DOM/navigation state a previous repetition left behind. Guarded exactly
 *   like `_returnToPlanUrl` for lightweight test doubles that don't implement
 *   `page.goto`/`page.url`; a failed return is a Logger.warning, not a thrown
 *   error, so the remaining repetitions still run.
 * - Every result row is tagged with a 1-indexed `repetition` field.
 *   `name` is never touched — SiteSweep releases dedupe claims by matching
 *   `result.name === scenario.description` (SiteSweep.js `_sweepPage`'s
 *   catch), and a renamed row would silently break that.
 * - `repeatCount` of 1 is byte-identical to today's single `executeTest()`
 *   call, apart from the added `repetition: 1` field.
 *
 * @param {import('playwright').Page} page
 * @param {Object} testPlan - already-generated plan (url + test_scenarios)
 * @param {number} repeatCount - >= 1
 * @returns {Promise<Array>} one flat array of every iteration's result rows
 */
async function runRepeatedTestPlan(page, testPlan, repeatCount, options = {}) {
    const count = Number.isFinite(repeatCount) && repeatCount >= 1 ? Math.floor(repeatCount) : 1;
    const allResults = [];

    for (let i = 1; i <= count; i++) {
        if (i > 1) {
            const canNavigate = testPlan && testPlan.url
                && typeof page.goto === "function" && typeof page.url === "function";
            if (canNavigate) {
                try {
                    await page.goto(testPlan.url, { waitUntil: "load" });
                } catch (error) {
                    Logger.warning(
                        `⚠️ Could not return to ${testPlan.url} before repetition ${i}: ${error.message}`
                    );
                }
            }
        }

        const runner = new TestRunner(page, testPlan, options);
        try {
            const results = await runner.executeTest();
            for (const result of results) {
                allResults.push({ ...result, repetition: i });
            }
        } catch (error) {
            // SiteSweep._sweepPage salvages whatever verdicts were already
            // reached before a mid-plan throw (see its own comment) — with a
            // single executeTest() call that came from reading the
            // TestRunner instance's own `.results` after the fact. Here a
            // fresh TestRunner is constructed per repetition, so the
            // equivalent salvage (this iteration's partial results, tagged
            // with `repetition`, plus every earlier iteration's completed
            // results) is attached to the rethrown error instead.
            const salvaged = Array.isArray(runner.results) ? runner.results : [];
            for (const result of salvaged) {
                allResults.push({ ...result, repetition: i });
            }
            error.partialResults = allResults;
            throw error;
        }
    }

    return allResults;
}

module.exports = TestRunner;
module.exports.runRepeatedTestPlan = runRepeatedTestPlan;
