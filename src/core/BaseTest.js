const Logger = require("../../utils/Logger");
const serviceContainer = require("./ServiceContainer");

/**
 * BaseTest — dependency-injection base class for all Falcon test scenarios.
 *
 * Phase 1 patch (runtime fix):
 *   teardown() called reportManager.generateReport(this.testName) — passing a
 *   plain string to a method whose signature is now
 *   generateReport({ tests, uiIssues, healingEvents }).  The positional string
 *   landed in the `tests` slot and caused the tally logic to throw or produce
 *   garbage counts on every run.
 *
 *   Fixed by:
 *   1. Calling reportManager.startRun() in setup() so the wall-clock timer
 *      begins at the right moment.
 *   2. Passing the correct object shape in teardown(); individual test results
 *      accumulate in this._results during the run so the final report reflects
 *      real outcomes rather than an empty placeholder.
 */
class BaseTest {
    constructor(testName = "Unnamed_Test") {
        this.testName = testName;
        this.browserManager  = serviceContainer.get("browserManager");
        this.apiClient       = serviceContainer.get("apiClient");
        this.dbClient        = serviceContainer.getOptional("dbClient");
        this.reportManager   = serviceContainer.get("reportManager");
        /** Accumulate { name, status, duration?, error? } entries here. */
        this._results = [];
    }

    async setup() {
        Logger.info(`🟢 Starting test: ${this.testName}`);
        this.reportManager.startRun();
        await this.browserManager.launch();
    }

    async teardown() {
        Logger.info(`🟡 Cleaning up after test: ${this.testName}`);
        await this.browserManager.close();
        this.reportManager.generateReport({
            tests:         this._results,
            uiIssues:      [],
            healingEvents: [],
        });
        await Logger.flush();
    }
}

module.exports = BaseTest;