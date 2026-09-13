const DBClient = require("../../src/core/DBClient");
const Logger   = require("../../utils/Logger");

/**
 * TestDBConnection — smoke test that verifies the database pool can connect
 * and execute a trivial query.
 *
 * Phase 2 fix:
 *   Import path was `../../core/DBClient` which resolves to a non-existent
 *   path (the file is at `src/core/DBClient.js`).  Fixed to
 *   `../../src/core/DBClient`.
 *
 *   Also replaced `console.*` with `Logger.*` and added `Logger.flush()` so
 *   all log lines reach disk before the process exits.
 */
class TestDBConnection {
    async runTest() {
        const db = new DBClient();
        try {
            Logger.info("🔹 Testing database connectivity...");
            const rows = await db.query("SELECT 1 AS ok");
            Logger.info(`✅ Database connection successful. Response: ${JSON.stringify(rows[0])}`);
        } catch (error) {
            Logger.error(`❌ Database connection failed: ${error.message}`);
        } finally {
            await db.close();
            await Logger.flush();
        }
    }
}

(new TestDBConnection()).runTest();
