const Logger = require("../../utils/Logger");
const fs = require("fs");
const path = require("path");

class ErrorHandler {
    static async handleError(testName, error) {
        Logger.error(`❌ Test '${testName}' failed! Error: ${error.message}`);

        // Ensure reports directory exists
        const reportsDir = path.join(__dirname, "..", "reports");
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        // Capture failure details
        const errorReport = {
            testName,
            errorMessage: error.message,
            stackTrace: error.stack,
            timestamp: new Date().toISOString(),
        };

        // Write to structured error report
        const errorFilePath = path.join(reportsDir, `${testName.replace(/\s+/g, "_")}_error.json`);
        fs.writeFileSync(errorFilePath, JSON.stringify(errorReport, null, 2));

        Logger.info(`📄 Error report saved: ${errorFilePath}`);
    }
}

module.exports = ErrorHandler;