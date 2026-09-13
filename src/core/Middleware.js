const Logger = require("../../utils/Logger");

/**
 * Middleware — lifecycle hooks executed before and after each test.
 *
 * Phase 3: replaced console.log with Logger so hook output lands in the
 * execution log consistently with all other framework output.
 * Added optional event emission so the live dashboard can track test lifecycle.
 */
class Middleware {
    static async beforeTest(testName) {
        Logger.info(`🔹 [Middleware] Preparing test environment for: ${testName}`);
        if (Middleware._emitter) {
            Middleware._emitter("testStart", { testName, timestamp: Date.now() });
        }
    }

    static async afterTest(testName) {
        Logger.info(`🔹 [Middleware] Cleaning up after: ${testName}`);
        if (Middleware._emitter) {
            Middleware._emitter("testEnd", { testName, timestamp: Date.now() });
        }
    }

    /**
     * Register a dashboard event emitter.
     * Called by Dashboard.js so middleware events reach the live UI.
     * @param {Function} emitFn - (eventName, payload) => void
     */
    static setEmitter(emitFn) {
        Middleware._emitter = emitFn;
    }
}

Middleware._emitter = null;

module.exports = Middleware;
