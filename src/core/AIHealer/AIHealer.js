const LocatorStore = require("./LocatorStore");
const AIAnalyzer = require("../AIHealer/AIAnalyser");
const Logger = require("../../../utils/Logger");

class AIHealer {
    constructor(page) {
        this.page = page;
        this.retryAttempts = 3; // Max retry attempts
    }

    async healAndClick(selector, description = "Element") {
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                Logger.info(`🔹 Attempt ${attempt}: Trying to click ${description} (${selector})`);
                await this.page.waitForSelector(selector, { timeout: 2000 });
                await this.page.click(selector);
                LocatorStore.saveLocator(selector);
                return;
            } catch (error) {
                Logger.warning(`⚠️ Failed attempt ${attempt} to click ${description} (${selector})`);

                if (attempt === this.retryAttempts) {
                    Logger.error(`❌ All attempts failed for ${description} (${selector}). Engaging AI-Healer.`);
                    await this.healSelector(selector, description, error);
                }
            }
        }
    }

    async healSelector(selector, description, error) {
        const alternativeLocators = LocatorStore.getPreviousLocators(selector);
        if (alternativeLocators.length > 0) {
            Logger.info(`🔄 Trying stored alternative locators for ${description}`);
            for (let altSelector of alternativeLocators) {
                try {
                    Logger.info(`🔹 Trying alternative: ${altSelector}`);
                    await this.page.click(altSelector);
                    LocatorStore.saveLocator(altSelector);
                    return;
                } catch (err) {
                    Logger.warning(`⚠️ Alternative locator ${altSelector} also failed.`);
                }
            }
        }

        Logger.info(`🤖 Asking AI for a solution for ${description}...`);
        const aiSuggestedLocator = await AIAnalyzer.getAlternativeLocator(error.message);
        if (aiSuggestedLocator) {
            Logger.info(`🤖 AI Suggested Locator for ${description}: ${aiSuggestedLocator}`);
            await this.page.click(aiSuggestedLocator);
            LocatorStore.saveLocator(aiSuggestedLocator);
        } else {
            Logger.error(`🔥 AI-Healer could not resolve ${description} (${selector})`);
        }
    }
}

module.exports = AIHealer;
