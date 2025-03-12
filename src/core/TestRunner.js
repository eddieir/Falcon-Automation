const Logger = require("../../utils/Logger");
const AIHealer = require("../core/AIHealer/AIHealer");
const HealingReport = require("../core/AIHealer/HealingReport");

class TestRunner {
    constructor(page, testPlan) {
        this.page = page;
        this.healer = new AIHealer(page);
        this.testPlan = testPlan;
        this.results = [];
    }

    async executeTest() {
        Logger.info(`🛠 Running adaptive AI-healing tests for: ${this.testPlan.url}`);

        for (const scenario of this.testPlan.test_scenarios) {
            const isVisible = await this.isElementVisible(scenario.locator);

            if (!isVisible) {
                Logger.warning(`⏭ Skipping ${scenario.description}: Element is not visible.`);
                this.results.push({ scenario, status: "skipped", reason: "Element not visible" });
                continue;
            }

            await this.runScenario(scenario);
        }

        this.logResults();
    }

    async isElementVisible(selector) {
        try {
            return await this.page.evaluate(sel => {
                const el = document.querySelector(sel);
                return el !== null && el.offsetParent !== null;
            }, selector);
        } catch (error) {
            return false;
        }
    }

    async runScenario(scenario) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                Logger.info(`▶ Executing [${attempt}/3]: ${scenario.description} (${scenario.action})`);

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

                if (attempt === 3) {
                    Logger.error(`❌ Test Failed: ${scenario.description}`);
                    HealingReport.logHealing(scenario.description, scenario.locator, "AI-Healer could not find a fix");
                    this.results.push({ scenario, status: "failed", error: error.message });
                }
            }
        }
    }
    // ✅ Rename this function to match `falcon.js`
    async executeExploratoryTest() {
        Logger.info(`🛠 Running AI-powered exploratory testing...`);

        const results = {
            issues: this.uiIssues,
            exploredPages: Array.from(this.exploredPages)
        };

        this.logResults(results);
    }

    logResults(results) {
        Logger.info(`📊 Exploratory Test Summary:`);
        Logger.info(`❗ UI Issues Found: ${results.issues.length}`);
        Logger.info(`🌍 Pages Explored: ${results.exploredPages.length}`);

        const reportsDir = path.join(__dirname, "..", "reports");
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        fs.writeFileSync(
            path.join(reportsDir, "exploratory_test_results.json"),
            JSON.stringify(results, null, 2)
        );

        Logger.info(`📜 Report saved to reports/exploratory_test_results.json`);
    
    }
}

module.exports = TestRunner;
