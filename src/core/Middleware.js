const http   = require("http");
const https  = require("https");
const Logger = require("../../utils/Logger");

/**
 * Middleware — lifecycle hooks executed before and after each test, and the
 * shared event-emission point used by HealingReport for healing events too.
 *
 * Phase 3: replaced console.log with Logger so hook output lands in the
 * execution log consistently with all other framework output.
 *
 * Post-merge fix: individual test files (tests/ui/LoginTest.js, etc.) each
 * run in their own `node` process, so an in-process emitter registered by
 * Dashboard.start() (used by `node falcon.js`) never reaches them — the
 * dashboard never received a single testStart/testEnd/healingEvent from that
 * workflow. Middleware.emit() now falls back to an HTTP POST to
 * `${DASHBOARD_URL}/emit` when no in-process emitter is set, so a standalone
 * test process can report to an already-running `node falcon.js` dashboard
 * by setting DASHBOARD_URL=http://localhost:3000. Best-effort: failures
 * (dashboard not running) are swallowed so tests never depend on it.
 *
 * Phase 7: if DASHBOARD_TOKEN is also set, it's sent as an X-Dashboard-Token
 * header on this POST — a dashboard running with auth enabled rejects the
 * request otherwise. No effect when the dashboard has no token configured.
 */
class Middleware {
    static async beforeTest(testName) {
        Logger.info(`🔹 [Middleware] Preparing test environment for: ${testName}`);
        Middleware.emit("testStart", { testName, timestamp: Date.now() });
    }

    static async afterTest(testName) {
        Logger.info(`🔹 [Middleware] Cleaning up after: ${testName}`);
        Middleware.emit("testEnd", { testName, timestamp: Date.now() });
    }

    /**
     * Emit a dashboard event. Uses the in-process emitter if one is
     * registered (same-process Dashboard, e.g. falcon.js); otherwise, if
     * DASHBOARD_URL is set, best-effort POSTs to a running dashboard's
     * HTTP API. No-ops silently if neither is available.
     * @param {string} name
     * @param {Object} payload
     */
    static emit(name, payload = {}) {
        if (Middleware._emitter) {
            Middleware._emitter(name, payload);
            return;
        }

        const dashboardUrl = process.env.DASHBOARD_URL;
        if (!dashboardUrl) return;

        try {
            const url    = new URL("/emit", dashboardUrl);
            const client = url.protocol === "https:" ? https : http;
            const body   = JSON.stringify({ name, payload });
            const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) };
            if (process.env.DASHBOARD_TOKEN) {
                headers["X-Dashboard-Token"] = process.env.DASHBOARD_TOKEN;
            }
            const req = client.request(
                url,
                {
                    method: "POST",
                    headers,
                    timeout: 1000,
                },
                (res) => res.resume() // drain, don't care about the response body
            );
            req.on("error", () => {}); // dashboard not running — ignore
            req.on("timeout", () => req.destroy());
            req.write(body);
            req.end();
        } catch {
            // malformed DASHBOARD_URL or similar — never let this break a test run
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
