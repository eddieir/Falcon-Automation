const BaseTest     = require("../../src/core/BaseTest");
const Logger       = require("../../utils/Logger");
const Middleware   = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");

/**
 * OrderDBTest — verifies the orders table is reachable and contains expected
 * columns.  Designed to run against the same PostgreSQL instance as UserDBTest.
 *
 * Assertions:
 *   1. SELECT 1 connectivity smoke test
 *   2. Information schema confirms `orders` table exists
 *   3. Required columns (id, user_id, total, status, created_at) are present
 *
 * No writes are performed — this is a read-only validation run.
 */
class OrderDBTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);
        try {
            this.reportManager.startRun();
            Logger.info("🔹 Running Order DB Test...");

            // ── 1. Connectivity smoke test ────────────────────────────────
            const ping = await this.dbClient.query("SELECT 1 AS ok");
            if (!ping[0] || ping[0].ok !== 1) {
                throw new Error("Database connectivity check failed");
            }
            Logger.info("✅ Database is reachable");

            // ── 2. Check orders table exists ──────────────────────────────
            const tableCheck = await this.dbClient.query(
                `SELECT table_name
                 FROM information_schema.tables
                 WHERE table_schema = 'public'
                   AND table_name   = $1`,
                ["orders"]
            );
            if (tableCheck.length === 0) {
                throw new Error("Table 'orders' does not exist in the public schema");
            }
            Logger.info("✅ 'orders' table exists");

            // ── 3. Required columns present ───────────────────────────────
            const cols = await this.dbClient.query(
                `SELECT column_name
                 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name   = 'orders'`,
            );
            const colNames  = cols.map((r) => r.column_name);
            const required  = ["id", "user_id", "total", "status", "created_at"];
            const missing   = required.filter((c) => !colNames.includes(c));
            if (missing.length > 0) {
                throw new Error(`'orders' table is missing required columns: ${missing.join(", ")}`);
            }
            Logger.info(`✅ All required columns present: ${required.join(", ")}`);

            Logger.info("✅ Order DB Test Passed");
            this._results.push({ name: "Order DB", status: "passed" });
        } catch (error) {
            this._results.push({ name: "Order DB", status: "failed", error: error.message });
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            this.reportManager.generateReport({ tests: this._results });
            await Logger.flush();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new OrderDBTest()).runTest();
