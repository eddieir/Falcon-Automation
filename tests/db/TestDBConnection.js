const DBClient = require("../../core/DBClient");

class TestDBConnection {
    async runTest() {
        const db = new DBClient();
        try {
            const users = await db.query("SELECT * FROM users LIMIT 1");
            console.log("✅ Database Connection Successful!");
            console.log("User Data:", users);
        } catch (error) {
            console.error("❌ Database Connection Failed:", error.message);
        }
    }
}

(new TestDBConnection()).runTest();
