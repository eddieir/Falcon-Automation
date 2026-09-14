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
 */
class UserDBTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);
        try {
            this.reportManager.startRun();

            if (!this.dbClient) {
                Logger.warning("⚠️  Skipping DB User Test — no database configured (DB_HOST/DB_USER not set).");
                this._results.push({ name: "DB User", status: "skipped" });
                return;
            }

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
