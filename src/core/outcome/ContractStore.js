"use strict";

/**
 * ContractStore.js — WP-77a auditable approval-lifecycle store for business
 * assertion contracts (Contract.js). One append-only JSONL event log per
 * journeyId, hash-chained so edited, reordered, replayed, mid-line-truncated
 * or oversized files are detected on read.
 *
 * Cross-process coordination: every mutating operation (propose / approve /
 * reject; approve may also emit a SUPERSEDED event) takes a per-journey lock file (`events.jsonl.lock`,
 * created with `wx` mode 0600, containing `{pid, token, at}`) BEFORE it reads
 * any chain state, re-reads and re-verifies the whole chain from disk under
 * that lock, appends, and writes atomically, then releases the lock. An
 * in-process promise queue is kept as a cheap additional guard for callers
 * within the same process. Lock acquisition retries with a short backoff up
 * to `lockTimeoutMs` (default 5000ms) and fails closed (no write) with
 * `LOCK_TIMEOUT` on contention. A lock is only ever stolen from a dead owner
 * (verified via `process.kill(pid, 0)`; a live holder, however old its lock,
 * is never stolen) and only once it is older than `lockStaleMs` (default
 * 30000ms), and only by the process that itself holds the short-lived
 * mutex file (`events.jsonl.lock.steal`, created with `wx` mode 0600): under
 * it the stale lock is re-read and unlinked only if it is still the exact
 * stale content judged earlier (there is no rename-aside step). No process
 * ever unlinks a mutex it does not hold; if the mutex is already present
 * for any reason (a live holder, or a dead/empty/unparseable leftover from
 * a crash) the current round simply does not steal — there is no automatic
 * steal-mutex recovery of any kind. The caller's own retry loop keeps
 * backing off, and `LOCK_TIMEOUT` is the bounded, explicit result once
 * `lockTimeoutMs` elapses; a leftover mutex is cleared only by the
 * documented operator procedure (remove the `.lock.steal` file by hand once
 * no process holds it). While a stale lock file exists nobody can
 * create a fresh one (wx fails), so only a mutex holder can change it and a
 * live writer's fresh lock cannot be displaced by a late stealer. Immediately before the final rename,
 * the lock and a content fingerprint of the events file are re-checked
 * against what was read under the lock; any mismatch aborts with `LOCK_LOST`
 * and writes nothing.
 *
 * Guaranteed by this mechanism: on one host, two processes racing to
 * approve/reject/propose against the same journey will not both win — one
 * succeeds, the other observes the committed state (or a clean lock error),
 * and a lost-update is detected and refused rather than written. This holds
 * for cooperating processes that share one process-id namespace and one local
 * filesystem (not across containers with separate pid namespaces).
 *
 * NOT guaranteed / residual limits:
 *  - single host only — this uses local file locks (open 'wx', unlink, atomic rename);
 *    it is not safe over NFS or any shared filesystem across hosts;
 *  - no external anchor — the hash chain proves internal consistency of one
 *    file, not authenticity; an attacker who can rewrite the whole store
 *    from scratch with a self-consistent chain, or restore an earlier valid
 *    copy of the whole store, is undetected (whole-store rollback);
 *  - cutting the file at a line boundary is undetected;
 *  - no operator identity — `channel` and `at` are operator-supplied labels,
 *    not proof of who recorded an approval;
 *  - exclusivity of a live owner (including the gap between its final
 *    ownership check and the rename in writeChain) rests on: (a) wx being an
 *    atomic exclusive create; (b) process.kill(pid, 0) reporting liveness
 *    truthfully within one pid namespace on one host; (c) nobody with write
 *    access to the store directory deleting a live lock by hand; writeChain's
 *    rename has no compare-and-swap, so a live owner wrongly judged dead can
 *    lose to a later writer. A hung but still-live holder is never stolen
 *    from and yields `LOCK_TIMEOUT` for other writers until it exits or its
 *    process is gone. There is no steal-mutex recovery at all (R1, as
 *    tracked in issue #125, is retired): a leftover `events.jsonl.lock.steal`
 *    file — dead owner, empty, or unparseable — is never unlinked by a
 *    process that does not hold it, and availability for that journey is
 *    lost (data stays safe; writes fail closed with `LOCK_TIMEOUT`) until an
 *    operator removes the file by hand;
 *
 * Security note (read before relying on this for anything beyond operator
 * mistakes): the hash chain proves *internal consistency* of one file. It
 * cannot prove *authenticity* against an attacker capable of rewriting the
 * whole store from scratch with a self-consistent chain — there is no
 * external anchor (no signature, no external log). Do not treat this store
 * as proof of human identity or of review quality — only as a tamper-evident
 * log of lifecycle transitions, now additionally guarded against same-host
 * cross-process lost-update races.
 *
 * No contract body, locator text or expected values are ever stored here —
 * only digests, revisions and lifecycle metadata.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SafeFs = require("../parallel/SafeFs");
const Limits = require("../parallel/Limits");
const { canonicalJson, sha256 } = require("../parallel/Schemas");
const Contract = require("./Contract");

const EVENT_TYPES = Object.freeze(["PROPOSED", "APPROVED", "REJECTED", "SUPERSEDED"]);
const CHANNELS = Object.freeze(["cli", "dashboard", "test"]);
const GENESIS_PREV = "0".repeat(64);
const MAX_STORE_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_LINE_BYTES = 16 * 1024;
const MAX_LOCK_BYTES = 1024; // 1 KiB
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOCK_TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const EVENT_KEYS = ["seq", "type", "journeyId", "digest", "revision", "channel", "at", "prev", "hash"];

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_STALE_MS = 30000;
const DEFAULT_LOCK_RETRY_MS = 25;

function ok(value) { return Object.assign({ ok: true }, value); }
function bad(code, message) { return { ok: false, code, message: String(message || code).slice(0, 200) }; }

function isPlainObj(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const p = Object.getPrototypeOf(v);
    return p === Object.prototype || p === null;
}

function checkJourneyId(v) {
    return typeof v === "string" && Limits.NAME_PATTERN.test(v) && !/^\.+$/.test(v);
}

function defaultClock() { return new Date(); }

function isoNow(clock) {
    const d = (clock || defaultClock)();
    const iso = d.toISOString();
    return ISO_PATTERN.test(iso) ? iso : new Date().toISOString();
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// --------------------------------------------------------------- test-only pause seam
//
// Production code never sets this and the no-op path costs nothing extra.
// Used exclusively by tests/unit/ContractStoreConcurrency.check.js (via
// tests/unit/helpers/contract-store-worker.js, a separate process per
// worker) to deterministically interleave lock acquisition and commit
// across real cross-process races. There is no env var and no option
// threaded through any public caller; the only way to install a pause is
// this module-level hook, which each test worker process sets for itself.

let __pauseHook = null;
function __setPause(fn) { __pauseHook = typeof fn === "function" ? fn : null; }
async function __pause(point) { if (__pauseHook) await __pauseHook(point); }

// --------------------------------------------------------------- per-file write queue (in-process guard)

const fileQueues = new Map();

function withFileLock(key, fn) {
    const prev = fileQueues.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    // Keep the queue alive regardless of outcome, but never let a rejection
    // leak into the map's stored promise chain.
    fileQueues.set(key, run.then(() => {}, () => {}));
    return run;
}

// --------------------------------------------------------------- cross-process lock file

function lockOptsOf(opts) {
    const o = opts || {};
    const lockTimeoutMs = Number.isInteger(o.lockTimeoutMs) && o.lockTimeoutMs >= 0 ? o.lockTimeoutMs : DEFAULT_LOCK_TIMEOUT_MS;
    const lockStaleMs = Number.isInteger(o.lockStaleMs) && o.lockStaleMs >= 0 ? o.lockStaleMs : DEFAULT_LOCK_STALE_MS;
    const lockRetryMs = Number.isInteger(o.lockRetryMs) && o.lockRetryMs > 0 ? o.lockRetryMs : DEFAULT_LOCK_RETRY_MS;
    return { lockTimeoutMs, lockStaleMs, lockRetryMs };
}

function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // ESRCH: no such process -> dead. Anything else (e.g. EPERM) counts
        // as alive: we cannot prove it is dead, so we do not steal.
        return !(e && e.code === "ESRCH");
    }
}

function parseLockBuffer(buf) {
    if (!buf || buf.length === 0 || buf.length > MAX_LOCK_BYTES) return null;
    let text;
    try { text = buf.toString("utf8"); } catch { return null; }
    let value;
    try { value = JSON.parse(text); } catch { return null; }
    if (!isPlainObj(value)) return null;
    if (typeof value.token !== "string" || !LOCK_TOKEN_PATTERN.test(value.token)) return null;
    if (!Number.isInteger(value.pid) || value.pid <= 0) return null;
    if (!Number.isInteger(value.at)) return null;
    return value;
}

/** Bounded, symlink-refusing read of a lock file. Never throws. */
async function readLockRaw(lockFile) {
    let lst;
    try { lst = await fs.promises.lstat(lockFile); } catch {
        return { exists: false };
    }
    if (lst.isSymbolicLink()) return { exists: true, symlink: true, mtimeMs: lst.mtimeMs };
    if (!lst.isFile()) return { exists: true, broken: true, mtimeMs: lst.mtimeMs };
    let fh = null;
    try {
        // O_NOFOLLOW is absent on some platforms (e.g. Windows); the lstat symlink check above is then the only guard.
        fh = await fs.promises.open(lockFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const st = await fh.stat();
        if (!st.isFile() || st.size > MAX_LOCK_BYTES) return { exists: true, broken: true, mtimeMs: lst.mtimeMs };
        const buf = await fh.readFile();
        return { exists: true, mtimeMs: lst.mtimeMs, raw: buf, parsed: parseLockBuffer(buf) };
    } catch {
        return { exists: true, broken: true, mtimeMs: lst.mtimeMs };
    } finally {
        if (fh) { try { await fh.close(); } catch { /* ignore */ } }
    }
}

function lockSnapshotKey(info) {
    if (info && info.raw) return "r:" + crypto.createHash("sha256").update(info.raw).digest("hex");
    return "m:" + (info && info.mtimeMs);
}

/**
 * Try to remove a stale lockFile under the short-lived steal mutex
 * (`events.jsonl.lock.steal`, wx 0600). While that mutex file exists,
 * nobody else can create a *fresh* lockFile (their own wx create of
 * lockFile still fails EEXIST against the old stale content, and only a
 * mutex holder is permitted to unlink it) — so the re-read-then-unlink
 * done here under the mutex cannot race a concurrent writer's fresh lock
 * into being removed: by the time we hold the mutex, lockFile is either
 * still the exact content we judged stale (safe to unlink) or it has
 * already changed (we back off and let the caller retry from scratch).
 * Never throws.
 *
 * R1-B (issue #125): there is no automatic steal-mutex recovery. If this
 * process does not win the `wx` create of stealMutexFile -- for any reason,
 * including a dead, empty or unparseable leftover from a crashed holder --
 * it does nothing to that file and simply reports "did not steal this
 * round". No process ever unlinks a mutex it does not hold. The caller's
 * own retry loop and lockTimeoutMs deadline bound how long that is tried
 * for and yield the explicit LOCK_TIMEOUT once exhausted; clearing a
 * leftover mutex is an operator action, not something this code attempts.
 */
async function tryStealUnderMutex(lockFile, stealMutexFile, judgedInfo, lockStaleMs) {
    const mutexToken = crypto.randomBytes(16).toString("hex");
    const mutexPayload = JSON.stringify({ pid: process.pid, token: mutexToken, at: Date.now() });

    let fh;
    try {
        fh = await fs.promises.open(stealMutexFile, "wx", 0o600);
        try { await fh.writeFile(mutexPayload, "utf8"); } finally { await fh.close(); }
    } catch (e) {
        await __pause("mutexEexist");
        // Someone else already holds (or left behind) the steal mutex.
        // Fail closed this round; never inspect or unlink it. (Covers the
        // expected EEXIST case and any unexpected I/O error alike.)
        return;
    }

    try {
        const reInfo = await readLockRaw(lockFile);
        const ownerAlive = reInfo.parsed ? isPidAlive(reInfo.parsed.pid) : false;
        const stillSameStaleContent = reInfo.exists && !reInfo.symlink && Number.isFinite(reInfo.mtimeMs)
            && lockSnapshotKey(reInfo) === lockSnapshotKey(judgedInfo)
            && (Date.now() - reInfo.mtimeMs) > lockStaleMs
            && !ownerAlive;
        if (stillSameStaleContent) {
            try { await fs.promises.unlink(lockFile); } catch { /* ignore; wx create below retries */ }
        }
        // else: lock content changed or is no longer stale -- leave it alone, caller retries.
    } finally {
        const minfo = await readLockRaw(stealMutexFile);
        if (minfo.parsed && minfo.parsed.token === mutexToken) {
            try { await fs.promises.unlink(stealMutexFile); } catch { /* ignore */ }
        }
    }
}

/**
 * Acquire the per-journey lock file. Bounded retry with backoff up to
 * lockTimeoutMs (which also bounds any steal-mutex waiting below -- there
 * is no separate timeout for the steal path). A lock older than
 * lockStaleMs whose owning pid is provably dead may be stolen, but only by
 * unlinking it under the short-lived `events.jsonl.lock.steal` mutex after
 * re-reading and re-confirming staleness there (see tryStealUnderMutex);
 * there is no rename-aside step and no `.stale-*` file is ever created.
 * Never writes to the destination (events.jsonl) itself.
 */
async function acquireLock(lockFile, stealMutexFile, lockOpts) {
    const { lockTimeoutMs, lockStaleMs, lockRetryMs } = lockOptsOf(lockOpts);
    const deadline = Date.now() + lockTimeoutMs;
    const token = crypto.randomBytes(16).toString("hex");
    const payload = JSON.stringify({ pid: process.pid, token, at: Date.now() });

    for (;;) {
        try {
            const fh = await fs.promises.open(lockFile, "wx", 0o600);
            try { await fh.writeFile(payload, "utf8"); } finally { await fh.close(); }
            return { ok: true, token };
        } catch (e) {
            if (!e || e.code !== "EEXIST") return { ok: false, code: "LOCK_IO_ERROR" };
        }

        const info = await readLockRaw(lockFile);
        if (info.exists && !info.symlink && Number.isFinite(info.mtimeMs)) {
            const ageMs = Date.now() - info.mtimeMs;
            if (ageMs > lockStaleMs) {
                const ownerAlive = info.parsed ? isPidAlive(info.parsed.pid) : false;
                if (!ownerAlive) {
                    await __pause("afterStaleJudged");
                    await tryStealUnderMutex(lockFile, stealMutexFile, info, lockStaleMs);
                    // Whether or not this round actually removed lockFile, fall
                    // through to the deadline/backoff check and retry the wx
                    // create from the top; tryStealUnderMutex never fails closed
                    // on its own (no LOCK_CONTENTION short-circuit here).
                }
            }
        }

        if (Date.now() >= deadline) return { ok: false, code: "LOCK_TIMEOUT" };
        const wait = Math.min(lockRetryMs, Math.max(1, deadline - Date.now()));
        await sleep(wait);
    }
}

async function lockStillOwnedBy(lockFile, token) {
    const info = await readLockRaw(lockFile);
    return !!(info.parsed && info.parsed.token === token);
}

async function releaseLock(lockFile, token) {
    const info = await readLockRaw(lockFile);
    if (info.parsed && info.parsed.token === token) {
        try { await fs.promises.unlink(lockFile); } catch { /* ignore */ }
    }
}

/** Content fingerprint of the events file, symlink-refusing. Never throws. */
async function fileFingerprint(file) {
    let fh = null;
    try {
        fh = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const buf = await fh.readFile();
        return "h:" + crypto.createHash("sha256").update(buf).digest("hex");
    } catch (e) {
        if (e && e.code === "ENOENT") return "missing";
        return "err:" + ((e && e.code) || "UNKNOWN");
    } finally {
        if (fh) { try { await fh.close(); } catch { /* ignore */ } }
    }
}

// --------------------------------------------------------------- event hashing

function eventHash(e) {
    const { hash, ...rest } = e;
    return sha256(canonicalJson(rest));
}

function makeEvent(seq, type, journeyId, digest, revision, channel, at, prev) {
    const body = { seq, type, journeyId, digest, revision, channel, at, prev };
    return Object.assign({}, body, { hash: eventHash(body) });
}

function validateEventShape(e, expectedJourneyId) {
    if (!isPlainObj(e)) return false;
    const keys = Object.keys(e);
    if (keys.length !== EVENT_KEYS.length) return false;
    for (const k of keys) if (!EVENT_KEYS.includes(k)) return false;
    if (!Number.isInteger(e.seq) || e.seq < 1) return false;
    if (typeof e.type !== "string" || !EVENT_TYPES.includes(e.type)) return false;
    if (typeof e.journeyId !== "string" || e.journeyId !== expectedJourneyId) return false;
    if (typeof e.digest !== "string" || !DIGEST_PATTERN.test(e.digest)) return false;
    if (!Number.isInteger(e.revision) || e.revision < 1) return false;
    if (typeof e.channel !== "string" || !CHANNELS.includes(e.channel)) return false;
    if (typeof e.at !== "string" || !ISO_PATTERN.test(e.at)) return false;
    if (typeof e.prev !== "string" || !HASH_PATTERN.test(e.prev)) return false;
    if (typeof e.hash !== "string" || !HASH_PATTERN.test(e.hash)) return false;
    return true;
}

/**
 * Walk the ordered event list, enforcing hash chain, sequencing and the
 * lifecycle state machine. Returns null if the sequence is internally
 * consistent, or a short tamper code otherwise. Also returns the final
 * per-digest state map and the currently-approved digest, if any.
 */
function reduceChain(events, expectedJourneyId) {
    let prevHash = GENESIS_PREV;
    const state = new Map(); // digest -> current status
    const revisionOf = new Map(); // digest -> revision
    let approvedDigest = null;

    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (!validateEventShape(e, expectedJourneyId)) return { tamper: "MALFORMED_EVENT" };
        if (e.seq !== i + 1) return { tamper: "SEQ" };
        if (e.prev !== prevHash) return { tamper: "CHAIN" };
        if (eventHash(e) !== e.hash) return { tamper: "HASH" };

        const cur = state.get(e.digest);
        if (e.type === "PROPOSED") {
            if (cur !== undefined) return { tamper: "ILLEGAL_TRANSITION" };
            state.set(e.digest, "PROPOSED");
            revisionOf.set(e.digest, e.revision);
        } else if (e.type === "APPROVED") {
            if (cur !== "PROPOSED") return { tamper: "ILLEGAL_TRANSITION" };
            if (approvedDigest !== null) return { tamper: "ILLEGAL_TRANSITION" }; // must be superseded first
            state.set(e.digest, "APPROVED");
            approvedDigest = e.digest;
        } else if (e.type === "REJECTED") {
            if (cur !== "PROPOSED") return { tamper: "ILLEGAL_TRANSITION" };
            state.set(e.digest, "REJECTED");
        } else if (e.type === "SUPERSEDED") {
            if (cur !== "APPROVED" || approvedDigest !== e.digest) return { tamper: "ILLEGAL_TRANSITION" };
            state.set(e.digest, "SUPERSEDED");
            approvedDigest = null;
        } else {
            return { tamper: "MALFORMED_EVENT" };
        }
        prevHash = e.hash;
    }
    return { tamper: null, state, revisionOf, approvedDigest, lastHash: prevHash };
}

