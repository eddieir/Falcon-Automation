const BaseTest = require("../../src/core/BaseTest");
const Logger = require("../../utils/Logger");

class LoginTest extends BaseTest {
    async runTest() {
        await this.setup();
        Logger.info("Running UI Login Test...");

        try {
            await this.browserManager.page.goto("https://www.saucedemo.com/");
            await this.browserManager.page.fill("#user-name", "standard_user");
            await this.browserManager.page.fill("#password", "secret_sauce");
            await this.browserManager.page.click("[data-test='login-button']");

            Logger.info("✅ Login Test Passed!");
        } catch (error) {
            Logger.error(`❌ Login Test Failed! Error: ${error.message}`);
        }

        await this.teardown();
    }
}

(new LoginTest()).runTest();
