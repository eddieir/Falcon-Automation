const BrowserManager = require("./BrowserManager");
const APIClient = require("./APIClient");
const DBClient = require("./DBClient");
const ReportManager = require("./ReportManager");

class BaseTest {
    constructor() {
        this.browserManager = new BrowserManager();
        this.apiClient = new APIClient();
        this.dbClient = new DBClient();
        this.reportManager = new ReportManager();
    }

    async setup() {
        console.log("🔹 Setting up the test environment...");
        await this.browserManager.launch();
    }

    async teardown() {
        console.log("🔹 Cleaning up after test execution...");
        await this.browserManager.close();
        this.reportManager.generateReport();
    }
}

module.exports = BaseTest;
