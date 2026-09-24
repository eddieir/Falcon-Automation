const fs = require("fs");
const path = require("path");

/**
 * ReportManager — produces an accurate, structured test-run summary.
 *
 * Accepts the full results array from TestRunner and tallies real outcomes.
 * The report is written to ./reports/test-report.json and a human-readable
 * summary is printed to stdout.
 *
 * Phase 6 fix — CI results were not actually gating anything.
 *   Every scenario test file (LoginTest, CheckoutTest, UserApiTest,
 *   ProductApiTest, UserDBTest, OrderDBTest) reports its outcome by calling
 *   this method and then lets the Node process exit naturally. Node exits
 *   0 unless something explicitly sets a non-zero code or an exception
 *   escapes every try/catch — and every one of these files wraps its whole
 *   run in try/catch, so a real test failure was still reported as
 *   "FAILED" on screen and in test-report.json, but the process itself
 *   always exited 0. Since CI steps are plain `run: node tests/...js`
 *   commands with no separate result check, this meant a genuine failure
 *   never turned a CI step red — the pipeline was only ever failing on an
 *   actual crash, not on a failed assertion.
 *
 *   Fixed by setting `process.exitCode` here based on the tallied result.
 *   `process.exitCode` (not `process.exit()`) is used deliberately: it lets
 *   the event loop drain naturally — any pending async Logger writes or
 *   file I/O still complete — while still producing the correct exit code
 *   once Node has nothing left to do.
 *
 * Report schema:
 * {
 *   "runId":      "<ISO timestamp>",
 *   "duration":   "<seconds>s",
 *   "summary": {
 *     "total":       <n>,
 *     "passed":      <n>,
 *     "failed":      <n>,
 *     "skipped":     <n>,
 *     "quarantined": <n>,
 *     "deduped":     <n>
 *   },
 *   "result":  "PASSED" | "FAILED" | "PARTIAL" | "NO_TESTS_RUN",
 *   "tests":   [ { name, status, duration, error? }, … ],
 *   "uiIssues":        [ … ],
 *   "healingEvents":   [ … ],
 *   "coverage":        { … } | null,
 *   "pages":           [ { url, status, reason?, … }, … ]
 * }
 *
 * Phase 9 — "quarantined" is a fourth valid status (FlakinessTracker):
 * TestRunner reports a scenario this way instead of "failed" when a human
 * has explicitly quarantined it. It is deliberately excluded from the
 * `failed` tally and from the pass/fail branches below, so a run with only
 * quarantined failures (and zero real ones) still reports PASSED and exits
 * 0 — that's the entire point of quarantining. It is never merged into
 * `passed` either: a quarantined scenario that is still actually failing
 * stays visible as its own bucket, not silently counted as green.
 *
 * Phase 10 — "deduped" is a fifth valid status, and a reporting-only one.
 * SiteSweep records it for a scenario whose instruction (action + locator +
 * value) is byte-identical to one already run on an earlier page — a nav bar
 * repeated across eleven pages. Such a scenario is never executed a second
 * time, so it has no outcome to tally: it is excluded from `passed`,
 * `failed`, `skipped` and `quarantined` alike, it takes no part in the
 * pass/fail branches, and it can never change the exit code. It is counted
 * in its own bucket for the same reason quarantined is — the deduplication
 * is a claim about coverage, and a claim you can't count is not auditable.
 *
 * `coverage` and `pages` are persisted verbatim as the sweep reported them
 * (see the SweepResult shape in docs/PHASE-PLANS.md). Nothing here derives or
 * second-guesses them: the run's tally comes from `tests`, and a report that
 * recomputed coverage from a different source could disagree with itself.
 */
class ReportManager {
    constructor() {
        this._startTime = null;
    }

    /**
     * One-line coverage summary, e.g.
     *   Pages: 11 tested, 2 skipped (max-pages) | Scenarios: 184 generated, 93 deduped
     *
     * The skip reasons are named rather than just counted. "2 skipped" invites
     * the reader to assume a crawl limitation; "(max-pages)" tells them it was
     * their own bound and that raising it would cover more, which is the whole
     * difference between a coverage report and a coverage excuse. Exposed as a
     * static so a test can assert the wording without parsing stdout.
     *
     * @param {Object} coverage - SweepResult.coverage
     * @param {Array}  [pages]  - per-page rows, read only for their skip reasons
     */
    static coverageLine(coverage = {}, pages = []) {
        const reasons = [...new Set(
            (Array.isArray(pages) ? pages : [])
                .filter((p) => p && p.status === "skipped" && p.reason)
                .map((p) => p.reason)
        )];
        const skipped = coverage.pagesSkipped || 0;
        const unreachable = coverage.pagesUnreachable || 0;
        return `Pages: ${coverage.pagesTested || 0} tested, ${skipped} skipped` +
            (skipped > 0 && reasons.length > 0 ? ` (${reasons.join(", ")})` : "") +
            (unreachable > 0 ? `, ${unreachable} unreachable` : "") +
            (coverage.budgetExhausted ? " [budget exhausted]" : "") +
            ` | Scenarios: ${coverage.scenariosGenerated || 0} generated, ` +
            `${coverage.scenariosDeduplicated || 0} deduped`;
    }

