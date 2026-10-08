const http   = require("http");
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");
const Logger = require("../../utils/Logger");
const HealingTrust  = require("./AIHealer/HealingTrust");
const HealingReport = require("./AIHealer/HealingReport");
const FlakinessTracker = require("./FlakinessTracker");
const SharedLocatorMemory = require("./locator/sharedLocatorMemory");
const ConfigManager = require("./ConfigManager");
const { validateIntSetting } = require("./util/ConfigValidation");
const { RunLedger, MAX_BYTES: RUN_LEDGER_MAX_BYTES, DEFAULT_FILE: RUN_LEDGER_DEFAULT_FILE } = require("./history/RunLedger");
const { validateRecord, computeMetrics, SCHEMA_VERSION } = require("./history/RunRecord");
const { evaluateMany, parseTrendSettings } = require("./history/TrendDetector");

// Upper bound on the in-memory event history. Every new tab replays this whole
// list, and a long sweep emits events indefinitely, so the oldest entries are
// dropped once the cap is exceeded. A test emits roughly two to four events,
// so the cap covers several thousand tests; a tab opened after trimming
// derives its totals from the retained events only and undercounts.
const MAX_EVENTS = 20000;

// Phase 15 — GET /history serves at most this many of the newest records.
const HISTORY_LIMIT = 50;
const HISTORY_SCHEMA_VERSION = SCHEMA_VERSION;
const HISTORY_DEFAULT_FILE = RUN_LEDGER_DEFAULT_FILE;
const HISTORY_MAX_BYTES = RUN_LEDGER_MAX_BYTES;

const COOKIE_NAME = "falcon_dashboard_token";

// POST /emit accepts only the event names the framework itself produces
// (falcon.js, SiteSweep, FlakinessTracker, HealingTrust, HealingReport,
// Middleware) and bounds the request body.
const EMIT_ALLOWED_EVENTS = new Set([
    "testStart", "testEnd", "testPass", "testFail", "testSkip", "testQuarantined",
    "healingEvent", "healingPending", "healingApproved", "healingRejected",
    "explorerPage", "pageStart", "pageComplete", "sweepComplete",
    "flakyDetected", "scenarioQuarantined", "scenarioUnquarantined",
    "runPlan", "workerState",
]);
const RUN_MODES = new Set(["sequential", "parallel", "sharded"]);
const MAX_COUNT = 100000;
const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_COUNT;

/**
 * Strict schema for the Phase 16 run-state events. Returns a rebuilt payload
 * (only known fields) or null when anything is out of shape or out of bounds.
 */
function validateRunEvent(name, payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (name === "runPlan") {
        const { mode, workers, shard, pagesTotal } = payload;
        if (!RUN_MODES.has(mode) || !isCount(workers) || !isCount(pagesTotal)) return null;
        let cleanShard = null;
        if (shard !== null && shard !== undefined) {
            if (typeof shard !== "object" || Array.isArray(shard)) return null;
            if (!isCount(shard.index) || !isCount(shard.total)) return null;
            cleanShard = { index: shard.index, total: shard.total };
        }
        return { mode, workers, shard: cleanShard, pagesTotal };
    }
    const out = {};
    for (const key of ["configured", "active", "completed", "pending", "failed"]) {
        if (!isCount(payload[key])) return null;
        out[key] = payload[key];
    }
    return out;
}
const EMIT_BODY_LIMIT = "64kb";

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
 *   When `DASHBOARD_TOKEN` is set, every API route requires it via an
 *   `Authorization: Bearer` or `X-Dashboard-Token` header, or the
 *   `falcon_dashboard_token` cookie. A `?token=` query parameter is NOT
 *   accepted on API routes (URLs leak into history, logs and Referer); it is
 *   honoured only once, on `GET /`, which swaps it for an HttpOnly cookie and
 *   redirects. The socket.io handshake requires it via `auth: { token }` or
 *   the same header/cookie — an unauthorized
 *   socket connection is rejected outright (`connect_error`), not silently
 *   allowed through with no data. CORS is also restricted from `"*"` to
 *   `DASHBOARD_ALLOWED_ORIGIN` (default: this dashboard's own localhost
 *   origin — same-origin requests, which is how the bundled UI talks to it,
 *   are unaffected either way since CORS only governs cross-origin access).
 *
 *   When `DASHBOARD_TOKEN` is unset — the default, unchanged local-dev
 *   experience — none of this activates, but `start()` logs a loud warning
 *   so running unauthenticated isn't an accident nobody notices.
 *
 * Network exposure. The server binds to `DASHBOARD_HOST` (default 127.0.0.1,
 *   this machine only), not to every interface. A non-loopback host (a LAN
 *   address or 0.0.0.0) is only allowed together with `DASHBOARD_TOKEN`:
 *   `start()` rejects with `error.code === "DASHBOARD_EXPOSED_WITHOUT_TOKEN"`
 *   otherwise, so the unauthenticated approve/reject/emit routes can never be
 *   reachable from the network by accident.
 *
 * DNS rebinding. While bound to loopback, requests whose Host header is not
 *   localhost/127.0.0.1/[::1] on the listening port are refused (403), and a
 *   state-changing request or socket handshake carrying a foreign Origin is
 *   refused too. A request with no Origin (a Node reporter) is allowed.
 *
 * History cap. At most MAX_EVENTS events are kept for replay (oldest dropped).
 */
