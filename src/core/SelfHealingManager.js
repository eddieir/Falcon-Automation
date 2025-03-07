const { expect } = require("@playwright/test");
const AIHelper = require("../../utils/AIHelper");

class SelfHealingManager {
    constructor(page) {
        this.page = page;
        this.retryAttempts = 3; // Number of retries before failing
        this.fallbackStrategies = [
            "Use alternative locator", 
            "Wait and retry", 
            "Try clicking parent element"
        ];
    }

    async safeClick(selector, alternativeSelectors = []) {
        for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
            try {
                console.log(`🔹 Attempting to click: ${selector} (Attempt ${attempt + 1})`);
                await this.page.waitForSelector(selector, { timeout: 2000 });
                await this.page.click(selector);
                return; // Exit if success
            } catch (error) {
                console.warn(`⚠️ Failed to click: ${selector}. Trying alternative locators...`);
                if (alternativeSelectors.length > 0) {
                    selector = alternativeSelectors.shift();
                } else {
                    console.error(`❌ All attempts failed for selector: ${selector}`);
                    await this.baseTest.captureScreenshot();
                    await this.baseTest.logTestResult("FAILED", error.message);
                    await this.handleFailure(error, selector);
                    return;
                }
            }
        }
    }

    async handleFailure(error, selector) {
        console.error(`🔥 Test Failed on Selector: ${selector}`);
        const aiSuggestion = await AIHelper.getFixSuggestion(error.message);
        console.log(`🤖 AI Suggestion: ${aiSuggestion}`);
    }
}

module.exports = SelfHealingManager;
