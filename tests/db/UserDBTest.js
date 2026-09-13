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
 */
class UserDBTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);
        try {
            await this.setup();

            Logger.info("🔹 Running DB User Test...");

            // PostgreSQL requires $1 positional placeholders, not MySQL-style ?
            const users = await this.dbClient.query(
                "SELECT * FROM users WHERE username = $1 LIMIT 1",
                ["test_user"]
            );

            if (users.length > 0) {
                Logger.info(`✅ User found in database: ${JSON.stringify(users[0])}`);
            } else {
                throw new Error("❌ User 'test_user' not found in the users table.");
            }
        } catch (error) {
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            await this.teardown();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new UserDBTest()).runTest();
