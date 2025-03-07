const fs = require("fs");
const path = require("path");

class BaseTest {
    constructor(page, testName) {
        this.page = page;
        this.testName = testName;
        this.screenshotPath = path.join(__dirname, "..", "reports", `${testName}.png`);
    }

    async captureScreenshot() {
        console.log(`📸 Capturing screenshot for failed test: ${this.testName}`);
        await this.page.screenshot({ path: this.screenshotPath });
    }

    async logTestResult(status, errorMessage = "N/A") {
        const logData = {
            test: this.testName,
            status,
            error: errorMessage,
            screenshot: this.screenshotPath,
            timestamp: new Date().toISOString(),
        };

        fs.writeFileSync(
            path.join(__dirname, "..", "reports", `${this.testName}.json`),
            JSON.stringify(logData, null, 2)
        );
        console.log(`📝 Test result logged: ${logData.test} - ${logData.status}`);
    }
}

module.exports = BaseTest;
