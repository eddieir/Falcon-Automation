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
 *
 * Phase 6 fix — false failure when DB isn't configured.
 *   Like UserDBTest, this called `this.dbClient.query(...)` without checking
 *   whether `dbClient` was actually registered. With no DB_HOST/DB_USER set,
 *   `this.dbClient` is `null` and the first query threw `Cannot read
 *   properties of null`, recorded as a *failed* test rather than a
 *   *skipped* one. Fixed with the same explicit skip check as UserDBTest.
 *
 * Phase 11 fix — no-DB-locally is an environment declaration, not a verdict.
 *   Same treatment as UserDBTest.js: ReportManager now reports NO_TESTS_RUN
 *   (exit 1) for a run whose every result is `skipped`, which contradicts
 *   CLAUDE.md's "DB tests may skip locally without configuration; CI is the
 *   authority for the real PostgreSQL path." Handled before any report is
 *   produced: no `dbClient` and no `process.env.CI` logs plainly and exits 0
 *   with no scenario row and no report; no `dbClient` WITH `process.env.CI`
 *   set means CI's Postgres service container is missing its configuration —
 *   that is a broken workflow, recorded as a real failure, exit 1.
 */
class OrderDBTest extends BaseTest {
    async runTest() {
        if (!this.dbClient) {
            if (process.env.CI) {
                await Middleware.beforeTest(this.testName);
                const message = "Order DB Test: no database configured in CI (DB_HOST/DB_USER not set) — CI provisions a Postgres service container, so this run verified nothing.";
                Logger.error(`❌ ${message}`);
                this._results.push({ name: "Order DB", status: "failed", error: message });
                this.reportManager.startRun();
                this.reportManager.generateReport({ tests: this._results });
                await Logger.flush();
                await Middleware.afterTest(this.testName);
                return;
            }

            Logger.warning("⚠️  Skipping Order DB Test — no database configured locally (DB_HOST/DB_USER not set). Nothing was verified; CI is the authority for the real PostgreSQL path.");
            await Logger.flush();
            return;
        }

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
