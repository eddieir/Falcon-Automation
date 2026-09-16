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
 *
 * Phase 7 fix — cookie-consent overlay blocked every run.
 *   This test has never run in CI (see README/HANDOFF known issues), and
 *   running it locally for the first time to verify it before wiring it in
 *   showed it failing every time: Tier 1 exhausted all 3 attempts on
 *   `textarea[name='q']`, then Tier 3 also failed (no OPENAI_API_KEY
 *   locally). The element exists in the DOM the whole time — it's covered
 *   by Google's cookie-consent dialog, which google.com renders on a fresh
 *   browser profile depending on the request's apparent region (confirmed
 *   locally: an Italian-language "Prima di continuare su Google" overlay).
 *   AIHealer can't fix this — it's not a broken selector, it's a real
 *   dialog obscuring a real, correct one.
 *
 *   Fixed by dismissing the consent dialog before searching, if present.
 *   Uses Google's "Accept all" button by its `id` (`L2AGLb`) rather than by
 *   visible text — the id is stable across locales (confirmed against the
 *   Italian-language dialog above), where text like "Accetta tutto" /
 *   "Accept all" is not. Wrapped in a short timeout + catch: some regions
 *   or already-cookied profiles never show this dialog at all, and that's
 *   not an error.
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

            // ── Dismiss cookie-consent dialog, if Google shows one ──────────
            // Locale-dependent, so this doesn't always appear — that's fine.
            await page.locator("#L2AGLb").click({ timeout: 3000 }).catch(() => {
                Logger.info("ℹ️  No cookie-consent dialog to dismiss (or already accepted).");
            });

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
            this._results.push({ name: "Google Search", status: "passed" });
        } catch (error) {
            this._results.push({ name: "Google Search", status: "failed", error: error.message });
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            await this.teardown();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new GoogleSearchTest()).runTest();
