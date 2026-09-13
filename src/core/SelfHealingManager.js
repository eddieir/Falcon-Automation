const Logger   = require("../../utils/Logger");
const AIHelper = require("../../utils/AIHelper");

/**
 * SelfHealingManager — page-level click helper with retry and AI fallback.
 *
 * Phase 2 fixes:
 *
 * 1. `this.baseTest` was never set in the constructor, but `safeClick()` called
 *    `this.baseTest.captureScreenshot()` and `this.baseTest.logTestResult()`
 *    on failure, producing `TypeError: Cannot read properties of undefined`.
 *    These calls have been removed; screenshot capture belongs in BaseTest /
 *    ErrorHandler, not in a low-level click helper.
 *
 * 2. Replaced `console.log/warn/error` with `Logger.*` so messages flow through
 *    the async-safe logging pipeline and appear in execution.log.
 *
 * Note: for new test code prefer `AIHealer.healAndClick()` which supports the
 * full three-tier chain.  SelfHealingManager remains for pages in `src/ui/`
 * that use the POM pattern and have not yet been migrated.
 */
class SelfHealingManager {
    constructor(page) {
        this.page          = page;
        this.retryAttempts = 3;
    }

    /**
     * Attempt to click `selector` with up to `this.retryAttempts` tries.
     * On each failure, the next selector from `alternativeSelectors` is tried.
     * If all selectors are exhausted, an AI suggestion is logged and the error
     * is re-thrown so the calling test can handle it.
     *
     * @param {string}   selector              - Primary CSS selector
     * @param {string[]} alternativeSelectors  - Fallback selectors (shifted on failure)
     */
    async safeClick(selector, alternativeSelectors = []) {
        let current = selector;

        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                Logger.info(`🔹 Attempting to click: ${current} (Attempt ${attempt}/${this.retryAttempts})`);
                await this.page.waitForSelector(current, { timeout: 2000 });
                await this.page.click(current);
                return;
            } catch (error) {
                Logger.warning(`⚠️ Failed to click: ${current} — ${error.message}`);

                if (alternativeSelectors.length > 0) {
                    current = alternativeSelectors.shift();
                    Logger.info(`🔄 Switching to alternative selector: ${current}`);
                } else {
                    Logger.error(`❌ All selectors exhausted for original: ${selector}`);
                    await this.handleFailure(error, selector);
                    throw error;
                }
            }
        }
    }

    async handleFailure(error, selector) {
        Logger.error(`🔥 Click failed on: ${selector}`);
        const suggestion = await AIHelper.getFixSuggestion(error.message);
        if (suggestion) {
            Logger.info(`🤖 AI Suggestion: ${suggestion}`);
        }
    }
}

module.exports = SelfHealingManager;
