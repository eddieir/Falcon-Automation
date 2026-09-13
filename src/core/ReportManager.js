const fs = require("fs");
const path = require("path");

/**
 * ReportManager — produces an accurate, structured test-run summary.
 *
 * Accepts the full results array from TestRunner and tallies real outcomes.
 * The report is written to ./reports/test-report.json and a human-readable
 * summary is printed to stdout.
 *
 * Report schema:
 * {
 *   "runId":      "<ISO timestamp>",
 *   "duration":   "<seconds>s",
 *   "summary": {
 *     "total":   <n>,
 *     "passed":  <n>,
 *     "failed":  <n>,
 *     "skipped": <n>
 *   },
 *   "result":  "PASSED" | "FAILED" | "PARTIAL",
 *   "tests":   [ { name, status, duration, error? }, … ],
 *   "uiIssues":        [ … ],
 *   "healingEvents":   [ … ]
 * }
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
        const endTime = Date.now();
        const durationSeconds = this._startTime
            ? ((endTime - this._startTime) / 1000).toFixed(2)
            : "unknown";

        // Tally real outcomes
        const passed  = tests.filter((t) => t.status === "passed").length;
        const failed  = tests.filter((t) => t.status === "failed").length;
        const skipped = tests.filter((t) => t.status === "skipped").length;
        const total   = tests.length;

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
            summary: { total, passed, failed, skipped },
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
        console.log(`   Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}  |  Skipped: ${skipped}`);
        console.log(`   Duration: ${durationSeconds}s`);
        if (uiIssues.length > 0) {
            console.log(`   UI Issues detected: ${uiIssues.length}`);
        }
        if (healingEvents.length > 0) {
            console.log(`   Self-healing events: ${healingEvents.length}`);
        }
        console.log(`   Report written to: ${reportPath}\n`);

        return report;
    }
}

module.exports = ReportManager;
