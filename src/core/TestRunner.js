const Logger = require("../../utils/Logger");
const AIHealer = require("./AIHealer/AIHealer");

class TestRunner {
    constructor(page, actions) {
        this.page = page;
        this.healer = new AIHealer(page);
        this.actions = actions;
        this.results = [];
    }

    async executeTest() {
        Logger.info(`🛠 Running fully autonomous AI-generated test flow...`);

        for (const action of this.actions) {
            Logger.info(`▶ Executing: ${action.description} (${action.action})`);

            try {
                if (action.action === "click") {
                    await this.healer.healAndClick(action.locator, action.description);
                } else if (action.action === "type") {
                    await this.page.fill(action.locator, action.value);
                }

                Logger.info(`✅ Passed: ${action.description}`);
                this.results.push({ action, status: "passed" });
            } catch (error) {
                Logger.error(`❌ Failed: ${action.description} - ${error.message}`);
                this.results.push({ action, status: "failed", error: error.message });
            }
        }

        this.logResults();
    }

    logResults() {
        const passed = this.results.filter(r => r.status === "passed").length;
        const failed = this.results.filter(r => r.status === "failed").length;
        Logger.info(`📊 AI Test Summary: ✅ ${passed} passed, ❌ ${failed} failed`);
    }
}

module.exports = TestRunner;
