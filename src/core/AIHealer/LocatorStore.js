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
 */
class LocatorStore {
    constructor() {
        this.storePath = path.join(__dirname, "..", "..", "..", "data", "locator_store.json");
        this.data      = this._loadSync(); // synchronous once at startup is fine
        this._queue    = Promise.resolve();
    }

    _loadSync() {
        try {
            if (fs.existsSync(this.storePath)) {
                return JSON.parse(fs.readFileSync(this.storePath, "utf8"));
            }
        } catch {
            // Corrupt store — start fresh
        }
        return {};
    }

    addLocator(original, alternative) {
        if (!this.data[original]) {
            this.data[original] = [];
        }
        if (!this.data[original].includes(alternative)) {
            this.data[original].push(alternative);
            this._queue = this._queue.then(() => this._save());
        }
    }

    getAlternatives(original) {
        return this.data[original] || [];
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
