const BrowserManager = require("../core/BrowserManager");
const APIClient = require("../core/APIClient");
const DBClient = require("../core/DBClient");
const ReportManager = require("../core/ReportManager");
const Logger = require("../../utils/Logger");

class BaseTest {
    constructor(testName) {
        this.testName = testName;
        this.browserManager = new BrowserManager();
        this.apiClient = new APIClient();
        this.dbClient = new DBClient();
        this.reportManager = new ReportManager();
    }

    async setup() {
        Logger.info(`🟢 Starting test: ${this.testName}`);
        await this.browserManager.launch();
    }

    async teardown() {
        Logger.info(`🟡 Cleaning up after test: ${this.testName}`);
        await this.browserManager.close();
        this.reportManager.generateReport(this.testName);
    }
}

module.exports = BaseTest;
