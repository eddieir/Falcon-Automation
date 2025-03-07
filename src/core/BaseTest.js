const Logger = require("../../utils/Logger");
const serviceContainer = require("./ServiceContainer");

class BaseTest {
    constructor(testName = "Unnamed_Test") {
        this.testName = testName; // Ensure testName is never undefined
        this.browserManager = serviceContainer.get("browserManager");
        this.apiClient = serviceContainer.get("apiClient");
        this.dbClient = serviceContainer.get("dbClient");
        this.reportManager = serviceContainer.get("reportManager");
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