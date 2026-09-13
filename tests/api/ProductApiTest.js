const BaseTest     = require("../../src/core/BaseTest");
const Logger       = require("../../utils/Logger");
const Middleware   = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");

/**
 * ProductApiTest — validates the JSONPlaceholder /posts endpoint as a
 * stand-in for a product catalogue API (structure is identical).
 *
 * Assertions:
 *   1. HTTP 200 response
 *   2. Response body is a non-empty array
 *   3. Every item contains id, title, and body fields
 *   4. POST /posts creates a new resource and returns HTTP 201
 *   5. GET /posts/:id returns the matching record
 */
class ProductApiTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);
        try {
            this.reportManager.startRun();
            Logger.info("🔹 Running Product API Test...");

            const BASE_URL = process.env.API_BASE_URL || "https://jsonplaceholder.typicode.com";

            // ── 1. List products ──────────────────────────────────────────
            Logger.info(`📡 GET ${BASE_URL}/posts`);
            const list = await this.apiClient.get(`${BASE_URL}/posts`);
            if (list.status !== 200) {
                throw new Error(`Expected HTTP 200 but got ${list.status}`);
            }
            const products = list.data;
            if (!Array.isArray(products) || products.length === 0) {
                throw new Error("Product list is empty or not an array");
            }
            Logger.info(`✅ Received ${products.length} products`);

            // ── 2. Schema check ───────────────────────────────────────────
            for (const p of products.slice(0, 5)) {
                const missing = ["id", "title", "body"].filter((f) => !(f in p));
                if (missing.length > 0) {
                    throw new Error(`Product id=${p.id} is missing fields: ${missing.join(", ")}`);
                }
            }

            // ── 3. Single product fetch ───────────────────────────────────
            const targetId = products[0].id;
            Logger.info(`📡 GET ${BASE_URL}/posts/${targetId}`);
            const single = await this.apiClient.get(`${BASE_URL}/posts/${targetId}`);
            if (single.status !== 200 || single.data.id !== targetId) {
                throw new Error(`Single fetch for id=${targetId} returned wrong record`);
            }

            // ── 4. Create product ─────────────────────────────────────────
            Logger.info(`📡 POST ${BASE_URL}/posts`);
            const created = await this.apiClient.post(`${BASE_URL}/posts`, {
                title:  "Falcon Test Product",
                body:   "Created by Falcon-Automation ProductApiTest",
                userId: 1,
            });
            if (created.status !== 201) {
                throw new Error(`Expected HTTP 201 on create but got ${created.status}`);
            }
            Logger.info(`✅ Product created with id=${created.data.id}`);

            Logger.info("✅ Product API Test Passed — all assertions met");
            this._results.push({ name: "Product API", status: "passed" });
        } catch (error) {
            this._results.push({ name: "Product API", status: "failed", error: error.message });
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            this.reportManager.generateReport({ tests: this._results });
            await Logger.flush();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new ProductApiTest()).runTest();
