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
 *     "quarantined": <n>
 *   },
 *   "result":  "PASSED" | "FAILED" | "PARTIAL" | "NO_TESTS_RUN",
 *   "tests":   [ { name, status, duration, error? }, … ],
 *   "uiIssues":        [ … ],
 *   "healingEvents":   [ … ]
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
 */
class ReportManager {
    constructor() {
        this._startTime = null;
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
     *                                     status must be one of: "passed" | "failed" | "skipped"
     * @param {Array}  [opts.uiIssues]   - Issues detected by ExploratoryAI (optional)
     * @param {Array}  [opts.healingEvents] - Events from HealingReport (optional)
     */
    generateReport({ tests = [], uiIssues = [], healingEvents = [] } = {}) {
        if (!Array.isArray(tests) || !Array.isArray(uiIssues) || !Array.isArray(healingEvents)) {
            throw new TypeError("Report results, issues and healing events must be arrays");
        }
        if (tests.some(result => !result || !["passed", "failed", "skipped", "quarantined"].includes(result.status))) {
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
        const total        = tests.length;

        // Top-level result: PASSED only if every test passed
        let overallResult;
        if (failed === 0 && total > 0) {
            overallResult = "PASSED";
        } else if (passed === 0 && total > 0) {
            overallResult = "FAILED";
        } else if (total === 0) {
            overallResult = "NO_TESTS_RUN";
        } else {
            overallResult = "PARTIAL"; // some passed, some failed
        }

        const report = {
            runId: new Date().toISOString(),
            duration: `${durationSeconds}s`,
            summary: { total, passed, failed, skipped, quarantined },
            result: overallResult,
            tests,
            uiIssues,
            healingEvents,
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
            (quarantined > 0 ? `  |  Quarantined: ${quarantined}` : "")
        );
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
