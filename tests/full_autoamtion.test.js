/**
 * full_automation.test.js — Playwright-native E2E suite that exercises
 * the login → add-to-cart → checkout flow on saucedemo.com, a sample API
 * call, and (when DB credentials are present) a database smoke test.
 *
 * Phase 2 fix:
 *   `require('../utils/db ')` contained a trailing space in the module name,
 *   causing Node.js to throw MODULE_NOT_FOUND on startup.  The utility file
 *   it referenced (`utils/db.js`) does not exist at all — removed in favour of
 *   using DBClient directly through BaseTest, which already handles the pool
 *   and mTLS configuration correctly.
 */

const { test, expect } = require("@playwright/test");
const axios            = require("axios");

// ── 1. AI-generated test plan (illustrative) ──────────────────────────────
test.describe("Falcon Full Automation Suite", () => {

    // ── Login test ──────────────────────────────────────────────────────
    test("Login — standard_user can authenticate", async ({ page }) => {
        await page.goto("https://www.saucedemo.com/");
        await page.fill("#user-name", "standard_user");
        await page.fill("#password",  "secret_sauce");
        await page.click("[data-test='login-button']");

        await expect(page).toHaveURL(/inventory\.html/);
        await expect(page.locator(".inventory_list")).toBeVisible();
    });

    // ── Add to cart ─────────────────────────────────────────────────────
    test("Cart — add first product increments badge to 1", async ({ page }) => {
        await page.goto("https://www.saucedemo.com/");
        await page.fill("#user-name", "standard_user");
        await page.fill("#password",  "secret_sauce");
        await page.click("[data-test='login-button']");
        await page.waitForURL(/inventory\.html/);

        await page.locator("[data-test^='add-to-cart']").first().click();
        await expect(page.locator(".shopping_cart_badge")).toHaveText("1");
    });

    // ── API smoke ───────────────────────────────────────────────────────
    test("API — JSONPlaceholder /users returns HTTP 200", async () => {
        const response = await axios.get("https://jsonplaceholder.typicode.com/users");
        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
        expect(response.data.length).toBeGreaterThan(0);
    });

    // ── DB smoke (skipped when credentials are absent) ──────────────────
    test("DB — connectivity smoke test", async () => {
        const { DB_HOST, DB_USER } = process.env;
        if (!DB_HOST || !DB_USER) {
            test.skip();
            return;
        }

        // Lazy-import DBClient so tests without .env don't crash at parse time
        const DBClient = require("../src/core/DBClient");
        const db = new DBClient();
        try {
            const rows = await db.query("SELECT 1 AS ok");
            expect(rows[0].ok).toBe(1);
        } finally {
            await db.close();
        }
    });
});
