const BaseTest = require("../../src/core/BaseTest");
const Logger = require("../../utils/Logger");
const Middleware = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");
const AIHealer = require("../../src/core/AIHealer/AIHealer");

/**
 * LoginTest — end-to-end login scenario for saucedemo.com.
 *
 * Phase 1 fix:
 *   The test previously clicked the login button and immediately logged
 *   "✅ Login Test Passed" without verifying that the login actually
 *   succeeded.  A credential rejection, network error, or UI change would
 *   produce a false-positive green result — the worst class of test defect.
 *
 *   Fixed by adding two post-login assertions:
 *     1. URL check  — the app redirects to /inventory.html on success.
 *     2. Element check — the product list heading confirms the dashboard
 *        rendered correctly.
 *   If either assertion fails the test throws, triggering ErrorHandler and
 *   marking the run as failed rather than silently passing.
 */
class LoginTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);

        try {
            await this.setup();
            Logger.info("🔹 Running UI Login Test with AI-Healing...");

            const page = this.browserManager.page;
            if (!page) {
                throw new Error("❌ Browser page is not initialized!");
            }
            const healer = new AIHealer(page);

            // ── Navigate ──────────────────────────────────────────────────
            await page.goto("https://www.saucedemo.com/", { waitUntil: "domcontentloaded" });

            // ── Fill credentials ──────────────────────────────────────────
            await healer.healAndClick("#user-name");
            await page.fill("#user-name", "standard_user");

            await healer.healAndClick("#password");
            await page.fill("#password", "secret_sauce");

            // ── Submit ────────────────────────────────────────────────────
            await healer.healAndClick("[data-test='login-button']");

            // ── Post-login assertions ─────────────────────────────────────
            // 1. URL must change to the inventory page
            await page.waitForURL("**/inventory.html", { timeout: 8000 }).catch(() => {
                throw new Error(
                    `Login assertion failed: expected redirect to /inventory.html but URL is "${page.url()}". ` +
                    "Check credentials or application state."
                );
            });

            // 2. Product list must be visible — confirms full page render
            const productList = page.locator(".inventory_list");
            const isVisible = await productList.isVisible().catch(() => false);
            if (!isVisible) {
                throw new Error(
                    "Login assertion failed: /inventory.html loaded but .inventory_list is not visible. " +
                    "The application may be in an error state."
                );
            }

            Logger.info(`✅ Login Test Passed — landed on ${page.url()}`);
        } catch (error) {
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            await this.teardown();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new LoginTest()).runTest();
