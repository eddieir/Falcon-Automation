const http   = require("http");
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");
const Logger = require("../../utils/Logger");
const HealingTrust  = require("./AIHealer/HealingTrust");
const HealingReport = require("./AIHealer/HealingReport");

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
        this._socketConnectAttempts = new Map(); // ip → recent connection-attempt timestamps
    }

    /**
     * Simple in-memory sliding-window limiter for socket.io connection
     * attempts, mirroring the HTTP rate limiter below for the same reason:
     * the auth handshake is just as brute-forceable as POST /emit if it's
     * not throttled, and express-rate-limit only covers Express routes, not
     * socket.io's own handshake. No new dependency needed for this — it's a
     * handful of lines, scoped to exactly one thing.
     */
    _isSocketRateLimited(ip) {
        const WINDOW_MS = 60_000;
        const MAX_ATTEMPTS = 120;
        const now = Date.now();
        const attempts = (this._socketConnectAttempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
        attempts.push(now);
        this._socketConnectAttempts.set(ip, attempts);
        return attempts.length > MAX_ATTEMPTS;
    }

    /** Extract a token from either the X-Dashboard-Token header or a ?token= query param. */
    _tokenFromRequest(req) {
        return req.headers["x-dashboard-token"] || req.query?.token || null;
    }

    /**
     * True if `candidate` matches the configured token. No-op (always true)
     * when auth is off. Uses a timing-safe comparison — a plain `===` leaks
     * how many leading characters matched via response-time differences,
     * which matters for an auth token even if the practical exploit window
     * over a network is narrow. The length check up front is safe to do in
     * variable time (length isn't the secret; the token's content is), and
     * is required anyway since timingSafeEqual throws on mismatched buffer
     * lengths rather than returning false.
     */
    _isAuthorized(candidate) {
        if (!this._token) return true;
        if (typeof candidate !== "string") return false;
        const received = Buffer.from(candidate);
        const expected = Buffer.from(this._token);
        return received.length === expected.length && crypto.timingSafeEqual(received, expected);
    }

    /** The URL to actually open — includes ?token= when auth is enabled. */
    get url() {
        const base = `http://localhost:${this.port}`;
        return this._token ? `${base}/?token=${encodeURIComponent(this._token)}` : base;
    }

    /**
     * Start the HTTP + WebSocket server and print the dashboard URL.
     */
    async start() {
        // Lazy-require to avoid crashing processes that don't need the dashboard
        const express   = require("express");
        const socketIO  = require("socket.io");
        const rateLimit = require("express-rate-limit");
        const Middleware = require("./Middleware");

        const app = express();
        app.use(express.json());
        app.use(express.static(path.join(__dirname, "..", "dashboard")));

        // Phase 7 follow-up — CodeQL correctly flagged that the two routes
        // below perform authorization but had no rate limiting: with no cap
        // on attempts, DASHBOARD_TOKEN could be brute-forced by hammering
        // either endpoint. Applied before the auth check so it throttles
        // attempts generally, not just successful ones. 120/min is generous
        // for real dashboard traffic (a test run's worth of /emit calls is
        // nowhere near that) while still bounding how fast a token can be
        // guessed.
        const authLimiter = rateLimit({
            windowMs: 60_000,
            max: 120,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: "Too many requests — slow down." },
        });

        app.get("/events", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            res.json(this._events);
        });

        // Lets a separate `node` process (e.g. tests/ui/LoginTest.js run on
        // its own) report into this already-running dashboard by POSTing
        // here — see Middleware.emit()'s DASHBOARD_URL fallback.
        app.post("/emit", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            const { name, payload } = req.body || {};
            if (typeof name === "string") {
                this.emit(name, payload || {});
            }
            res.status(204).end();
        });

        // Phase 8 — healing trust gate. Same token gate and rate limiter as
        // /emit and /events above: these read and act on the audit trail of
        // AI-suggested selector fixes, so they get exactly the same
        // protection as everything else that can read or write run state.
        app.get("/healing/pending", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            res.json(HealingTrust.list());
        });

        app.get("/healing/trend", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            res.json(HealingReport.summary());
        });

        app.post("/healing/approve", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            const { original } = req.body || {};
            const decision = typeof original === "string" ? HealingTrust.approve(original, { approvedBy: "dashboard" }) : null;
            if (!decision) return res.status(404).json({ error: "No pending healing entry for that selector." });
            res.json(decision);
        });

        app.post("/healing/reject", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            const { original } = req.body || {};
            const decision = typeof original === "string" ? HealingTrust.reject(original, { rejectedBy: "dashboard" }) : null;
            if (!decision) return res.status(404).json({ error: "No pending healing entry for that selector." });
            res.json(decision);
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
            if (this._isSocketRateLimited(socket.handshake.address)) {
                return next(new Error("Too many connection attempts — slow down."));
            }
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
        this._emitter = (name, payload) => this.emit(name, payload);
        Middleware.setEmitter(this._emitter);
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
        const Middleware = require("./Middleware");
        if (Middleware._emitter === this._emitter) Middleware.setEmitter(null);
        if (this._io) {
            const io = this._io;
            this._io = null;
            await new Promise(resolve => io.close(resolve));
        }
        if (this._server?.listening) {
            await new Promise(resolve => this._server.close(resolve));
        }
        this._server = null;
    }
}

module.exports = Dashboard;
