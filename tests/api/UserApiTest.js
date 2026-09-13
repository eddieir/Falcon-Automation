const BaseTest     = require("../../src/core/BaseTest");
const Logger       = require("../../utils/Logger");
const Middleware   = require("../../src/core/Middleware");
const ErrorHandler = require("../../src/core/ErrorHandler");

/**
 * UserApiTest — validates the JSONPlaceholder /users endpoint.
 *
 * Uses the framework's APIClient (axios wrapper) and BaseTest lifecycle so
 * results feed into ReportManager like any other Falcon test.
 *
 * Assertions:
 *   1. HTTP 200 response
 *   2. Response body is a non-empty array
 *   3. Every user object contains id, name, email, and username fields
 *   4. Email fields conform to a basic RFC-5322 format
 */
class UserApiTest extends BaseTest {
    async runTest() {
        await Middleware.beforeTest(this.testName);
        try {
            // API tests don't need a browser — skip browserManager.launch()
            this.reportManager.startRun();
            Logger.info("🔹 Running User API Test...");

            const BASE_URL = process.env.API_BASE_URL || "https://jsonplaceholder.typicode.com";

            // ── 1. List users ─────────────────────────────────────────────
            Logger.info(`📡 GET ${BASE_URL}/users`);
            const response = await this.apiClient.get(`${BASE_URL}/users`);

            if (response.status !== 200) {
                throw new Error(`Expected HTTP 200 but got ${response.status}`);
            }

            const users = response.data;
            if (!Array.isArray(users) || users.length === 0) {
                throw new Error("Response body is not a non-empty array");
            }

            Logger.info(`✅ Received ${users.length} users`);

            // ── 2. Schema validation ──────────────────────────────────────
            const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            for (const user of users) {
                const missing = ["id", "name", "email", "username"].filter((f) => !(f in user));
                if (missing.length > 0) {
                    throw new Error(`User id=${user.id} is missing fields: ${missing.join(", ")}`);
                }
                if (!EMAIL_RE.test(user.email)) {
                    throw new Error(`User id=${user.id} has invalid email: "${user.email}"`);
                }
            }

            // ── 3. Single user fetch ──────────────────────────────────────
            const firstId = users[0].id;
            Logger.info(`📡 GET ${BASE_URL}/users/${firstId}`);
            const single = await this.apiClient.get(`${BASE_URL}/users/${firstId}`);
            if (single.status !== 200 || single.data.id !== firstId) {
                throw new Error(`Single-user fetch for id=${firstId} failed or returned wrong record`);
            }

            Logger.info(`✅ User API Test Passed — all assertions met`);
            this._results.push({ name: "User API", status: "passed" });
        } catch (error) {
            this._results.push({ name: "User API", status: "failed", error: error.message });
            await ErrorHandler.handleError(this.testName, error);
        } finally {
            this.reportManager.generateReport({ tests: this._results });
            await Logger.flush();
            await Middleware.afterTest(this.testName);
        }
    }
}

(new UserApiTest()).runTest();
