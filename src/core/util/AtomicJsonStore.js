const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const Logger = require("../../../utils/Logger");

/**
 * AtomicJsonStore — shared durable-persistence primitive for Falcon's
 * append-only state files (scenario history, quarantine decisions, healing
 * pending/decisions).
 *
 * Phase 12 hardens two things that every one of those files previously did
 * ad hoc, with a bare `catch {}` and no observability:
 *
 *   - readJsonSync(): loads a JSON file synchronously (unchanged timing —
 *     this always ran once at construction, before any write queue exists,
 *     so there is no async-init race to introduce). On top of the existing
 *     fallback-shape discipline (an array fallback demands the parsed value
 *     also be an array; an object fallback demands a non-array object), a
 *     corrupt or wrong-shaped file is no longer silently swallowed: it is
 *     preserved as a `.corrupt-<timestamp>-<pid>-<uuid>` sidecar next to the
 *     original (collision-safe — the same uniqueness scheme as the write
 *     path's temp file, never a bare millisecond timestamp), a distinctive
 *     Logger.warning names the path and the failure, and a clean in-memory
 *     fallback lets the run continue. If the sidecar write itself fails,
 *     that failure is logged too and the run still continues (fail-open —
 *     a failed audit write must never abort the run, matching the existing
 *     policy of every persistence catch in this codebase).
 *
 *   - writeJsonAtomic(): writes to a uniquely-named temp file in the same
 *     directory as the destination (so the following rename never crosses
 *     a filesystem boundary), then atomically renames it into place. A
 *     reader can therefore never observe a partially-written/truncated
 *     file. On any failure, it logs the path and error and cleans up only
 *     the exact temp path this call created (never a glob/sweep — a temp
 *     file left by a different, possibly still-running, process must never
 *     be touched). This function is load-bearing: callers chain saves onto
 *     a promise (`_queue = _queue.then(() => writeJsonAtomic(...))`) with no
 *     `.catch`, so a rejection here would poison the chain and silently stop
 *     every later save in the process from ever running. It therefore must
 *     never reject.
 *
 * Phase 14 (AC-08) — writeJsonAtomic's resolved value changes from
 * `undefined` to `{ ok: boolean, error?: string }`. This is purely additive:
 * every existing call site discards the resolved value today, so widening
 * what it resolves with is a zero-behaviour-change signature widening, not a
 * breaking one. The never-reject guarantee is untouched.
 *
 * `WriteFailureTracker` is a small, reusable, per-path failure ledger any
 * store can compose in. The reason it exists — rather than each store
 * keeping one `_lastWriteFailure` slot — is that a store chaining more than
 * one `writeJsonAtomic` call in the same promise chain (e.g. writing a
 * history file, then a decisions file) must not let the second write's
 * result clobber the first's: a failed first write followed by a successful
 * second write must still report as failed. Keying failures by path, not by
 * call order, makes that true automatically for any number of chained
 * writes to any number of files, without each caller having to hand-roll
 * aggregation logic.
 */

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function _sidecarPath(filePath) {
    const dir  = path.dirname(filePath);
    const base = path.basename(filePath);
    return path.join(dir, `${base}.corrupt-${Date.now()}-${process.pid}-${crypto.randomUUID()}`);
}

function _preserveCorrupt(filePath, rawBytes) {
    try {
        const sidecar = _sidecarPath(filePath);
        // Exclusive-create: never overwrite an existing sidecar, and never
        // follow a pre-placed symlink at that path.
        fs.writeFileSync(sidecar, rawBytes, { flag: "wx", mode: 0o600 });
    } catch (sidecarError) {
        Logger.warning(
            `AtomicJsonStore corrupt-file recovery: failed to preserve corrupt sidecar for ${filePath} — ${sidecarError.message}`,
        );
    }
}

/**
 * Load a JSON file synchronously. Returns `fallback` if the file doesn't
 * exist, can't be read, isn't valid JSON, or doesn't match the shape implied
 * by `fallback` (array vs. plain object) — recovering from all four by
 * preserving the original bytes as a sidecar and logging a warning naming
 * the path and the failure (never the file's contents).
 *
 * @param {string} filePath
 * @param {object|Array} fallback
 */
