const BaseTest = require("../../src/core/BaseTest");
const LoginPage = require("../../src/ui/pages/LoginPage");
const { chromium } = require("playwright");
class LoginTest extends BaseTest {
    async runTest() {
        //await this.setup();
        console.log("🔹 Running UI Login Test with Self-Healing...");

        const browser = await chromium.launch({ headless: false });
        const page = await browser.newPage();
        this.page = page;

        const selfHealer = new SelfHealingManager(page, this);
        const loginPage = new LoginPage(page, selfHealer);

        try {
            await loginPage.open("https://www.saucedemo.com/");
            await loginPage.login("standard_user", "secret_sauce");
            await this.logTestResult("PASSED");
        } catch (error) {
            await this.captureScreenshot();
            await this.logTestResult("FAILED", error.message);
        } finally {
            await browser.close();
        }
    }
}

(new LoginTest()).runTest();
