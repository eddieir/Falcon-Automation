const BaseTest = require("../../src/core/BaseTest");
const Logger = require("../../utils/Logger");
const Middleware = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");
const AIHealer = require("../../src/core/AIHealer/AIHealer");

/**
 * GoogleSearchTest — end-to-end search scenario for google.com.
 *
 * Phase 2 fix:
 *   The AIHealer was instantiated before `await this.setup()` ran — identical
 *   to the Phase 1 bug in LoginTest.  `setup()` calls `browserManager.launch()`,
 *   which is what creates the page.  Constructing AIHealer before launch gives
 *   it a null page reference, so every `healAndClick()` call throws.
 *
 *   Fixed by moving both the `page` capture and the AIHealer constructor to
 *   inside the try block, after `await this.setup()`.
 */
class GoogleSearchTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);

        try {
            // setup() must run first — it calls browserManager.launch()
            await this.setup();

            const page   = this.browserManager.page;
            const healer = new AIHealer(page);

            if (!page) {
                throw new Error("❌ Browser page is not initialized!");
            }

            Logger.info("🔹 Running Google Search Test with AI-Healing...");

            await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" });

            // ── Search ────────────────────────────────────────────────────
            await healer.healAndClick("textarea[name='q']", "Search Box");
            await page.fill("textarea[name='q']", "Best automation courses");
            await page.keyboard.press("Enter");

            // ── Post-search assertions ────────────────────────────────────
            // 1. Results container must appear
            await page.waitForSelector("#search", { timeout: 8000 }).catch(() => {
                throw new Error(
                    "Search assertion failed: #search container did not appear within 8 s. " +
                    "Google may have changed its DOM or blocked the request."
                );
            });

            // 2. At least one organic result heading must be visible
            const firstResult = page.locator("h3").first();
            const hasResults  = await firstResult.isVisible().catch(() => false);
            if (!hasResults) {
                throw new Error(
                    "Search assertion failed: #search loaded but no <h3> headings found. " +
                    "Results page may be in an unexpected state."
                );
            }

            Logger.info(`✅ Google Search Test Passed — results visible on ${page.url()}`);
        } catch (error) {
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            await this.teardown();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new GoogleSearchTest()).runTest();
