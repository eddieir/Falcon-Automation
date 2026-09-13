const fs   = require("fs");
const path = require("path");

/**
 * LocatorStore — persistent cache of alternative selectors (Tier 2 healing).
 *
 * Phase 2 fixes:
 *
 * 1. Correct project-root path.
 *    `__dirname` is `src/core/AIHealer/`. The old path used two `..` segments
 *    which resolves to `src/data/` — a directory that does not exist.  Fixed
 *    to three `..` segments so the store lands at `<project-root>/data/`.
 *
 * 2. Lazy directory creation.
 *    A missing `data/` directory caused ENOENT on the first `saveData()` call,
 *    discarding every Tier 3 result that should have been cached for Tier 2.
 *    The directory is now created before the first write.
 *
 * 3. Async save.
 *    `fs.writeFileSync` on every `addLocator()` call stalled the event loop.
 *    Replaced with a serialised async write queue (same pattern as Logger).
 *
 * Phase 5 fix — bounded growth.
 *    `addLocator()` only ever appended, both to a given selector's
 *    alternatives list and to the overall set of tracked selectors, so
 *    `data/locator_store.json` grew without limit over a long project
 *    history (renamed/removed pages leave their old selectors behind
 *    forever). Each entry now also tracks `lastUsed`; the alternatives list
 *    per selector is capped at MAX_ALTERNATIVES_PER_SELECTOR (oldest
 *    dropped first), and once the number of distinct tracked selectors
 *    exceeds MAX_TRACKED_SELECTORS, the least-recently-used ones are
 *    evicted. A legacy store (plain `{ original: [alt, ...] }`, no
 *    `lastUsed`) is migrated in place on load rather than treated as
 *    corrupt.
 */
const MAX_ALTERNATIVES_PER_SELECTOR = 5;
const MAX_TRACKED_SELECTORS         = 500;

class LocatorStore {
    constructor() {
        this.storePath = path.join(__dirname, "..", "..", "..", "data", "locator_store.json");
        this.data      = this._loadSync(); // synchronous once at startup is fine
        this._queue    = Promise.resolve();
    }

    _loadSync() {
        try {
            if (fs.existsSync(this.storePath)) {
                const raw = JSON.parse(fs.readFileSync(this.storePath, "utf8"));
                const migrated = {};
                for (const [original, entry] of Object.entries(raw)) {
                    // Legacy shape: entry is a plain array of alternatives.
                    migrated[original] = Array.isArray(entry)
                        ? { alternatives: entry, lastUsed: Date.now() }
                        : entry;
                }
                return migrated;
            }
        } catch {
            // Corrupt store — start fresh
        }
        return {};
    }

    addLocator(original, alternative) {
        if (!this.data[original]) {
            this.data[original] = { alternatives: [], lastUsed: Date.now() };
        }
        const entry = this.data[original];
        entry.lastUsed = Date.now();

        if (!entry.alternatives.includes(alternative)) {
            entry.alternatives.push(alternative);
            if (entry.alternatives.length > MAX_ALTERNATIVES_PER_SELECTOR) {
                entry.alternatives.splice(0, entry.alternatives.length - MAX_ALTERNATIVES_PER_SELECTOR);
            }
        }

        this._evictLeastRecentlyUsed();
        this._queue = this._queue.then(() => this._save());
    }

    /** Keep at most MAX_TRACKED_SELECTORS entries, dropping the stalest first. */
    _evictLeastRecentlyUsed() {
        const keys = Object.keys(this.data);
        if (keys.length <= MAX_TRACKED_SELECTORS) return;

        keys
            .sort((a, b) => this.data[a].lastUsed - this.data[b].lastUsed)
            .slice(0, keys.length - MAX_TRACKED_SELECTORS)
            .forEach((key) => delete this.data[key]);
    }

    getAlternatives(original) {
        return this.data[original]?.alternatives || [];
    }

    async _save() {
        try {
            await fs.promises.mkdir(path.dirname(this.storePath), { recursive: true });
            await fs.promises.writeFile(
                this.storePath,
                JSON.stringify(this.data, null, 2),
                "utf8"
            );
        } catch {
            // Swallow — a failed cache write must never abort the test run
        }
    }
}

module.exports = new LocatorStore();
