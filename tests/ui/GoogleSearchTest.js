const BaseTest = require("../../src/core/BaseTest");
const Logger = require("../../utils/Logger");
const Middleware = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");
const AIHealer = require("../../src/core/AIHealer/AIHealer");

class GoogleSearchTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);
        const healer = new AIHealer(this.browserManager.page);

        try {
            await this.setup();
            Logger.info("🔹 Running Google Search Test with AI-Healing...");

            if (!this.browserManager.page) {
                throw new Error("❌ Browser page is not initialized!");
            }

            await this.browserManager.page.goto("https://www.google.com");

            // Using a more reliable search box selector
            await healer.healAndClick("textarea[name='q']", "Search Box");
            await this.browserManager.page.fill("textarea[name='q']", "Best automation courses");
            await this.browserManager.page.keyboard.press("Enter");

            // Wait for search results to appear
            await this.browserManager.page.waitForSelector("#search", { timeout: 5000 });

            // Click on the first search result
            await healer.healAndClick("h3", "First Search Result");

            Logger.info("✅ Google Search Test Passed with AI-Healer!");
        } catch (error) {
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            await this.teardown();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new GoogleSearchTest()).runTest();
