const Logger = require("../../utils/Logger");
const fs = require("fs");
const path = require("path");

/**
 * ErrorHandler — captures test failure details and persists them to disk.
 *
 * Phase 3 fix:
 *   path.join(__dirname, "..", "reports") resolved to src/reports/ — a directory
 *   that has never existed.  Every call to handleError() silently failed to write
 *   the error report, discarding all diagnostic data.
 *   Corrected path: two ".." segments from src/core/ reach the project root.
 *   fs.writeFileSync replaced with async write queued through a promise chain so
 *   the error handler never blocks the event loop.
 */
class ErrorHandler {
    static async handleError(testName, error) {
        Logger.error(`❌ Test '${testName}' failed! Error: ${error.message}`);

        // Two ".." segments from src/core/ → project root → reports/
        const reportsDir = path.join(__dirname, "..", "..", "reports");

        try {
            await fs.promises.mkdir(reportsDir, { recursive: true });
        } catch { /* ignore if already exists */ }

        const errorReport = {
            testName,
            errorMessage: error.message,
            stackTrace: error.stack,
            timestamp: new Date().toISOString(),
        };

        const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, "_");
        const errorFilePath = path.join(reportsDir, `${safeName}_error.json`);

        try {
            await fs.promises.writeFile(errorFilePath, JSON.stringify(errorReport, null, 2), "utf8");
            Logger.info(`📄 Error report saved: ${errorFilePath}`);
        } catch (writeErr) {
            Logger.error(`⚠️ Could not write error report: ${writeErr.message}`);
        }
    }
}

module.exports = ErrorHandler;