// --------------------------------------------------------------- bounded read

async function readStoreFile(file) {
    let lst;
    try { lst = await fs.promises.lstat(file); } catch (e) {
        if (e && e.code === "ENOENT") return { status: "missing" };
        return { status: "broken" };
    }
    if (lst.isSymbolicLink()) return { status: "broken" };
    if (!lst.isFile()) return { status: "broken" };

    let fh = null;
    try {
        try {
            fh = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        } catch (e) {
            return { status: "broken" };
        }
        const st = await fh.stat();
        if (!st.isFile()) return { status: "broken" };
        if (st.size > MAX_STORE_BYTES) return { status: "broken" };
        const buf = Buffer.alloc(st.size + 1);
        let off = 0;
        for (;;) {
            const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
            if (bytesRead === 0) break;
            off += bytesRead;
            if (off > st.size || off > MAX_STORE_BYTES) return { status: "broken" };
            if (off >= buf.length) break;
        }
        let text;
        try {
            text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, off));
        } catch { return { status: "broken" }; }
        if (text === "") return { status: "ok", events: [] };
        if (!text.endsWith("\n")) return { status: "broken" }; // truncated final line
        const lines = text.split("\n").slice(0, -1);
        const events = [];
        for (const line of lines) {
            if (line === "" || Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) return { status: "broken" };
            const parsed = Contract.parseJsonStrict(line);
            if (!parsed.ok) return { status: "broken" };
            events.push(parsed.value);
        }
        return { status: "ok", events };
    } catch {
        return { status: "broken" };
    } finally {
        if (fh) { try { await fh.close(); } catch { /* ignore */ } }
    }
}

