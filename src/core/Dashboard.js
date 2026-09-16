const http   = require("http");
const path   = require("path");
const fs     = require("fs");
const Logger = require("../../utils/Logger");

/**
 * Dashboard — real-time test execution monitor.
 *
 * Phase 3 feature: express + socket.io were already installed as dependencies
 * but were never connected to any code path.  This module wires them into a
 * localhost web server that streams every test event (start, pass, fail, skip,
 * healing, explorer page) to a browser dashboard in real time.
 *
 * Usage:
 *   const Dashboard = require('./src/core/Dashboard');
 *   const dashboard = new Dashboard();
 *   await dashboard.start();            // opens http://localhost:3000
 *
 *   dashboard.emit('testPass', { name: 'Login', duration: 1234 });
 *   dashboard.emit('healingEvent', { original: '#btn', resolved: '[data-test]' });
 *
 *   await dashboard.stop();             // graceful shutdown
 *
 * The dashboard also registers itself as the Middleware emitter so lifecycle
 * events (testStart / testEnd) fire automatically without any call-site changes.
 *
 * Phase 7 — auth hardening.
 *   Previously `POST /emit`, `GET /events`, and every socket.io connection
 *   were wide open with `cors: { origin: "*" }` — anyone who could reach the
 *   port could read every test result and healing event, or inject fake
 *   ones. Fine for a single laptop; not fine the moment this is pointed at
 *   from CI or a shared environment (see the Phase 6 DASHBOARD_URL flow).
 *
 *   When `DASHBOARD_TOKEN` is set, `POST /emit` and `GET /events` require it
 *   via an `X-Dashboard-Token` header or a `?token=` query param, and the
 *   socket.io handshake requires it via `auth: { token }` — an unauthorized
 *   socket connection is rejected outright (`connect_error`), not silently
 *   allowed through with no data. CORS is also restricted from `"*"` to
 *   `DASHBOARD_ALLOWED_ORIGIN` (default: this dashboard's own localhost
 *   origin — same-origin requests, which is how the bundled UI talks to it,
 *   are unaffected either way since CORS only governs cross-origin access).
 *
 *   When `DASHBOARD_TOKEN` is unset — the default, unchanged local-dev
 *   experience — none of this activates, but `start()` logs a loud warning
 *   so running unauthenticated isn't an accident nobody notices.
 */
class Dashboard {
    /**
     * @param {Object} opts
     * @param {number} [opts.port=3000] - HTTP port to listen on
     */
    constructor({ port = 3000 } = {}) {
        this.port    = port;
        this._events = []; // full history so late-joining tabs get replay
        this._io     = null;
        this._server = null;
        this._token  = process.env.DASHBOARD_TOKEN || null;
    }

    /** Extract a token from either the X-Dashboard-Token header or a ?token= query param. */
    _tokenFromRequest(req) {
        return req.headers["x-dashboard-token"] || req.query?.token || null;
    }

    /** True if `candidate` matches the configured token. No-op (always true) when auth is off. */
    _isAuthorized(candidate) {
        if (!this._token) return true;
        return candidate === this._token;
    }

    /** The URL to actually open — includes ?token= when auth is enabled. */
    get url() {
        const base = `http://localhost:${this.port}`;
        return this._token ? `${base}/?token=${this._token}` : base;
    }

    /**
     * Start the HTTP + WebSocket server and print the dashboard URL.
     */
    async start() {
        // Lazy-require to avoid crashing processes that don't need the dashboard
        const express   = require("express");
        const socketIO  = require("socket.io");
        const Middleware = require("./Middleware");

        const app = express();
        app.use(express.json());
        app.use(express.static(path.join(__dirname, "..", "dashboard")));

        app.get("/events", (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            res.json(this._events);
        });

        // Lets a separate `node` process (e.g. tests/ui/LoginTest.js run on
        // its own) report into this already-running dashboard by POSTing
        // here — see Middleware.emit()'s DASHBOARD_URL fallback.
        app.post("/emit", (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            const { name, payload } = req.body || {};
            if (typeof name === "string") {
                this.emit(name, payload || {});
            }
            res.status(204).end();
        });

        const allowedOrigin = process.env.DASHBOARD_ALLOWED_ORIGIN || `http://localhost:${this.port}`;

        this._server = http.createServer(app);
        this._io     = new socketIO.Server(this._server, {
            cors: { origin: allowedOrigin },
        });

        // Reject unauthorized connections outright (fires `connect_error` on
        // the client) rather than letting them through with no data — an
        // unauthenticated socket never even reaches the "connection" handler.
        this._io.use((socket, next) => {
            const candidate = socket.handshake.auth?.token;
            if (this._isAuthorized(candidate)) return next();
            next(new Error("Unauthorized — missing or invalid DASHBOARD_TOKEN."));
        });

        this._io.on("connection", (socket) => {
            // Replay full history so the new client sees everything
            socket.emit("replay", this._events);
        });

        await new Promise((resolve, reject) => {
            this._server.once("error", reject);
            this._server.listen(this.port, () => {
                this._server.removeListener("error", reject);
                // Reflect the OS-assigned port back onto `this.port` — matters
                // when the caller passed 0 (ephemeral port), otherwise `url`
                // below would print the requested port (0) instead of the
                // real one actually listening.
                this.port = this._server.address().port;
                resolve();
            });
        });

        Logger.info(`🖥  Dashboard → ${this.url}`);
        if (!this._token) {
            Logger.warning(
                "⚠️  Dashboard running WITHOUT auth (DASHBOARD_TOKEN not set) — " +
                "anyone who can reach this port can read and write test events. " +
                "Fine for a local laptop; set DASHBOARD_TOKEN before exposing this beyond localhost."
            );
        }

        // Wire Middleware lifecycle events into the dashboard
        Middleware.setEmitter((name, payload) => this.emit(name, payload));
    }

    /**
     * Emit an event to all connected dashboard tabs and append to history.
     * @param {string} name - Event name (testStart, testPass, testFail, …)
     * @param {Object} payload
     */
    emit(name, payload = {}) {
        const event = { name, payload, timestamp: Date.now() };
        this._events.push(event);
        if (this._io) {
            this._io.emit("event", event);
        }
    }

    /** Gracefully shut down the HTTP server. */
    async stop() {
        if (this._server) {
            await new Promise((resolve) => this._server.close(resolve));
            Logger.info("🛑 Dashboard stopped.");
        }
    }
}

module.exports = Dashboard;