    /** Call once before the test suite starts to enable duration tracking. */
    startRun() {
        this._startTime = Date.now();
    }

    /**
     * Write a complete, honest report based on actual test outcomes.
     *
     * @param {Object} opts
     * @param {Array}  opts.tests        - Array of { name, status, duration?, error? }
     *                                     status must be one of: "passed" | "failed" |
     *                                     "skipped" | "quarantined" | "deduped"
     * @param {Array}  [opts.uiIssues]   - Issues detected by ExploratoryAI (optional)
     * @param {Array}  [opts.healingEvents] - Events from HealingReport (optional)
     * @param {Object} [opts.coverage]   - SweepResult.coverage from SiteSweep (optional)
     * @param {Array}  [opts.pages]      - SweepResult per-page breakdown (optional)
     */
    generateReport({ tests = [], uiIssues = [], healingEvents = [], coverage = null, pages = [] } = {}) {
        if (!Array.isArray(tests) || !Array.isArray(uiIssues) || !Array.isArray(healingEvents) || !Array.isArray(pages)) {
            throw new TypeError("Report results, issues, healing events and pages must be arrays");
        }
        if (coverage !== null && (typeof coverage !== "object" || Array.isArray(coverage))) {
            throw new TypeError("Report coverage must be an object or null");
        }
        if (tests.some(result => !result || !["passed", "failed", "skipped", "quarantined", "deduped"].includes(result.status))) {
            throw new TypeError("Each test result must have a valid status");
        }
        const endTime = Date.now();
        const durationSeconds = this._startTime
            ? ((endTime - this._startTime) / 1000).toFixed(2)
            : "unknown";

        // Tally real outcomes
        const passed      = tests.filter((t) => t.status === "passed").length;
        const failed      = tests.filter((t) => t.status === "failed").length;
        const skipped     = tests.filter((t) => t.status === "skipped").length;
        const quarantined = tests.filter((t) => t.status === "quarantined").length;
        const deduped     = tests.filter((t) => t.status === "deduped").length;
        const total        = tests.length;

        // `deduped` is the one status describing work that never happened: the
        // scenario was byte-identical to one already run on an earlier page, so
        // it was dropped before execution. Every other status, `quarantined`
        // and `skipped` included, describes a scenario this run actually
        // reached a verdict on. The branches below therefore count `executed`
        // rather than `total` — a run whose rows are *all* deduped tested
        // nothing, and must stay NO_TESTS_RUN (exit 1) exactly as an empty run
        // does. Gating on `total` would hand back a green exit code for a run
        // that executed not one scenario.
        const executed = total - deduped;

        // Top-level result: PASSED only if every executed test passed
        let overallResult;
        if (executed === 0) {
            overallResult = "NO_TESTS_RUN";
        } else if (failed === 0) {
            overallResult = "PASSED";
        } else if (passed === 0) {
            overallResult = "FAILED";
        } else {
            overallResult = "PARTIAL"; // some passed, some failed
        }

        const report = {
            runId: new Date().toISOString(),
            duration: `${durationSeconds}s`,
            summary: { total, passed, failed, skipped, quarantined, deduped },
            result: overallResult,
            tests,
            uiIssues,
            healingEvents,
            coverage,
            pages,
        };

        // Ensure the reports directory exists
        const reportsDir = path.join(process.cwd(), "reports");
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const reportPath = path.join(reportsDir, "test-report.json");
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        // Human-readable summary to stdout
        const icon = overallResult === "PASSED" ? "✅" : overallResult === "FAILED" ? "❌" : "⚠️";
        console.log(`\n${icon} Test Run Complete — ${overallResult}`);
        console.log(
            `   Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}  |  Skipped: ${skipped}` +
            (quarantined > 0 ? `  |  Quarantined: ${quarantined}` : "") +
            (deduped > 0 ? `  |  Deduped: ${deduped}` : "")
        );
        if (coverage) {
            console.log(`   ${ReportManager.coverageLine(coverage, pages)}`);
        }
        console.log(`   Duration: ${durationSeconds}s`);
        if (uiIssues.length > 0) {
            console.log(`   UI Issues detected: ${uiIssues.length}`);
        }
        if (healingEvents.length > 0) {
            console.log(`   Self-healing events: ${healingEvents.length}`);
        }
        console.log(`   Report written to: ${reportPath}\n`);

        // Anything other than a clean PASSED must fail the process — this is
        // what actually lets CI gate merges on real test outcomes rather
        // than on "did the script crash."
        process.exitCode = overallResult === "PASSED" ? 0 : 1;

        return report;
    }
}

module.exports = ReportManager;