/** Read + fully verify one journeyId's event log. Never throws. */
async function loadChain(root, journeyId) {
    if (!checkJourneyId(journeyId)) return { integrity: "broken", status: "missing", file: null };
    let file;
    try {
        file = SafeFs.resolveUnder(root, journeyId, "events.jsonl");
    } catch {
        return { integrity: "broken", status: "missing", file: null };
    }
    const read = await readStoreFile(file);
    if (read.status === "missing") return { integrity: "missing", file, events: [] };
    if (read.status === "broken") return { integrity: "broken", file, events: [] };

    const reduced = reduceChain(read.events, journeyId);
    if (reduced.tamper) return { integrity: "broken", file, events: read.events };
    return {
        integrity: "ok",
        file,
        events: read.events,
        state: reduced.state,
        revisionOf: reduced.revisionOf,
        approvedDigest: reduced.approvedDigest,
        lastHash: reduced.lastHash,
    };
}

async function writeChain(file, events) {
    const content = events.map((e) => JSON.stringify(e) + "\n").join("");
    const res = await SafeFs.writeAtomicPrivate(file, content);
    if (!res.ok) return bad("WRITE_FAILED", res.error);
    return { ok: true };
}

function normalizeOpts(opts) {
    const channel = (opts && opts.channel) || "cli";
    const clock = (opts && opts.clock) || defaultClock;
    return { channel, clock };
}

