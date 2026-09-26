const http   = require("http");
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");
const Logger = require("../../utils/Logger");
const HealingTrust  = require("./AIHealer/HealingTrust");
const HealingReport = require("./AIHealer/HealingReport");
const FlakinessTracker = require("./FlakinessTracker");
const ConfigManager = require("./ConfigManager");
const { validateIntSetting } = require("./util/ConfigValidation");

const HEALING_PENDING_STALE_DAYS_DEFAULT = 14;
const FLAKY_UNREVIEWED_STALE_DAYS_DEFAULT = 14;
const REHAB_CANDIDATE_WINDOW_DEFAULT = 5;

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
        this._sweep  = Dashboard._emptySweep();
    }

    /**
     * Phase 10 — whole-app coverage.
     *
     * A sweep's coverage state is maintained separately from `_events` for two
     * reasons. First, a tab that joins halfway through a 20-page sweep needs
     * the aggregate immediately rather than replaying the feed and re-deriving
     * it. Second — and this is the point of the feature — the pages Falcon
     * deliberately did *not* cover have nowhere to live in a flat event feed:
     * nothing happened on them, so nothing streams. They only exist as state.
     *
     * `pages` is keyed by URL so a page that reports twice (a pageStart
     * followed by its pageComplete) updates in place rather than duplicating.
     */
    static _emptySweep() {
        return {
            entryUrl: null,
            currentUrl: null,
            announcedTotal: 0, // highest `total` any pageStart has claimed
            budgetExhausted: false,
            pages: new Map(),
        };
    }

    /** Coerce an untrusted numeric field to a finite number, or undefined. */
    static _num(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    }

    /**
     * Resolve a small integer setting via ConfigManager, validated by
     * ConfigValidation.validateIntSetting — `null`/`undefined` (not set)
     * falls back to `fallback`; anything else must be a valid integer in
     * `bounds` or this throws (`.code === "INVALID_CONFIG"`), which every
     * caller turns into a 500 naming the offending setting rather than a
     * crashed process.
     */
    static _resolveIntSetting(name, bounds, fallback) {
        return validateIntSetting(name, ConfigManager.get(name), bounds) ?? fallback;
    }

    /**
     * Fold one page record into the sweep, preserving fields an earlier event
     * already established — pageStart carries `index` and `total`, pageComplete
     * carries the results, and neither repeats what the other said.
     */
    _upsertPage(url, fields) {
        if (typeof url !== "string" || !url) return;
        const existing = this._sweep.pages.get(url) || { url };
        const merged = { ...existing };
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined) merged[key] = value;
        }
        this._sweep.pages.set(url, merged);
    }

    /**
     * Update coverage state from a sweep event. Every field is treated as
     * untrusted: these payloads can arrive over POST /emit from a separate
     * process, so a malformed one must degrade the panel, never throw inside
     * emit() and take the whole event stream down with it.
     */
    _recordSweepEvent(name, payload) {
        if (!payload || typeof payload !== "object") return;

        if (name === "pageStart") {
            const index = Dashboard._num(payload.index);
            // The sweep contract numbers pages from 1, so an index of 1 means a
            // new sweep has started — the previous run's pages must not linger
            // and inflate the coverage counts.
            if (index !== undefined && index <= 1 && this._sweep.pages.size > 0) {
                this._sweep = Dashboard._emptySweep();
            }
            const total = Dashboard._num(payload.total);
            if (total !== undefined) this._sweep.announcedTotal = Math.max(this._sweep.announcedTotal, total);
            if (!this._sweep.entryUrl && typeof payload.url === "string") this._sweep.entryUrl = payload.url;
            this._sweep.currentUrl = typeof payload.url === "string" ? payload.url : null;
            this._upsertPage(payload.url, { index, status: "testing" });
            return;
        }

        if (name === "pageComplete") {
            const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : {};
            const results = Array.isArray(summary.results) ? summary.results : [];
            const tally = (status) => results.filter((r) => r && r.status === status).length;
            // Prefer counts the sweep computed itself; fall back to tallying the
            // raw results so a summary that only ships `results` still renders.
            const countOf = (explicit, status) => Dashboard._num(explicit) ?? (results.length ? tally(status) : undefined);
            if (this._sweep.currentUrl === payload.url) this._sweep.currentUrl = null;
            if (summary.reason === "budget-exhausted") this._sweep.budgetExhausted = true;
            this._upsertPage(payload.url, {
                status: typeof summary.status === "string" ? summary.status : "tested",
                reason: typeof summary.reason === "string" ? summary.reason : undefined,
                passed: countOf(summary.passed, "passed"),
                failed: countOf(summary.failed, "failed"),
                skipped: countOf(summary.skipped, "skipped"),
                quarantined: countOf(summary.quarantined, "quarantined"),
                deduped: countOf(summary.deduped, "deduped"),
                scenariosGenerated: Dashboard._num(summary.scenariosGenerated),
                scenariosDeduplicated: Dashboard._num(summary.scenariosDeduplicated),
                uiIssues: Array.isArray(summary.uiIssues) ? summary.uiIssues.length : Dashboard._num(summary.uiIssues),
                durationMs: Dashboard._num(summary.durationMs),
            });
            return;
        }

        // Optional reconciliation. Pages the sweep skipped or never reached emit
        // no per-page events at all — there is nothing to report on a page that
        // was never opened — so the only way the panel can name them is from the
        // final SweepResult. Handled defensively: if the run never sends one,
        // the panel still shows everything the page events established.
        if (name === "sweepComplete") {
            if (typeof payload.entryUrl === "string") this._sweep.entryUrl = payload.entryUrl;
            this._sweep.currentUrl = null;
            for (const page of Array.isArray(payload.pages) ? payload.pages : []) {
                if (!page || typeof page.url !== "string") continue;
                this._upsertPage(page.url, {
                    status: typeof page.status === "string" ? page.status : undefined,
                    reason: typeof page.reason === "string" ? page.reason : undefined,
                    scenariosGenerated: Dashboard._num(page.scenariosGenerated),
                    scenariosDeduplicated: Dashboard._num(page.scenariosDeduplicated),
                    durationMs: Dashboard._num(page.durationMs),
                });
            }
            const coverage = payload.coverage && typeof payload.coverage === "object" ? payload.coverage : {};
            const discovered = Dashboard._num(coverage.pagesDiscovered);
            if (discovered !== undefined) this._sweep.announcedTotal = Math.max(this._sweep.announcedTotal, discovered);
            if (coverage.budgetExhausted === true) this._sweep.budgetExhausted = true;
        }
    }

    /**
     * The coverage aggregate served to the panel. Tallies are recomputed from
     * the page records on every read rather than incremented as events arrive,
     * so a page whose status changes (testing → tested, or tested → skipped on
     * reconciliation) can never leave a counter permanently wrong.
     */
    coverageSnapshot() {
        const pages = [...this._sweep.pages.values()];
        const withStatus = (status) => pages.filter((p) => p.status === status).length;
        const sum = (field) => pages.reduce((acc, p) => acc + (Dashboard._num(p[field]) ?? 0), 0);
        return {
            entryUrl: this._sweep.entryUrl,
            currentUrl: this._sweep.currentUrl,
            pages,
            coverage: {
                // A sweep can discover more pages than it has records for (the
                // ones truncated by --max-pages), so the announced total wins
                // whenever it is larger.
                pagesDiscovered: Math.max(this._sweep.announcedTotal, pages.length),
                pagesTested: withStatus("tested"),
                pagesSkipped: withStatus("skipped"),
                pagesUnreachable: withStatus("unreachable"),
                pagesInProgress: withStatus("testing"),
                scenariosGenerated: sum("scenariosGenerated"),
                scenariosDeduplicated: sum("scenariosDeduplicated"),
                budgetExhausted: this._sweep.budgetExhausted,
            },
        };
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

        // Phase 9 — flaky-test detection. Same token gate and rate limiter
        // as every other read/write-state route above.
        app.get("/flakiness/scenarios", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            const classification = typeof req.query?.classification === "string" ? req.query.classification : undefined;
            const entries = FlakinessTracker.list({ classification });
            // Phase 13 — additive field only: never rename/remove anything an
            // existing consumer of this route already relies on.
            let rehabWindow;
            try {
                rehabWindow = Dashboard._resolveIntSetting("REHAB_CANDIDATE_WINDOW", { min: 1, max: 20 }, REHAB_CANDIDATE_WINDOW_DEFAULT);
            } catch (error) {
                if (error.code !== "INVALID_CONFIG") throw error;
                return res.status(500).json({ error: error.message, setting: error.setting });
            }
            const rehabKeys = new Set(FlakinessTracker.rehabilitationCandidates({ windowSize: rehabWindow }).map((c) => c.key));
            res.json(entries.map((entry) => ({ ...entry, rehabilitationCandidate: rehabKeys.has(entry.key) })));
        });

        app.post("/flakiness/quarantine", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            const { key } = req.body || {};
            let entry = null;
            try {
                entry = typeof key === "string" ? FlakinessTracker.quarantine(key, { by: "dashboard" }) : null;
            } catch (error) {
                // A scenario that has never passed is a regression, not a
                // flake. Refusing it here is the point of the route, so it
                // answers 409 with the reason rather than a bare 500.
                if (error.code === "QUARANTINE_REFUSED") {
                    return res.status(409).json({
                        error: error.message,
                        classification: error.entry?.classification ?? null,
                    });
                }
                throw error;
            }
            if (!entry) return res.status(404).json({ error: "No tracked scenario for that key." });
            res.json(entry);
        });

        app.post("/flakiness/unquarantine", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            const { key } = req.body || {};
            const entry = typeof key === "string" ? FlakinessTracker.unquarantine(key, { by: "dashboard" }) : null;
            if (!entry) return res.status(404).json({ error: "That scenario isn't currently quarantined." });
            res.json(entry);
        });

        // Phase 13 — "decisions can't rot". Three read-only routes exposing
        // the same staleness/rehabilitation views as scripts/review/status.js,
        // for a dashboard viewer rather than a CI job. Thresholds/window are
        // resolved server-side from ConfigManager on EVERY request, never
        // taken from a query parameter — a client must not be able to forge
        // a lax threshold to hide staleness (security condition: no
        // query-param override). An invalid setting answers 500 naming the
        // setting rather than crashing the whole dashboard process.
        app.get("/healing/pending/stale", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            let thresholdDays;
            try {
                thresholdDays = Dashboard._resolveIntSetting("HEALING_PENDING_STALE_DAYS", { min: 1, max: 3650 }, HEALING_PENDING_STALE_DAYS_DEFAULT);
            } catch (error) {
                if (error.code !== "INVALID_CONFIG") throw error;
                return res.status(500).json({ error: error.message, setting: error.setting });
            }
            res.json(HealingTrust.unreviewedStale({ thresholdDays }));
        });

        app.get("/flakiness/unreviewed/stale", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            let thresholdDays;
            try {
                thresholdDays = Dashboard._resolveIntSetting("FLAKY_UNREVIEWED_STALE_DAYS", { min: 1, max: 3650 }, FLAKY_UNREVIEWED_STALE_DAYS_DEFAULT);
            } catch (error) {
                if (error.code !== "INVALID_CONFIG") throw error;
                return res.status(500).json({ error: error.message, setting: error.setting });
            }
            res.json(FlakinessTracker.unreviewedFlakyStale({ thresholdDays }));
        });

        app.get("/flakiness/rehabilitation", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            let windowSize;
            try {
                windowSize = Dashboard._resolveIntSetting("REHAB_CANDIDATE_WINDOW", { min: 1, max: 20 }, REHAB_CANDIDATE_WINDOW_DEFAULT);
            } catch (error) {
                if (error.code !== "INVALID_CONFIG") throw error;
                return res.status(500).json({ error: error.message, setting: error.setting });
            }
            res.json(FlakinessTracker.rehabilitationCandidates({ windowSize }));
        });

        // Phase 10 — whole-app coverage. Read-only view of the current sweep,
        // for a tab that joined mid-run. Same token gate and rate limiter as
        // every other route: this exposes the full list of URLs Falcon found
        // in the application under test, which is exactly the kind of thing
        // the token exists to keep off an open port.
        app.get("/coverage", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            res.json(this.coverageSnapshot());
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
        if (name === "pageStart" || name === "pageComplete" || name === "sweepComplete") {
            try {
                this._recordSweepEvent(name, payload);
            } catch (error) {
                // Coverage bookkeeping is a view over the run, not part of it —
                // a malformed sweep payload must never stop the event from
                // reaching the feed and the connected tabs.
                Logger.error(`Dashboard: could not fold ${name} into coverage state — ${error.message}`);
            }
        }
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
