const BaseTest    = require("../../src/core/BaseTest");
const Logger      = require("../../utils/Logger");
const Middleware  = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");
const AIHealer    = require("../../src/core/AIHealer/AIHealer");

/**
 * CheckoutTest — end-to-end checkout scenario for saucedemo.com.
 *
 * Flow:
 *   1. Log in as standard_user
 *   2. Add the first product to the cart
 *   3. Open the cart and proceed to checkout
 *   4. Fill in shipping details
 *   5. Confirm the order and assert the success banner
 *
 * All interactions go through AIHealer so any selector drift is handled by
 * the three-tier self-healing chain automatically.
 */
class CheckoutTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);

        try {
            await this.setup();

            const page   = this.browserManager.page;
            const healer = new AIHealer(page);

            if (!page) throw new Error("❌ Browser page is not initialized!");

            Logger.info("🔹 Running Checkout Test with AI-Healing...");

            // ── Step 1: Login ─────────────────────────────────────────────
            await page.goto("https://www.saucedemo.com/", { waitUntil: "domcontentloaded" });
            await healer.healAndClick("#user-name",              "Username field");
            await page.fill("#user-name", "standard_user");
            await healer.healAndClick("#password",               "Password field");
            await page.fill("#password", "secret_sauce");
            await healer.healAndClick("[data-test='login-button']", "Login button");

            await page.waitForURL("**/inventory.html", { timeout: 8000 }).catch(() => {
                throw new Error(`Login failed — still on ${page.url()}`);
            });

            // ── Step 2: Add first product to cart ─────────────────────────
            Logger.info("🛒 Adding first product to cart...");
            const addToCart = page.locator("[data-test^='add-to-cart']").first();
            await addToCart.click({ timeout: 5000 });

            // Badge should increment to 1
            const badge = page.locator(".shopping_cart_badge");
            const count = await badge.textContent().catch(() => "0");
            if (count.trim() !== "1") {
                throw new Error(`Cart badge expected '1' but shows '${count.trim()}'`);
            }

            // ── Step 3: Open cart ──────────────────────────────────────────
            await healer.healAndClick(".shopping_cart_link", "Cart icon");
            await page.waitForURL("**/cart.html", { timeout: 5000 }).catch(() => {
                throw new Error(`Cart page did not load — still on ${page.url()}`);
            });

            // ── Step 4: Proceed to checkout ────────────────────────────────
            await healer.healAndClick("[data-test='checkout']", "Checkout button");
            await page.waitForURL("**/checkout-step-one.html", { timeout: 5000 }).catch(() => {
                throw new Error(`Checkout step-one did not load — still on ${page.url()}`);
            });

            // ── Step 5: Fill shipping details ──────────────────────────────
            Logger.info("📦 Filling shipping details...");
            await page.fill("[data-test='firstName']", "Test");
            await page.fill("[data-test='lastName']",  "User");
            await page.fill("[data-test='postalCode']", "12345");
            await healer.healAndClick("[data-test='continue']", "Continue button");

            await page.waitForURL("**/checkout-step-two.html", { timeout: 5000 }).catch(() => {
                throw new Error(`Checkout step-two did not load — still on ${page.url()}`);
            });

            // ── Step 6: Confirm order ──────────────────────────────────────
            await healer.healAndClick("[data-test='finish']", "Finish button");
            await page.waitForURL("**/checkout-complete.html", { timeout: 8000 }).catch(() => {
                throw new Error(`Order confirmation page did not load — still on ${page.url()}`);
            });

            const header = page.locator(".complete-header");
            const visible = await header.isVisible().catch(() => false);
            if (!visible) {
                throw new Error("Order confirmation header is not visible on /checkout-complete.html");
            }

            Logger.info(`✅ Checkout Test Passed — order confirmed on ${page.url()}`);
            this._results.push({ name: "UI Checkout", status: "passed" });
        } catch (error) {
            this._results.push({ name: "UI Checkout", status: "failed", error: error.message });
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            await this.teardown();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new CheckoutTest()).runTest();
