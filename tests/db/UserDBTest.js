const BaseTest = require("../../src/core/BaseTest");

class UserDBTest extends BaseTest {
    async runTest() {
        await this.setup();
        console.log("🔹 Running DB Test...");

        const users = await this.dbClient.query("SELECT * FROM users WHERE username = ?", ["test_user"]);
        if (users.length > 0) {
            console.log("✅ User exists in the database:", users[0]);
        } else {
            console.error("❌ User not found in database!");
        }

        await this.teardown();
    }
}

(new UserDBTest()).runTest();
