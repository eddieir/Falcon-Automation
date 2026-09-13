const BaseTest = require("../../src/core/BaseTest");
const Logger = require("../../utils/Logger");
const Middleware = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");
const AIHealer = require("../../src/core/AIHealer/AIHealer");

/**
 * LoginTest — end-to-end login scenario for saucedemo.com.
 *
 * Fix (Phase 1 patch):
 *   `this.browserManager.page` was captured before `await this.setup()` ran.
 *   `setup()` calls `browserManager.launch()`, which is what creates the page —
 *   so the captured reference was always null, producing
 *   "❌ Browser page is not initialized!" on every run.
 *
 *   Fixed by moving the page reference inside the try block, after setup().
 */
class LoginTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);

        try {
            // setup() must run first — it calls browserManager.launch()
            // which creates this.browserManager.page
            await this.setup();

            const page = this.browserManager.page;
            const healer = new AIHealer(page);

            if (!page) {
                throw new Error("❌ Browser page is not initialized!");
            }

            Logger.info("🔹 Running UI Login Test with AI-Healing...");

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
            this._results.push({ name: "UI Login", status: "passed" });
        } catch (error) {
            this._results.push({ name: "UI Login", status: "failed", error: error.message });
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            await this.teardown();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new LoginTest()).runTest();
