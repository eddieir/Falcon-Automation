const Logger = require("../../../utils/Logger");
const LocatorStore = require("./LocatorStore");

class AIHealer {
    constructor(page) {
        this.page = page;
    }

    async healAndClick(selector, description = "Element") {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                Logger.info(`🔹 Attempt ${attempt}: Trying ${description} (${selector})`);
                await this.page.waitForSelector(selector, { timeout: 2000 });
                await this.page.click(selector);
                return;
            } catch (error) {
                Logger.warning(`⚠️ Attempt ${attempt} failed for ${description} (${selector})`);
                
                if (attempt === 3) {
                    Logger.error(`❌ All attempts failed for ${description}. Engaging AI-Healer.`);
                    await this.healSelector(selector, description);
                }
            }
        }
    }

    async healSelector(selector, description) {
        // Check if alternative locators exist
        const alternatives = LocatorStore.getAlternatives(selector);
        for (const altSelector of alternatives) {
            try {
                Logger.info(`🔹 Trying stored alternative: ${altSelector}`);
                await this.page.click(altSelector);
                return;
            } catch (err) {
                Logger.warning(`⚠️ Alternative locator ${altSelector} also failed.`);
            }
        }

        // AI-Healer predicts a new locator
        Logger.info(`🤖 Asking AI to fix locator: ${selector}...`);
        const aiSuggestedLocator = await this.getAlternativeSelector(selector);
        
        if (aiSuggestedLocator) {
            Logger.info(`🤖 AI Suggested Locator: ${aiSuggestedLocator}`);
            LocatorStore.addLocator(selector, aiSuggestedLocator);
            await this.page.click(aiSuggestedLocator);
        } else {
            Logger.error(`🔥 AI-Healer could not resolve ${description} (${selector})`);
        }
    }

    async getAlternativeSelector(originalSelector) {
        const alternativeSelectors = {
            "input[name='q']": "textarea[name='q']", // Example: Google search input change
            "button[name='Search']": "input[type='submit']"
        };

        return alternativeSelectors[originalSelector] || null;
    }
}

module.exports = AIHealer;