class Dashboard {
    /**
     * @param {Object} opts
     * @param {number} [opts.port=3000] - HTTP port to listen on
     * @param {string} [opts.host] - Interface to bind; defaults to
     *   DASHBOARD_HOST, else 127.0.0.1 (loopback only)
     */
    constructor({ port = 3000, host = process.env.DASHBOARD_HOST || "127.0.0.1", locatorMemory } = {}) {
        this.port    = port;
        this.host    = host;
        this._events = []; // recent history (capped at MAX_EVENTS) so late-joining tabs get replay
        this._io     = null;
        this._server = null;
        this._token  = process.env.DASHBOARD_TOKEN || null;
        this._socketConnectAttempts = new Map(); // ip → recent connection-attempt timestamps
        this._sweep  = Dashboard._emptySweep();
        // Phase 14 — Tier 2.5 scoped locator evidence. Defaults to the SAME
        // process-wide instance AIHealer defaults to (`sharedLocatorMemory
        // .shared()`), not a private per-Dashboard copy: `falcon.js` runs the
        // dashboard and the test run in the same process, so two independent
        // `new LocatorMemory()` defaults here and in AIHealer silently raced
        // two in-memory copies of one on-disk file — a dashboard approval
        // could serialise a stale map over the file and destroy evidence the
        // run had just recorded through the other copy. `locatorMemory` is
        // still injectable (every test does this, for isolation against a
        // temp path, instead of relying on this constructor default).
        this._locatorMemory = locatorMemory !== undefined ? locatorMemory : SharedLocatorMemory.shared();
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
            // Concurrent pages can deliver index 1 late, after pages 2..n have
            // started; that is only a restart when page 1 was already recorded.
            const hasFirst = [...this._sweep.pages.values()].some((p) => p.index === 1);
            if (index !== undefined && index <= 1 && hasFirst) {
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
     * Phase 15 — the payload behind GET /history: the newest 50 valid ledger
     * records (newest first) plus the trend flags for the latest complete run.
     *
     * Reads the ledger file directly and never calls RunLedger.load(), which
     * moves a damaged file aside: a request must not change anything on disk.
     * A missing ledger is an empty history; a damaged, unreadable, oversized or
     * newer-schema one answers `{ runs: [], error: "unavailable" }` with no path
     * and no error text. Records come out of RunRecord.validateRecord, which
     * rebuilds each one from the field allow-list, so nothing else can leak.
     */
    async historySnapshot() {
        if (!RunLedger.isEnabled(process.env)) return { disabled: true, runs: [] };
        const unavailable = (why) => {
            Logger.warning(`Dashboard: run history unavailable (${why})`);
            return { runs: [], error: "unavailable" };
        };
        const seam = globalThis.__FALCON_TEST_SEAMS__;
        const override = process.env.FALCON_TEST_RUN_HISTORY_PATH;
        const file = seam && seam.runHistory === true && typeof override === "string" && override
            ? override
            : HISTORY_DEFAULT_FILE;

        let stat;
        try {
            stat = await fs.promises.lstat(file);
        } catch (e) {
            if (e.code === "ENOENT" || e.code === "ENOTDIR") return { runs: [], flags: [], suppressed: [] };
            return unavailable(e.code || "error");
        }
        if (stat.isSymbolicLink() || !stat.isFile()) return unavailable("not a regular file");
        if (stat.size > HISTORY_MAX_BYTES) return unavailable("file too large");
        let settings;
        try {
            settings = parseTrendSettings(process.env);
        } catch (e) {
            if (!e || e.code !== "INVALID_CONFIG") throw e;
            if (!this._warnedTrendSettings) {
                this._warnedTrendSettings = true;
                Logger.warning(`Dashboard: invalid ${e.setting || "FALCON_TREND_*"} setting — using the default trend settings`);
            }
            settings = undefined; // evaluate() falls back to its defaults
        }

        // Unchanged file + unchanged trend settings -> the same answer; skip the
        // read, validation, sort and trend evaluation entirely.
        const key = `${file}|${stat.dev}|${stat.ino}|${stat.size}|${stat.mtimeMs}|${JSON.stringify(settings || null)}`;
        if (this._historyCache && this._historyCache.key === key) return this._historyCache.body;

        let parsed;
        try {
            const raw = await fs.promises.readFile(file);
            if (raw.length > HISTORY_MAX_BYTES) return unavailable("file too large");
            parsed = JSON.parse(raw.toString("utf8"));
        } catch (e) {
            return unavailable(e instanceof SyntaxError ? "invalid JSON" : e.code || "error");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.runs)
            || parsed.schemaVersion !== HISTORY_SCHEMA_VERSION) {
            return unavailable("unexpected shape");
        }

        const runs = parsed.runs
            .map((item) => validateRecord(item))
            .filter((v) => v.ok)
            .map((v) => v.record)
            .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));

