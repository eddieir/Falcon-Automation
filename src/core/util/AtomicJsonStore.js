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
 */

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
        fs.writeFileSync(sidecar, rawBytes, { flag: "wx" });
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
function readJsonSync(filePath, fallback) {
    let raw;
    try {
        if (!fs.existsSync(filePath)) return fallback;
        raw = fs.readFileSync(filePath);
    } catch (readError) {
        Logger.warning(`AtomicJsonStore corrupt-file recovery: failed to read ${filePath} — ${readError.message}`);
        return fallback;
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
 * temp file this call created is cleaned up (ENOENT ignored).
 *
 * @param {string} filePath
 * @param {object|Array} data
 */
async function writeJsonAtomic(filePath, data) {
    const dir     = path.dirname(filePath);
    const tmpPath = path.join(dir, `${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`);
    try {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
        await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
        Logger.warning(`AtomicJsonStore write failure: failed to durably write ${filePath} — ${error.message}`);
        try {
            await fs.promises.unlink(tmpPath);
        } catch (unlinkError) {
            if (unlinkError.code !== "ENOENT") {
                Logger.warning(`AtomicJsonStore write failure: failed to clean up temp file ${tmpPath} — ${unlinkError.message}`);
            }
        }
    }
}

module.exports = { readJsonSync, writeJsonAtomic };
