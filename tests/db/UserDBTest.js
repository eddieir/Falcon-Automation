const BaseTest    = require("../../src/core/BaseTest");
const Logger      = require("../../utils/Logger");
const Middleware  = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");

/**
 * UserDBTest — verifies that the `users` table is reachable and contains data.
 *
 * Phase 2 fix:
 *   The query used a MySQL-style `?` placeholder:
 *     `SELECT * FROM users WHERE username = ?`
 *   The pg driver (PostgreSQL) requires numbered placeholders (`$1`, `$2`, …).
 *   Using `?` causes pg to throw "invalid input syntax" without executing the
 *   query.  Fixed to `$1`.
 *
 *   Also added Middleware hooks, ErrorHandler, and Logger — consistent with
 *   the other tests in this suite.
 *
 * Phase 6 fix — false failure when DB isn't configured, wasted browser launch.
 *   This test is DB-only but called `await this.setup()`, which is BaseTest's
 *   browser-launching setup — every run spun up a full headless Chromium
 *   instance it never used. Worse, when DB_HOST/DB_USER are unset,
 *   ServiceContainer never registers `dbClient`, so `this.dbClient` is
 *   `null`; calling `.query()` on it threw `Cannot read properties of null`,
 *   which was caught and recorded as a *failed* test rather than a *skipped*
 *   one — indistinguishable from a real data problem in the report.
 *
 *   Fixed by dropping the browser-based setup()/teardown() entirely (this
 *   test never touched a page) and skipping cleanly, with a clear log
 *   message, when `dbClient` isn't available.
 *
 * Phase 11 fix — no-DB-locally is an environment declaration, not a verdict.
 *   ReportManager now reports NO_TESTS_RUN (exit 1) for any run whose every
 *   result is `skipped`, which closed a real hole elsewhere but also meant
 *   this file's local no-Postgres convenience started failing CI-style runs
 *   for a case CLAUDE.md explicitly allows: DB tests may skip locally without
 *   configuration; CI is the authority for the real PostgreSQL path.
 *
 *   Fixed by handling the "no dbClient" case before any report is produced:
 *   when `process.env.CI` is unset, this is a contributor running the suite
 *   without Postgres — log it plainly and exit 0 without pushing a scenario
 *   row or generating a report, so it can no longer be mistaken for a run
 *   that verified something. When `process.env.CI` IS set, CI provisions a
 *   Postgres service container, so a missing configuration there means the
 *   job is silently testing nothing — that is recorded as a real failure and
 *   exits 1, naming the missing configuration.
 */
class UserDBTest extends BaseTest {
    async runTest() {
        if (!this.dbClient) {
            // `CI` is a convention, not a boolean: runners set it to "true" or
            // "1", and some tooling exports CI=false specifically to turn CI
            // behaviour off. A bare truthiness check treats that "false" as
            // set and fails a contributor's local run, which is the exact
            // outcome this branch exists to prevent.
            const ci = (process.env.CI || "").toLowerCase();
            if (ci !== "" && ci !== "0" && ci !== "false") {
                await Middleware.beforeTest(this.testName);
                const message = "DB User Test: no database configured in CI (DB_HOST/DB_USER not set) — CI provisions a Postgres service container, so this run verified nothing.";
                Logger.error(`❌ ${message}`);
                this._results.push({ name: "DB User", status: "failed", error: message });
                this.reportManager.startRun();
                this.reportManager.generateReport({ tests: this._results });
                await Logger.flush();
                await Middleware.afterTest(this.testName);
                return;
            }

            Logger.warning("⚠️  Skipping DB User Test — no database configured locally (DB_HOST/DB_USER not set). Nothing was verified; CI is the authority for the real PostgreSQL path.");
            await Logger.flush();
            return;
        }

        await Middleware.beforeTest(this.testName);
        try {
            this.reportManager.startRun();

            Logger.info("🔹 Running DB User Test...");

            // PostgreSQL requires $1 positional placeholders, not MySQL-style ?
            const users = await this.dbClient.query(
                "SELECT * FROM users WHERE username = $1 LIMIT 1",
                ["test_user"]
            );

            if (users.length > 0) {
                Logger.info(`✅ User found in database: ${JSON.stringify(users[0])}`);
                this._results.push({ name: "DB User", status: "passed" });
            } else {
                throw new Error("❌ User 'test_user' not found in the users table.");
            }
        } catch (error) {
            this._results.push({ name: "DB User", status: "failed", error: error.message });
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            this.reportManager.generateReport({ tests: this._results });
            await Logger.flush();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new UserDBTest()).runTest();
