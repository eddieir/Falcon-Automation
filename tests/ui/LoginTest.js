const BaseTest = require("../../src/core/BaseTest");
const Logger = require("../../utils/Logger");
const Middleware = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");
const AIHealer = require("../../src/core/AIHealer/AIHealer");

class LoginTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);
        const healer = new AIHealer(this.browserManager.page); // AI-Healer Instance

        try {
            await this.setup();
            Logger.info("🔹 Running UI Login Test with AI-Healing...");

            if (!this.browserManager.page) {
                throw new Error("❌ Browser page is not initialized!");
            }

            await this.browserManager.page.goto("https://www.saucedemo.com/");

            await healer.healAndClick("#user-name");
            await this.browserManager.page.fill("#user-name", "standard_user");

            await healer.healAndClick("#password");
            await this.browserManager.page.fill("#password", "secret_sauce");

            await healer.healAndClick("[data-test='login-button']");
            Logger.info("✅ Login Test Passed with AI-Healer!");
        } catch (error) {
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            await this.teardown();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new LoginTest()).runTest();
