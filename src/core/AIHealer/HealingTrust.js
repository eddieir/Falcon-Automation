const fs   = require("fs");
const path = require("path");
const LocatorStore = require("./LocatorStore");
const Middleware   = require("../Middleware");

/**
 * HealingTrust — Phase 8 approval gate for Tier 3 (LLM-inferred) selector
 * fixes.
 *
 * Before Phase 8, a successful Tier 3 inference was written straight into
 * LocatorStore, so an unreviewed LLM guess was trusted for reuse the moment
 * it happened to click the right element once — exactly what the Roadmap's
 * "Self-healing should never mean silently trusted" called out.
 *
 * New flow:
 *   Tier 3 succeeds -> HealingTrust.recordPending()  (visible, not yet reused)
 *   human approves   -> LocatorStore.addLocator()     (Tier 2 reuses it)
 *   human rejects     -> discarded, kept in the decision ledger for audit
 *
 * Until a human approves it, the same broken selector pays the Tier 3 LLM
 * cost again on every subsequent run. That's intentional: a guess earns no
 * trust just because it worked once.
 */
class HealingTrust {
    constructor() {
        this.pendingPath   = path.join(__dirname, "..", "..", "..", "data", "healing_pending.json");
        this.decisionsPath = path.join(__dirname, "..", "..", "..", "data", "healing_decisions.json");
        this._queue = Promise.resolve();
        this._reload();
    }

    /** (Re)load both files from disk. Exposed for tests that swap the paths after construction. */
    _reload() {
        this.pending   = this._loadJson(this.pendingPath, {});
        this.decisions = this._loadJson(this.decisionsPath, []);
    }

    _loadJson(filePath, fallback) {
        try {
            if (fs.existsSync(filePath)) {
                const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
                if (Array.isArray(fallback)) return Array.isArray(raw) ? raw : fallback;
                return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : fallback;
            }
        } catch {
            // Corrupt file — start fresh rather than crash the run
        }
        return fallback;
    }

    /**
     * True if `key` is an own entry of `this.pending`. Never delegates to the
     * prototype chain — `"constructor" in this.pending` or a bare
     * `this.pending[key]` read would silently resolve to `Object.prototype`
     * members for keys like "constructor"/"toString", masking a real
     * pending entry (or worse: a bracket *assignment* to "__proto__" would
     * silently repoint the object's prototype instead of creating a
     * property, and the entry would vanish, unrecoverable, from `list()`).
     * A CSS selector can legitimately be any string, including these, so
     * every access below goes through `_hasPending`/`_getPending`/`_setPending`.
     */
    _hasPending(key) {
        return Object.hasOwn(this.pending, key);
    }

    _getPending(key) {
        return this._hasPending(key) ? this.pending[key] : undefined;
    }

    _setPending(key, value) {
        Object.defineProperty(this.pending, key, {
            value, enumerable: true, configurable: true, writable: true,
        });
    }

    /**
     * Record a Tier 3 success as awaiting review. Re-recording the same
     * original selector (it broke again before being reviewed) bumps
     * `occurrences`/`lastSeen` in place instead of creating a duplicate;
     * the latest `suggested`/`description` win, since they reflect the most
     * recent LLM inference for that selector.
     *
     * @param {Object} opts
     * @param {string} opts.original    - The selector that no longer matched
     * @param {string} opts.suggested   - What the LLM inferred as a replacement
     * @param {string} [opts.description]
     */
    recordPending({ original, suggested, description = "" }) {
        const existing = this._getPending(original);
        const entry = {
            original,
            suggested,
            description,
            firstSeen:   existing?.firstSeen ?? new Date().toISOString(),
            lastSeen:    new Date().toISOString(),
            occurrences: (existing?.occurrences ?? 0) + 1,
        };
        this._setPending(original, entry);
        this._queue = this._queue.then(() => this._save(this.pendingPath, this.pending));
        Middleware.emit("healingPending", entry);
        return entry;
    }

    /** All fixes currently awaiting review. */
    list() {
        return Object.values(this.pending);
    }

    /**
     * Approve a pending fix. It becomes a trusted Tier 2 alternative
     * (written into LocatorStore) and is removed from the pending queue.
     * Returns null if there is no pending entry for that selector.
     */
    approve(original, { approvedBy = "dashboard" } = {}) {
        const entry = this._getPending(original);
        if (!entry) return null;

        LocatorStore.addLocator(entry.original, entry.suggested);
        delete this.pending[original];

        const decision = { ...entry, decision: "approved", decidedAt: new Date().toISOString(), decidedBy: approvedBy };
        this.decisions.push(decision);
        this._queue = this._queue
            .then(() => this._save(this.pendingPath, this.pending))
            .then(() => this._save(this.decisionsPath, this.decisions));
        Middleware.emit("healingApproved", decision);
        return decision;
    }

    /**
     * Reject a pending fix. Discarded — never written to LocatorStore — but
     * kept in the decision ledger so a rejected guess doesn't quietly get
     * re-suggested with no record of it having been turned down before.
     * Returns null if there is no pending entry for that selector.
     */
    reject(original, { rejectedBy = "dashboard" } = {}) {
        const entry = this._getPending(original);
        if (!entry) return null;

        delete this.pending[original];

        const decision = { ...entry, decision: "rejected", decidedAt: new Date().toISOString(), decidedBy: rejectedBy };
        this.decisions.push(decision);
        this._queue = this._queue
            .then(() => this._save(this.pendingPath, this.pending))
            .then(() => this._save(this.decisionsPath, this.decisions));
        Middleware.emit("healingRejected", decision);
        return decision;
    }

    async _save(filePath, data) {
        try {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
        } catch {
            // A failed audit write must never abort the run
        }
    }
}

module.exports = new HealingTrust();