// --------------------------------------------------------------- lock-guarded mutation wrapper

/**
 * Resolve the lock and events file paths, take the in-process queue guard,
 * then the cross-process lock file, then invoke `fn(chain, file)` with a
 * freshly-loaded (never pre-lock) chain. `fn` must return either a plain
 * response object (no write — e.g. an error or idempotent result) or
 * `{ __write: true, events, response }` to append `events` atomically.
 * Immediately before the write, lock ownership and the events file content
 * are re-verified against what was observed right after the lock was taken;
 * any mismatch aborts with LOCK_LOST and writes nothing.
 */
async function withLock(root, journeyId, opts, fn) {
    let file, lockFile, stealMutexFile;
    try {
        file = SafeFs.resolveUnder(root, journeyId, "events.jsonl");
        lockFile = SafeFs.resolveUnder(root, journeyId, "events.jsonl.lock");
        stealMutexFile = SafeFs.resolveUnder(root, journeyId, "events.jsonl.lock.steal");
    } catch {
        return bad("PATH_INVALID", "journeyId invalid");
    }
    const resolvedLockOpts = lockOptsOf(opts);

    return await withFileLock(file, async () => {
        // Only mutating operations reach here; read-only status/isApproved
        // calls never create the journey directory, the lock file or
        // events.jsonl. The lock file lives in the same directory as
        // events.jsonl, which may not exist yet for a brand-new journey.
        try {
            await fs.promises.mkdir(path.dirname(lockFile), { recursive: true, mode: 0o700 });
        } catch {
            return bad("LOCK_IO_ERROR", "journey directory could not be created");
        }
        const acq = await acquireLock(lockFile, stealMutexFile, resolvedLockOpts);
        if (!acq.ok) {
            if (acq.code === "LOCK_TIMEOUT") return bad("LOCK_TIMEOUT", "lock acquisition timed out");
            if (acq.code === "LOCK_CONTENTION") return bad("LOCK_CONTENTION", "lock contended by another writer");
            return bad("LOCK_IO_ERROR", "lock file could not be created");
        }
        try {
            const chain = await loadChain(root, journeyId);
            const fingerprintBefore = await fileFingerprint(file);
            const result = await fn(chain, file);
            if (result && result.__write) {
                const stillOurs = await lockStillOwnedBy(lockFile, acq.token);
                if (!stillOurs) return bad("LOCK_LOST", "lock ownership lost before write");
                const fingerprintAfter = await fileFingerprint(file);
                if (fingerprintAfter !== fingerprintBefore) return bad("LOCK_LOST", "events file changed unexpectedly under lock");
                await __pause("beforeCommit");
                const w = await writeChain(file, result.events);
                if (!w.ok) return w;
                return result.response;
            }
            return result;
        } finally {
            await releaseLock(lockFile, acq.token);
        }
    });
}

