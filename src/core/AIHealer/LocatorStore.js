const path = require("path");
const AtomicJsonStore = require("../util/AtomicJsonStore");

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
 *
 * Phase 14 fix (AC-06/AC-07/AC-08) — atomic writes and visible corruption
 * recovery.
 *    `_save()` used to call `fs.promises.writeFile` directly on the live
 *    path and swallow every error in a bare `catch`, so the store was never
 *    actually atomic despite living next to `AtomicJsonStore`, and a crash
 *    mid-write could leave a truncated `locator_store.json` behind.
 *    `_loadSync()`'s catch was `catch { }` with no warning and no
 *    preservation of the corrupt bytes, so recovery from a corrupt or
 *    truncated file was completely silent. Both now route through the
 *    shared `AtomicJsonStore` primitive: `_save()` uses
 *    `writeJsonAtomic()` (temp-file-plus-rename, so a reader can never
 *    observe a partial write, and the `{ok,error}` result feeds a per-path
 *    `hasUnpersistedWriteFailure()`/`lastWriteError()` surface), and
 *    `_loadSync()` uses `readJsonSync()`, which preserves any corrupt or
 *    wrong-shaped file as a `.corrupt-<timestamp>-<pid>-<uuid>` sidecar and
 *    logs a warning naming the path and the failure kind (never the file's
 *    contents or the parser's own message) before falling back to `{}`. A
 *    pre-Phase-14 installation with a half-written legacy file (a real risk,
 *    since the old `_save()` was never atomic) is simply invalid JSON from
 *    `readJsonSync`'s point of view: preserved as a sidecar, warned about,
 *    and the store starts fresh from `{}` — the same "start fresh" outcome
 *    as before, now visible instead of silent, with the corrupt bytes still
 *    recoverable from the sidecar. The on-disk path and shape are
 *    unchanged.
 */
const MAX_ALTERNATIVES_PER_SELECTOR = 5;
const MAX_TRACKED_SELECTORS         = 500;

class LocatorStore {
    constructor() {
        this.storePath = path.join(__dirname, "..", "..", "..", "data", "locator_store.json");
        this._writeFailures = new AtomicJsonStore.WriteFailureTracker();
        this.data      = this._loadSync(); // synchronous once at startup is fine
        this._queue    = Promise.resolve();
    }

    _loadSync() {
        const raw = AtomicJsonStore.readJsonSync(this.storePath, {});
        const migrated = {};
        for (const [original, entry] of Object.entries(raw)) {
            const alternatives = Array.isArray(entry) ? entry : entry?.alternatives;
            if (!Array.isArray(alternatives)) continue;
            Object.defineProperty(migrated, original, {
                value: {
                    alternatives: [...new Set(alternatives.filter(value => typeof value === "string" && value.trim()))]
                        .slice(-MAX_ALTERNATIVES_PER_SELECTOR),
                    lastUsed: Number.isFinite(entry?.lastUsed) ? entry.lastUsed : Date.now(),
                },
                enumerable: true, configurable: true, writable: true,
            });
        }
        return migrated;
    }

    addLocator(original, alternative) {
        if (!Object.hasOwn(this.data, original)) {
            Object.defineProperty(this.data, original, {
                value: { alternatives: [], lastUsed: Date.now() },
                enumerable: true, configurable: true, writable: true,
            });
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
        if (!Object.hasOwn(this.data, original)) return [];
        const entry = this.data[original];
        entry.lastUsed = Date.now();
        this._queue = this._queue.then(() => this._save());
        return [...entry.alternatives];
    }

    async _save() {
        // AtomicJsonStore.writeJsonAtomic never rejects (temp-file-plus-
        // rename, mkdir handled internally) and its resolved {ok,error}
        // feeds the per-path failure tracker — a failed cache write still
        // never aborts the test run, but is no longer silently swallowed.
        const result = await AtomicJsonStore.writeJsonAtomic(this.storePath, this.data);
        this._writeFailures.record(this.storePath, result);
    }

    /**
     * AC-08: true if the last write to `storePath` did not durably land on
     * disk.
     */
    hasUnpersistedWriteFailure() {
        return this._writeFailures.hasUnpersistedWriteFailure();
    }

    /**
     * AC-08: the most recent unpersisted write failure for `storePath`
     * (`{path, error, at}`), or `null` if none is currently outstanding.
     */
    lastWriteError() {
        return this._writeFailures.lastWriteError();
    }
}

module.exports = new LocatorStore();
