const BaseTest = require("../../src/core/BaseTest");
const LoginPage = require("../../src/ui/pages/LoginPage");

class LoginTest extends BaseTest {
    async runTest() {
        await this.setup();
        console.log("🔹 Running UI Login Test...");

        const loginPage = new LoginPage(this.browserManager.page);
        await loginPage.open("https://www.saucedemo.com/");
        await loginPage.login("standard_user", "secret_sauce");

        await this.teardown();
    }
}

(new LoginTest()).runTest();