// --------------------------------------------------------------- public API

async function propose(root, contract, opts) {
    try {
        const { channel, clock } = normalizeOpts(opts);
        if (!CHANNELS.includes(channel)) return bad("CHANNEL_INVALID", "unsupported channel");

        let value, digest;
        if (typeof contract === "string") {
            const r = Contract.parse(contract);
            if (!r.ok) return bad(r.code, r.message);
            value = r.value; digest = r.digest;
        } else {
            const r = Contract.validate(contract);
            if (!r.ok) return bad(r.code, r.message);
            value = r.value;
            digest = Contract.digestOf(value);
        }

        const journeyId = value.journeyId;
        const revision = value.revision;
        if (!checkJourneyId(journeyId)) return bad("PATH_INVALID", "journeyId invalid");

        return await withLock(root, journeyId, opts, async (chain) => {
            if (chain.integrity === "broken") return bad("STORE_BROKEN", "chain failed integrity verification");

            const events = chain.events || [];
            const existing = events.find((e) => e.digest === digest);
            if (existing) {
                const st = chain.state ? chain.state.get(digest) : undefined;
                return ok({ idempotent: true, status: st || "PROPOSED", digest, journeyId });
            }

            let maxRevision = 0;
            if (chain.revisionOf) for (const r of chain.revisionOf.values()) maxRevision = Math.max(maxRevision, r);
            if (events.length > 0 && revision <= maxRevision) return bad("REVISION_NOT_INCREASED", "revision must increase");

            const at = isoNow(clock);
            const prev = chain.lastHash || GENESIS_PREV;
            const seq = events.length + 1;
            const event = makeEvent(seq, "PROPOSED", journeyId, digest, revision, channel, at, prev);
            const newEvents = events.concat([event]);
            return { __write: true, events: newEvents, response: ok({ idempotent: false, status: "PROPOSED", digest, journeyId }) };
        });
    } catch (e) {
        return bad("INTERNAL", e && e.message);
    }
}