        // Validated and sorted once; every row's flags are computed against this list.
        const lastComplete = runs.map((r) => r.incomplete).lastIndexOf(false);
        const first = Math.max(0, runs.length - HISTORY_LIMIT);
        const indices = [];
        for (let i = runs.length - 1; i >= first; i--) indices.push(i);
        if (lastComplete >= 0 && lastComplete < first) indices.push(lastComplete);
        const results = evaluateMany(runs, indices, settings);
        // indices run newest-first, so row i sits at results[runs.length - 1 - i]; an older latest-complete run is appended last.
        const latestResult = lastComplete < 0 ? null : lastComplete >= first ? results[runs.length - 1 - lastComplete] : results[results.length - 1];
        const { flags, suppressed } = latestResult || { flags: [], suppressed: [] };
        const recent = indices.filter((i) => i >= first).map((i, n) => {
            const record = runs[i];
            const metrics = computeMetrics(record.counts, record.heals);
            return {
                ...record,
                pass_rate: metrics.pass_rate,
                heal_rate: metrics.heal_rate,
                flagged: record.incomplete ? [] : results[n].flags.map((f) => f.signal),
            };
        });
        const body = { runs: recent, flags, suppressed };
        this._historyCache = { key, body };
        return body;
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

    /**
     * Extract a token from request headers: `Authorization: Bearer`, then
     * `X-Dashboard-Token`, then the `falcon_dashboard_token` cookie. Never
     * from the URL — the query string is not consulted here.
     */
    static _tokenFromHeaders(headers = {}) {
        const auth = headers.authorization;
        if (typeof auth === "string") {
            const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
            if (m) return m[1];
        }
        const custom = headers["x-dashboard-token"];
        if (typeof custom === "string" && custom) return custom;
        const cookie = headers.cookie;
        if (typeof cookie === "string") {
            for (const part of cookie.split(";")) {
                const eq = part.indexOf("=");
                if (eq < 0) continue;
                if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
                try {
                    return decodeURIComponent(part.slice(eq + 1).trim());
                } catch (_) {
                    return null;
                }
            }
        }
        return null;
    }

