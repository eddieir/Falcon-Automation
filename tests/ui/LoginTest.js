const BaseTest = require("../../src/core/BaseTest");
const Logger = require("../../utils/Logger");
const Middleware = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");

class LoginTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);

        try {
            await this.setup();
            console.log("🔹 Running UI Login Test...");

            if (!this.browserManager.page) {
                throw new Error("❌ Browser page is not initialized!");
            }

            await this.browserManager.page.goto("https://www.saucedemo.com/");
            await this.browserManager.page.fill("#user-name", "standard_user");
            await this.browserManager.page.fill("#password", "secret_sauce");
            await this.browserManager.page.click("[data-test='login-button']");

            console.log("✅ Login Test Passed!");
        } catch (error) {
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            await this.teardown();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new LoginTest()).runTest();