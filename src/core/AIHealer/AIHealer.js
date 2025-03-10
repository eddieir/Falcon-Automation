const LocatorStore = require("./LocatorStore");
const AIAnalyzer = require("./AIAnalyzer");
const AdaptiveRetry = require("./AdaptiveRetry");
const HealingReport = require("./HealingReport");
const Logger = require("../../utils/Logger");

class AIHealer {
    constructor(page) {
        this.page = page;
        this.retryAttempts = 3; // Configurable retry count
    }

    async healAndClick(selector) {
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                Logger.info(`🔹 Attempt ${attempt}: Trying to click ${selector}`);
                await this.page.waitForSelector(selector, { timeout: 2000 });
                await this.page.click(selector);
                LocatorStore.saveLocator(selector);
                return;
            } catch (error) {
                Logger.warning(`⚠️ Failed attempt ${attempt} to click ${selector}`);

                if (attempt === this.retryAttempts) {
                    Logger.error(`❌ All attempts failed for ${selector}. Engaging AI-Healer.`);
                    await this.healSelector(selector, error);
                }
            }
        }
    }

    async healSelector(selector, error) {
        const alternativeLocators = LocatorStore.getPreviousLocators(selector);
        if (alternativeLocators.length > 0) {
            Logger.info(`🔄 Trying stored alternative locators for ${selector}`);
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

        Logger.info(`🤖 Asking AI for a solution...`);
        const aiSuggestedLocator = await AIAnalyzer.getAlternativeLocator(error.message);
        if (aiSuggestedLocator) {
            Logger.info(`🤖 AI Suggested Locator: ${aiSuggestedLocator}`);
            await this.page.click(aiSuggestedLocator);
            LocatorStore.saveLocator(aiSuggestedLocator);
        } else {
            Logger.error(`🔥 AI-Healer could not resolve ${selector}`);
        }
    }
}

module.exports = AIHealer;