    _tokenFromRequest(req) {
        return Dashboard._tokenFromHeaders(req.headers);
    }

    /**
     * True if `candidate` matches the configured token. No-op (always true)
     * when auth is off. Both sides are hashed to a fixed 32 bytes first, so
     * the timing-safe comparison never branches on length.
     */
    _isAuthorized(candidate) {
        if (!this._token) return true;
        if (typeof candidate !== "string") return false;
        if (this._tokenHashFor !== this._token) {
            this._tokenHash = crypto.createHash("sha256").update(this._token).digest();
            this._tokenHashFor = this._token;
        }
        const received = crypto.createHash("sha256").update(candidate).digest();
        return crypto.timingSafeEqual(received, this._tokenHash);
    }

    /** Host header values accepted while bound to loopback (port resolved lazily). */
    _allowedHosts() {
        const port = this._server?.address()?.port ?? this.port;
        const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
        // A loopback DASHBOARD_HOST other than the defaults (e.g. 127.0.0.5)
        // is how its own visitors address it, so it is allowed too.
        const own = String(this.host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
        if (own) hosts.push(own.includes(":") ? `[${own}]:${port}` : `${own}:${port}`);
        // Browsers omit the default port from Host, so on port 80 the bare
        // names are what a legitimate request carries.
        if (Number(port) === 80) hosts.push(...hosts.map((h) => h.replace(/:80$/, "")));
        return [...new Set(hosts)];
    }

    /**
     * DNS-rebinding guard. Returns true when the request may proceed. Only
     * enforced on a loopback bind (a non-loopback bind always requires the
     * token). `checkOrigin` additionally validates an Origin header if present.
     */
    _isRequestAllowed(headers, { checkOrigin }) {
        if (!Dashboard.isLoopbackHost(this.host)) return true;
        const hosts = this._allowedHosts();
        const host = typeof headers.host === "string" ? headers.host.toLowerCase() : "";
        if (!hosts.includes(host)) return false;
        if (checkOrigin && headers.origin !== undefined) {
            const origin = String(headers.origin).toLowerCase();
            const configured = process.env.DASHBOARD_ALLOWED_ORIGIN;
            const ok = hosts.some((h) => origin === `http://${h}`) || (configured && headers.origin === configured);
            if (!ok) return false;
        }
        return true;
    }

    /** True for 127.0.0.0/8, ::1 and localhost — hosts only this machine can reach. */
    static isLoopbackHost(host) {
        if (typeof host !== "string") return false;
        const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
        if (h === "localhost" || h === "::1") return true;
        const mapped = h.startsWith("::ffff:") ? h.slice(7) : h;
        return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(mapped);
    }

    /**
     * The dashboard URL without any credential. This is the only form that
     * may be passed to Logger or any other sink.
     */
    get safeUrl() {
        return `http://localhost:${this.port}`;
    }

    /**
     * The URL to open — includes ?token= when auth is enabled. This is a
     * one-shot bootstrap: GET / exchanges the token for an HttpOnly cookie and
     * redirects to a clean URL; the query token is rejected on every API route.
     */
    get url() {
        const base = this.safeUrl;
        return this._token ? `${base}/?token=${encodeURIComponent(this._token)}` : base;
    }

    /**
     * Start the HTTP + WebSocket server and print the dashboard URL.
     */
    async start() {
        if (!Dashboard.isLoopbackHost(this.host) && !this._token) {
            const error = new Error(
                `Refusing to start the dashboard on non-loopback host "${this.host}" without authentication — ` +
                "set DASHBOARD_TOKEN, or unset DASHBOARD_HOST to bind 127.0.0.1 only."
            );
            error.code = "DASHBOARD_EXPOSED_WITHOUT_TOKEN";
            throw error;
        }
        // Lazy-require to avoid crashing processes that don't need the dashboard
        const express   = require("express");
        const socketIO  = require("socket.io");
        const rateLimit = require("express-rate-limit");
        const Middleware = require("./Middleware");

        const app = express();
        app.use((req, res, next) => {
            res.setHeader("Referrer-Policy", "no-referrer");
            next();
        });
        // DNS-rebinding guard — first, so nothing (static files included) is
        // served to a request addressed to an attacker-controlled name.
        app.use((req, res, next) => {
            const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
            if (this._isRequestAllowed(req.headers, { checkOrigin: mutating })) return next();
            res.status(403).json({ error: "Forbidden — unexpected Host or Origin." });
        });
        app.use("/emit", express.json({ limit: EMIT_BODY_LIMIT }));
        app.use("/emit", (err, req, res, next) => {
            if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Payload too large." });
            if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
            return next(err);
        });
        app.use(express.json());

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

        // Token bootstrap: the only place a ?token= is read. A valid one is
        // swapped for an HttpOnly cookie and the URL is cleaned by redirect;
        // anything else falls through to the static page.
        app.get("/", authLimiter, (req, res, next) => {
            const candidate = req.query?.token;
            if (this._token && typeof candidate === "string" && this._isAuthorized(candidate)) {
                res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(candidate)}; HttpOnly; SameSite=Strict; Path=/`);
                return res.redirect(303, "/");
            }
            next();
        });
        app.use(express.static(path.join(__dirname, "..", "dashboard")));

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
            if (typeof name !== "string" || !EMIT_ALLOWED_EVENTS.has(name)) {
                return res.status(400).json({ error: "Unknown event name." });
            }
            let clean = payload || {};
            if (name === "runPlan" || name === "workerState") {
                clean = validateRunEvent(name, payload);
                if (!clean) return res.status(400).json({ error: "Invalid event payload." });
            }
            this.emit(name, clean);
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
            const { original, suggested } = req.body || {};
            const decision = typeof original === "string" && typeof suggested === "string"
                ? HealingTrust.approve(original, { approvedBy: "dashboard", suggested })
                : null;
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

        // Phase 15 — run history. Read-only, GET-only, no parameter of any
        // kind (query, path or body) reaches the filesystem or the trend
        // settings. Same token gate and rate limiter as every route above; the
        // Host/Origin guard already ran. A hosted ledger is never repaired or
        // moved from here (see historySnapshot).
        app.get("/history", authLimiter, async (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            let body;
            try {
                body = await this.historySnapshot();
            } catch (_) {
                body = { runs: [], error: "unavailable" };
            }
            res.setHeader("Cache-Control", "no-store");
            res.json(body);
        });

        // Phase 14 — Tier 2.5 scoped locator evidence review surfaces, kept
        // in their own `/locator/...` namespace rather than folded into
        // `/healing/...` above: Tier 2.5 entries are keyed by SCOPED
        // identity (application/origin/pathname/action/selector) and carry
        // their own three-state trust (trusted/unproven/revoked), which is
        // a structurally different thing from Tier 3's flat
        // original->suggested pending list. Keeping the namespace separate
        // means a reviewer can never mistake one listing for the other.
        // Same token gate and rate limiter as every route above: these
        // read and act on what the framework will trust as a locator
        // repair, which is exactly the class of state this dashboard's
        // auth exists to protect.
        app.get("/locator/entries", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            // Keyed object (not an array) — mirrors LocatorMemory.list()
            // directly so a key an operator picks from this listing can be
            // passed straight back to approve/reject/rollback below.
            res.json(this._locatorMemory.list());
        });

        app.get("/locator/legacy", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            // Read-only by design: a legacy row is quarantined because it
            // failed basic shape/schema validation on load, is never read by
            // the matcher, and the only route that ever touches it again is
            // the explicit delete below — nothing here ever promotes one
            // back into `entries`.
            res.json(this._locatorMemory.listLegacy());
        });

        for (const kind of ["approve", "reject", "rollback"]) {
            app.post(`/locator/${kind}`, authLimiter, async (req, res) => {
                if (!this._isAuthorized(this._tokenFromRequest(req))) {
                    return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
                }
                const { key, proposalId, expectedRevision, note } = req.body || {};
                if (typeof key !== "string") return res.status(400).json({ error: "An identity key is required." });
                try {
                    const decision = await this._locatorMemory.decide(kind, key, {
                        proposalId, expectedRevision, actor: "dashboard", note: typeof note === "string" ? note : undefined,
                    });
                    if (!decision.ok) return res.status(decision.status).json({ error: decision.error });
                    return res.json(decision.entry);
                } catch (_) {
                    return res.status(503).json({ error: "Locator decision could not be persisted." });
                }
            });
        }

        app.post("/locator/legacy/delete", authLimiter, (req, res) => {
            if (!this._isAuthorized(this._tokenFromRequest(req))) {
                return res.status(401).json({ error: "Unauthorized — missing or invalid DASHBOARD_TOKEN." });
            }
            const { id } = req.body || {};
            const deleted = typeof id === "string" ? this._locatorMemory.deleteLegacy(id, { actor: "dashboard" }) : false;
            if (!deleted) return res.status(404).json({ error: "No legacy row for that id." });
            res.json({ deleted: true });
        });

        const allowedOrigin = process.env.DASHBOARD_ALLOWED_ORIGIN || `http://localhost:${this.port}`;

        this._server = http.createServer(app);
        this._io     = new socketIO.Server(this._server, {
            cors: { origin: allowedOrigin },
            allowRequest: (req, callback) => {
                callback(null, this._isRequestAllowed(req.headers, { checkOrigin: true }));
            },
        });

        // Reject unauthorized connections outright (fires `connect_error` on
        // the client) rather than letting them through with no data — an
        // unauthenticated socket never even reaches the "connection" handler.
        this._io.use((socket, next) => {
            if (this._isSocketRateLimited(socket.handshake.address)) {
                return next(new Error("Too many connection attempts — slow down."));
            }
            const candidate = socket.handshake.auth?.token ?? Dashboard._tokenFromHeaders(socket.request?.headers);
            if (this._isAuthorized(candidate)) return next();
            next(new Error("Unauthorized — missing or invalid DASHBOARD_TOKEN."));
        });

        this._io.on("connection", (socket) => {
            // Replay full history so the new client sees everything
            socket.emit("replay", this._events);
        });

        await new Promise((resolve, reject) => {
            this._server.once("error", reject);
            this._server.listen(this.port, this.host, () => {
                this._server.removeListener("error", reject);
                // Reflect the OS-assigned port back onto `this.port` — matters
                // when the caller passed 0 (ephemeral port), otherwise `url`
                // below would print the requested port (0) instead of the
                // real one actually listening.
                this.port = this._server.address().port;
                resolve();
            });
        });

        Logger.info(`🖥  Dashboard → ${this.safeUrl}`);
        if (!this._token) {
            Logger.warning(
                "⚠️  Dashboard running WITHOUT auth (DASHBOARD_TOKEN not set) — " +
                "anyone who can reach this port can read and write test events. " +
                "Fine while bound to loopback; DASHBOARD_TOKEN is required to bind a non-loopback DASHBOARD_HOST."
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
        // seq is additive and strictly increasing for the process lifetime,
        // independent of the replay cap, so clients can order and de-duplicate.
        this._seq = (this._seq || 0) + 1;
        const event = { name, payload, timestamp: Date.now(), seq: this._seq };
        this._events.push(event);
        if (this._events.length > MAX_EVENTS) {
            this._events.splice(0, this._events.length - MAX_EVENTS);
        }
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
module.exports.MAX_EVENTS = MAX_EVENTS;
