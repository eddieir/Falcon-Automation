class Middleware {
    static async beforeTest(testName) {
        console.log(`🔹 [Middleware] Preparing test environment for: ${testName}`);
    }

    static async afterTest(testName) {
        console.log(`🔹 [Middleware] Cleaning up after: ${testName}`);
    }
}

module.exports = Middleware;