async function approve(root, journeyId, digest, opts) {
    return transition(root, journeyId, digest, "APPROVED", opts);
}

async function reject(root, journeyId, digest, opts) {
    return transition(root, journeyId, digest, "REJECTED", opts);
}

async function transition(root, journeyId, digest, type, opts) {
    try {
        const { channel, clock } = normalizeOpts(opts);
        if (!CHANNELS.includes(channel)) return bad("CHANNEL_INVALID", "unsupported channel");
        if (!checkJourneyId(journeyId)) return bad("PATH_INVALID", "journeyId invalid");
        if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) return bad("DIGEST_INVALID", "digest malformed");

        return await withLock(root, journeyId, opts, async (chain, file) => {
            if (chain.integrity === "broken") return bad("STORE_BROKEN", "chain failed integrity verification");
            if (chain.integrity === "missing" || !chain.state || !chain.state.has(digest)) {
                return bad("NOT_PROPOSED", "digest was never proposed for this journey");
            }
            const current = chain.state.get(digest);
            if (current !== "PROPOSED") return bad("INVALID_TRANSITION", `cannot move from ${current} to ${type}`);

            const at = isoNow(clock);
            const events = chain.events.slice();
            let seq = events.length + 1;
            let prev = chain.lastHash;

            if (type === "APPROVED" && chain.approvedDigest && chain.approvedDigest !== digest) {
                const oldDigest = chain.approvedDigest;
                const oldRevision = chain.revisionOf.get(oldDigest);
                const supersede = makeEvent(seq, "SUPERSEDED", journeyId, oldDigest, oldRevision, channel, at, prev);
                events.push(supersede);
                seq += 1;
                prev = supersede.hash;
            }

            const revision = chain.revisionOf.get(digest);
            const event = makeEvent(seq, type, journeyId, digest, revision, channel, at, prev);
            events.push(event);

            return { __write: true, events, response: ok({ status: type, digest, journeyId }) };
        });
    } catch (e) {
        return bad("INTERNAL", e && e.message);
    }
}

