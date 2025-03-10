const Logger = require("../../utils/Logger");
const AIHealer = require("./AIHealer/AIHealer");

class TestRunner {
    constructor(page, testPlan) {
        this.page = page;
        this.testPlan = testPlan;
        this.healer = new AIHealer(page);
        this.retryAttempts = 3;
        this.results = [];
    }

    async executeTest() {
        Logger.info(`🛠 Running tests for: ${this.testPlan.url}`);

        for (const scenario of this.testPlan.test_scenarios) {
            await this.runScenario(scenario);
        }

        this.logResults();
    }

    async runScenario(scenario) {
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                Logger.info(`▶ Executing [${attempt}/${this.retryAttempts}]: ${scenario.description} (${scenario.action})`);

                if (scenario.action === "click") {
                    await this.healer.healAndClick(scenario.locator, scenario.description);
                } else if (scenario.action === "type") {
                    await this.page.fill(scenario.locator, scenario.value);
                }

                Logger.info(`✅ Passed: ${scenario.description}`);
                this.results.push({ scenario, status: "passed" });
                return;
            } catch (error) {
                Logger.warning(`⚠️ Attempt ${attempt} failed for ${scenario.description}: ${error.message}`);

                if (attempt === this.retryAttempts) {
                    Logger.error(`❌ Test Failed: ${scenario.description}`);
                    this.results.push({ scenario, status: "failed", error: error.message });
                }
            }
        }
    }

    logResults() {
        Logger.info(`📊 Test Execution Summary:`);
        const passed = this.results.filter(r => r.status === "passed").length;
        const failed = this.results.filter(r => r.status === "failed").length;
        Logger.info(`✅ Passed: ${passed}, ❌ Failed: ${failed}`);
    }
}

module.exports = TestRunner;