function readJsonSync(filePath, fallback, options = {}) {
    const maxBytes = Number.isFinite(options && options.maxBytes) && options.maxBytes > 0
        ? options.maxBytes
        : DEFAULT_MAX_BYTES;
    let raw;
    let fd;
    try {
        let st;
        try {
            st = fs.lstatSync(filePath);
        } catch (statError) {
            if (statError.code === "ENOENT") return fallback;
            throw statError;
        }
        if (st.isSymbolicLink() || !st.isFile()) {
            Logger.warning(`AtomicJsonStore corrupt-file recovery: refusing to read ${filePath} — not a regular file`);
            return fallback;
        }
        const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
        fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
        const fst = fs.fstatSync(fd);
        if (!fst.isFile()) {
            Logger.warning(`AtomicJsonStore corrupt-file recovery: refusing to read ${filePath} — not a regular file`);
            return fallback;
        }
        if (fst.size > maxBytes) {
            Logger.warning(`AtomicJsonStore corrupt-file recovery: refusing to read ${filePath} — size ${fst.size} exceeds limit ${maxBytes}`);
            return fallback;
        }
        raw = fs.readFileSync(fd);
    } catch (readError) {
        Logger.warning(`AtomicJsonStore corrupt-file recovery: failed to read ${filePath} — ${readError.message}`);
        return fallback;
    } finally {
        if (fd !== undefined) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
    }

    let parsed;
    try {
        parsed = JSON.parse(raw.toString("utf8"));
    } catch {
        // Deliberately not logging the SyntaxError's own message: modern
        // V8 JSON.parse errors quote a snippet of the offending input
        // (e.g. `Unexpected token 'x', "...bad text..." is not valid
        // JSON`), which would leak file contents into the log — exactly
        // what this warning must never do. Name the path and the failure
        // kind only.
        Logger.warning(`AtomicJsonStore corrupt-file recovery: invalid JSON in ${filePath}`);
        _preserveCorrupt(filePath, raw);
        return fallback;
    }

    const shapeOk = Array.isArray(fallback)
        ? Array.isArray(parsed)
        : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    if (!shapeOk) {
        Logger.warning(`AtomicJsonStore corrupt-file recovery: unexpected JSON shape in ${filePath}`);
        _preserveCorrupt(filePath, raw);
        return fallback;
    }

    return parsed;
}

/**
 * Durably write `data` as JSON to `filePath`: write to a unique temp file in
 * the same directory, then atomically rename it into place. Never rejects —
 * any failure is logged (path + error, never data contents) and the exact
 * temp file this call created is cleaned up (ENOENT ignored). Resolves
 * `{ok: true}` on success and `{ok: false, error: <message>}` on failure —
 * this is the only change from the pre-Phase-14 contract (which resolved
 * `undefined` in both cases); it is additive only, so it cannot change the
 * behaviour of any caller that still discards the resolved value.
 *
 * @param {string} filePath
 * @param {object|Array} data
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function writeJsonAtomic(filePath, data) {
    const dir     = path.dirname(filePath);
    const tmpPath = path.join(dir, `${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`);
    try {
        await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
        const handle = await fs.promises.open(tmpPath, "wx", 0o600);
        try {
            await handle.writeFile(JSON.stringify(data, null, 2), "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.promises.rename(tmpPath, filePath);
        return { ok: true };
    } catch (error) {
        Logger.warning(`AtomicJsonStore write failure: failed to durably write ${filePath} — ${error.message}`);
        try {
            await fs.promises.unlink(tmpPath);
        } catch (unlinkError) {
            if (unlinkError.code !== "ENOENT") {
                Logger.warning(`AtomicJsonStore write failure: failed to clean up temp file ${tmpPath} — ${unlinkError.message}`);
            }
        }
        return { ok: false, error: error.message };
    }
}

/**
 * Reusable, per-path write-failure ledger (AC-08). A store composes one
 * instance (`this._writeFailures = new WriteFailureTracker()`) and calls
 * `record(path, result)` after every `writeJsonAtomic(path, data)` settles,
 * chained in the same `.then()` — e.g.:
 *
 *   this._queue = this._queue
 *     .then(() => writeJsonAtomic(path, data))
 *     .then((result) => this._writeFailures.record(path, result));
 *
 * Failures are keyed by `path`, not by call order, so a store that chains
 * writes to two different files in one promise chain (history then
 * decisions, pending then decisions, …) cannot have a failed write to one
 * path masked by a successful write to another — each path's status is
 * independent and a success only clears that same path's own prior failure.
 * `hasUnpersistedWriteFailure()` / `lastWriteError()` never throw and never
 * read from disk — they report only what `record()` has been told.
 */
class WriteFailureTracker {
    constructor() {
        /** @type {Map<string, {path: string, error: string, at: string}>} */
        this._failures = new Map();
    }

    /**
     * @param {string} filePath
     * @param {{ok: boolean, error?: string}} result
     */
    record(filePath, result) {
        if (result && result.ok) {
            this._failures.delete(filePath);
        } else {
            this._failures.set(filePath, {
                path: filePath,
                error: (result && result.error) || "unknown error",
                at: new Date().toISOString(),
            });
        }
    }

    /** True if any tracked path currently has an unpersisted write failure. */
    hasUnpersistedWriteFailure() {
        return this._failures.size > 0;
    }

    /**
     * The most recently recorded failure across all tracked paths, or
     * `null` if none is currently outstanding. "Most recent" is by the
     * failure's own recorded timestamp, not by which path happened to be
     * written last — a currently-failing path is never displaced by a
     * different path's unrelated success.
     */
    lastWriteError() {
        let latest = null;
        for (const failure of this._failures.values()) {
            if (!latest || failure.at > latest.at) latest = failure;
        }
        return latest;
    }
}

module.exports = { readJsonSync, writeJsonAtomic, WriteFailureTracker };