async function status(root, journeyId, digest) {
    try {
        if (!checkJourneyId(journeyId)) return ok({ status: "UNKNOWN", integrity: "missing" });
        if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) return ok({ status: "UNKNOWN", integrity: "missing" });
        const chain = await loadChain(root, journeyId);
        if (chain.integrity === "missing") return ok({ status: "UNKNOWN", integrity: "missing" });
        if (chain.integrity === "broken") return ok({ status: "UNKNOWN", integrity: "broken" });
        const st = chain.state.has(digest) ? chain.state.get(digest) : "UNKNOWN";
        return ok({ status: st, integrity: "ok" });
    } catch (e) {
        return bad("INTERNAL", e && e.message);
    }
}

async function isApproved(root, journeyId, digest) {
    const r = await status(root, journeyId, digest);
    if (!r.ok) return false;
    return r.integrity === "ok" && r.status === "APPROVED";
}

module.exports = {
    propose, approve, reject, status, isApproved,
    EVENT_TYPES, CHANNELS, GENESIS_PREV,
    // Exposed only for deterministic cross-process lock testing
    // (tests/unit/ContractStoreConcurrency.check.js). Not part of the public
    // contract-lifecycle API and must not be used to bypass lifecycle rules.
    __lockTestHooks: { acquireLock, releaseLock, lockOptsOf, setPause: __setPause },
};
