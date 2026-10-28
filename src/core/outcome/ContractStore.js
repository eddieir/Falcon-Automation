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
 *
 * G77B-02 (issue #125): the three lock options (`lockTimeoutMs`,
 * `lockStaleMs`, `lockRetryMs`) are validated and bounds-checked before any
 * lock or journey I/O is attempted. `lockTimeoutMs` and `lockStaleMs` must
 * each be a strict integer in [1, 300000] (1ms..5min) — never zero, never
 * unbounded ("an unlimited wait" is explicitly disallowed). `lockRetryMs`
 * must be a strict integer in [1, 60000], additionally capped per call at
 * whichever is smaller of that or the resolved `lockTimeoutMs`, so a retry
 * interval can never exceed (or default its way past) the timeout it backs
 * off within. Only `typeof "number"` values passing `Number.isSafeInteger`
 * are accepted — NaN, Infinity, floats, strings and booleans are all
 * rejected, never coerced or silently truncated. An omitted option resolves
 * to its documented default, itself clamped into range. Any out-of-range or
 * wrong-typed value fails the whole call closed with
 * `{ ok: false, code: "INVALID_LOCK_OPTION" }` before `acquireLock` creates
 * the journey directory or attempts a `wx` open — there is no code path
 * through `propose`/`approve`/`reject` that reaches a write, or that skips
 * lock acquisition, on invalid lock-option input.
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
 *
 * G77B-03 (issue #125): a deterministic, Git-ignored *default* store
 * location. `defaultStoreRoot(repoRoot)` resolves to
 * `<repoRoot>/data/outcome-approvals`, where `repoRoot` defaults to
 * `path.join(__dirname, '..', '..', '..')` (this file lives at
 * `src/core/outcome/ContractStore.js`, so three levels up is the repo
 * root). This is purely additive: `propose`/`approve`/`reject`/`status`/
 * `isApproved` still take an explicit `root` argument and never consult
 * this default themselves — nothing here changes their behaviour.
 * `resolveStoreRoot(overrideRoot, repoRoot)` is the fail-closed gate for any
 * caller (CLI/config) that wants to turn an optional override into a root:
 * no override resolves to the default (rejecting it if the default's own
 * `data`/`outcome-approvals` ancestry has been replaced by a symlink at all —
 * even one pointing at another directory inside `repoRoot` — since that
 * swap would otherwise defeat the `.gitignore` rule below just as surely as
 * one pointing outside `repoRoot`); a supplied override must be a non-empty,
 * NUL-free, absolute string with no literal `..` traversal segment, and is
 * otherwise used as-is (an explicit root, e.g. a test's tmpdir, is trusted
 * by the caller and is not required to resolve under any particular base).
 * Any rejection returns `{ ok: false, code: "INVALID_STORE_ROOT" }`, matching
 * the shape of every other fail-closed result in this module, before any
 * directory is created or file touched.
 *
 * The default directory is covered by the repo's broad `data/` ignore rule
 * and additionally by its own narrow, commented `.gitignore` entry (so it
 * stays ignored even if the broader rule is ever narrowed). A store file
 * under this path is never part of `package.json`'s publish set and is
 * never uploaded as a CI artifact (CI only restores/uploads specific
 * allowlisted `data/*.json` tracker files, never the whole `data/` tree).
 *
 * A store file's mere presence confers no approval by itself: `isApproved`/
 * `status` only ever report `APPROVED` for a digest whose full event history
 * reduces cleanly through `reduceChain` — a hand-forged or truncated file
 * with no valid, hash-chained `PROPOSED` predecessor is read as
 * `integrity: "broken"` or lacks the digest in `state`, never as approved.
 *
 * Required downstream gate for WP-77b (G77B-03, tracked, not implemented
 * here): execution-time digest binding — the executor must recompute the
 * digest from the exact contract it runs (same `journeyId`) before trusting
 * any `isApproved` result for that run; a store file approving a *different*
 * contract body under the same digest-looking string is out of scope for
 * this module and must be closed before WP-77b wires this store into
 * execution or the dashboard.
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

// G77B-02 (issue #125): documented, enforced bounds for the three lock
// options. `lockTimeoutMs`/`lockStaleMs` share the same [1ms, 5min] range —
// below 1ms the deadline math degenerates (an immediately-expired wait that
// cannot distinguish "no contention" from "gave up"), and above 5 minutes a
// caller would be granting itself what is, in practice, an unlimited wait, the
// one thing this lock is documented to never do. `lockRetryMs` has a 1ms
// floor (never a zero/negative busy-spin) and is additionally capped, per
// call, at whichever is smaller of MAX_LOCK_RETRY_MS or the resolved
// lockTimeoutMs for that same call — a retry interval may never exceed the
// timeout it backs off within. Values outside these ranges are rejected
// fail-closed with `{ ok: false, code: "INVALID_LOCK_OPTION" }` before any
// lock file is touched (no directory is created, no wx open is attempted);
// an unset option still resolves to the documented default, clamped into the
// same range so a default can never itself violate the retry-vs-timeout
// invariant. Only a strict, non-NaN, non-Infinity, integer `typeof "number"`
// passing `Number.isSafeInteger` is ever accepted — floats, strings,
// booleans, NaN and Infinity are all rejected, never coerced.
const MIN_LOCK_TIMEOUT_MS = 1;
const MAX_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MIN_LOCK_STALE_MS = 1;
const MAX_LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes
const MIN_LOCK_RETRY_MS = 1;
const MAX_LOCK_RETRY_MS = 60 * 1000; // 1 minute, further capped by lockTimeoutMs per call

function ok(value) { return Object.assign({ ok: true }, value); }
function bad(code, message) { return { ok: false, code, message: String(message || code).slice(0, 200) }; }

// --------------------------------------------------------------- default store location (G77B-03, issue #125)

// `path.join('data', 'outcome-approvals')` relative subpath, exposed so
// callers/tests can assert against the real value instead of duplicating it.
const DEFAULT_STORE_SUBPATH = path.join("data", "outcome-approvals");

/**
 * Deterministic default store root: `<repoRoot>/data/outcome-approvals`.
 * `repoRoot` defaults to three levels up from this file
 * (`src/core/outcome/` -> repo root); pass it explicitly only for tests that
 * need an isolated fake repo root. Never throws, never touches the
 * filesystem. Does not validate the result for symlink escape — that is
 * `resolveStoreRoot`'s job.
 */
function defaultStoreRoot(repoRoot) {
    const base = (typeof repoRoot === "string" && repoRoot.length > 0)
        ? repoRoot
        : path.join(__dirname, "..", "..", "..");
    return path.join(base, DEFAULT_STORE_SUBPATH);
}

/** True if `p` contains a literal `..` path segment (string-level, pre-resolve). */
function hasTraversalSegment(p) {
    return p.split(/[\\/]+/).some((seg) => seg === "..");
}

/**
 * True if any existing ancestor of `targetPath`, strictly below
 * `allowedBaseResolved` (exclusive — `allowedBaseResolved` itself is never
 * inspected), is a symlink. This is deliberately not limited to a symlink
 * whose realpath happens to resolve *outside* `allowedBaseResolved`: a
 * symlink placed at `data` or `data/outcome-approvals` that points at some
 * other directory *inside* the repo would still defeat the `.gitignore`
 * protection on the real, intended default path, so any symlink among these
 * components is rejected regardless of where it points. `allowedBaseResolved`
 * itself (the repo root) is never flagged even if it is reached through a
 * symlinked parent (e.g. macOS's `/tmp` -> `/private/tmp`) — only components
 * strictly below it are inspected. Only ancestors that currently exist on
 * disk are inspected (a not-yet-created default directory is not itself an
 * escape).
 */
function hasSymlinkEscape(targetPath, allowedBaseResolved) {
    let cur = targetPath;
    for (;;) {
        if (cur === allowedBaseResolved) break;
        let lst;
        try { lst = fs.lstatSync(cur); } catch { lst = null; }
        if (lst && lst.isSymbolicLink()) return true;
        const parent = path.dirname(cur);
        if (parent === cur) break; // reached filesystem root without meeting allowedBaseResolved
        cur = parent;
    }
    return false;
}

/**
 * Resolve either the default store root or a caller-supplied override to a
 * usable `root` string, validating it fail-closed. Returns
 * `{ ok: true, root }` or `{ ok: false, code: "INVALID_STORE_ROOT", message }`.
 *
 * `overrideRoot === undefined || null` resolves to `defaultStoreRoot(repoRoot)`,
 * rejected if the default path's own ancestry has been replaced by a
 * symlink leading outside `repoRoot` (or its own default). A supplied
 * override must be a non-empty, NUL-free, absolute string containing no
 * literal `..` segment; it is then used as-is (an explicit root is trusted
 * by its caller — e.g. a test's tmpdir — and is not checked for symlink
 * escape, since there is no "allowed base" for it to escape from).
 *
 * This function is additive: `propose`/`approve`/`reject`/`status`/
 * `isApproved` do not call it and their explicit-`root` behaviour is
 * unchanged. Callers that want the default location, or a validated
 * override of it, call this first and pass its `root` through.
 */
function resolveStoreRoot(overrideRoot, repoRoot) {
    if (overrideRoot === undefined || overrideRoot === null) {
        const root = defaultStoreRoot(repoRoot);
        const allowedBase = path.resolve((typeof repoRoot === "string" && repoRoot.length > 0)
            ? repoRoot
            : path.join(__dirname, "..", "..", ".."));
        if (hasSymlinkEscape(root, allowedBase)) {
            return bad("INVALID_STORE_ROOT", "default store root escapes the repository via a symlink");
        }
        return { ok: true, root };
    }
    if (typeof overrideRoot !== "string" || overrideRoot.length === 0) {
        return bad("INVALID_STORE_ROOT", "store root override must be a non-empty string");
    }
    if (overrideRoot.includes("\0")) {
        return bad("INVALID_STORE_ROOT", "store root override must not contain NUL bytes");
    }
    if (hasTraversalSegment(overrideRoot)) {
        return bad("INVALID_STORE_ROOT", "store root override must not contain '..' traversal segments");
    }
    if (!path.isAbsolute(overrideRoot)) {
        return bad("INVALID_STORE_ROOT", "store root override must be an absolute path");
    }
    return { ok: true, root: overrideRoot };
}

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

function clampToRange(def, min, max) { return Math.min(Math.max(def, min), max); }

/**
 * Validate and resolve one lock option. `v === undefined` resolves to `def`,
 * clamped into [min, max] so a caller-unset option can never itself violate
 * the bound. Any other value must be a strict `typeof "number"` passing
 * `Number.isSafeInteger` (rejects NaN, Infinity, floats, strings, booleans)
 * and must fall within [min, max]; otherwise fails closed with
 * `INVALID_LOCK_OPTION`.
 */
function validateBoundedLockOption(name, v, def, min, max) {
    if (v === undefined) return { ok: true, value: clampToRange(def, min, max) };
    if (typeof v !== "number" || !Number.isSafeInteger(v)) {
        return bad("INVALID_LOCK_OPTION", `${name} must be a safe integer`);
    }
    if (v < min || v > max) {
        return bad("INVALID_LOCK_OPTION", `${name} must be between ${min} and ${max}`);
    }
    return { ok: true, value: v };
}

/**
 * Resolve and validate all three lock options together. Returns
 * `{ ok: true, lockTimeoutMs, lockStaleMs, lockRetryMs }` or
 * `{ ok: false, code: "INVALID_LOCK_OPTION", message }`. `lockRetryMs`'s
 * upper bound is additionally capped at the resolved `lockTimeoutMs` for
 * this same call, so a retry interval can never exceed (or, via the clamped
 * default path, silently inherit a default that would exceed) the timeout
 * it backs off within. Idempotent: calling this again on its own `ok: true`
 * output (which carries only already-valid values) re-validates to the same
 * result.
 */
function lockOptsOf(opts) {
    const o = opts || {};
    const t = validateBoundedLockOption("lockTimeoutMs", o.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS, MIN_LOCK_TIMEOUT_MS, MAX_LOCK_TIMEOUT_MS);
    if (!t.ok) return t;
    const s = validateBoundedLockOption("lockStaleMs", o.lockStaleMs, DEFAULT_LOCK_STALE_MS, MIN_LOCK_STALE_MS, MAX_LOCK_STALE_MS);
    if (!s.ok) return s;
    const retryMax = Math.min(MAX_LOCK_RETRY_MS, t.value);
    const r = validateBoundedLockOption("lockRetryMs", o.lockRetryMs, DEFAULT_LOCK_RETRY_MS, MIN_LOCK_RETRY_MS, retryMax);
    if (!r.ok) return r;
    return { ok: true, lockTimeoutMs: t.value, lockStaleMs: s.value, lockRetryMs: r.value };
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
        // O_NONBLOCK: a FIFO opened O_RDONLY alone blocks until a writer
        // attaches; non-blocking open returns immediately regardless, so a
        // lock path replaced by a FIFO/device can never hang this read.
        // O_NOFOLLOW is absent on some platforms (e.g. Windows); the lstat symlink check above is then the only guard.
        fh = await fs.promises.open(lockFile, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
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
    const resolved = lockOptsOf(lockOpts);
    if (!resolved.ok) return resolved; // INVALID_LOCK_OPTION: fail closed, no wx open attempted
    const { lockTimeoutMs, lockStaleMs, lockRetryMs } = resolved;
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

/**
 * Content fingerprint of the events file. Never throws, never blocks: the
 * open is non-blocking (FH, G77B-01) and the handle's own fstat -- not a
 * pre-open lstat -- decides whether this is a regular file, so a path
 * swapped to a FIFO/dir/socket/device right before open is still rejected
 * instead of hung on or trusted. A post-open lstat of the path is compared
 * by (dev, ino) against the open handle to catch the path being replaced
 * between validation and open.
 *
 * P3-3 (issue #125): the read itself is bounded by an explicit read loop
 * (mirroring `readStoreFile`) rather than `fh.readFile()`, which would
 * allocate and buffer however much the file delivers. `fstat`'s reported
 * size is only a point-in-time snapshot; a file that grows after it (e.g.
 * someone appending past `MAX_STORE_BYTES` between the `stat()` above and
 * the read below) can never force an unbounded read or allocation here —
 * the loop bails with `err:UNSUPPORTED_TYPE` the moment more bytes arrive
 * than the already-validated size allows.
 */
async function fileFingerprint(file) {
    let fh = null;
    try {
        fh = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
        const st = await fh.stat();
        if (!st.isFile() || st.size > MAX_STORE_BYTES) return "err:UNSUPPORTED_TYPE";
        let lst;
        try { lst = await fs.promises.lstat(file); } catch { return "err:REPLACED"; }
        if (lst.isSymbolicLink() || lst.dev !== st.dev || lst.ino !== st.ino) return "err:REPLACED";
        const buf = Buffer.alloc(st.size + 1);
        let off = 0;
        for (;;) {
            const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
            if (bytesRead === 0) break;
            off += bytesRead;
            if (off > st.size || off > MAX_STORE_BYTES) return "err:UNSUPPORTED_TYPE";
            if (off >= buf.length) break;
        }
        return "h:" + crypto.createHash("sha256").update(buf.subarray(0, off)).digest("hex");
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

/**
 * FH / G77B-01 (issue #125): before any potentially-blocking read of the
 * events file, open non-blocking (O_RDONLY|O_NONBLOCK|O_NOFOLLOW where
 * available) so a FIFO/device at that path can never hang the open, then
 * decide the file's type from the open handle's own fstat -- never from a
 * preceding lstat of the path, which could be stale by the time open()
 * runs. Any non-regular type (FIFO, directory, socket, device) or
 * oversized file is rejected before any read is attempted. A post-open
 * lstat of the path is compared by (dev, ino) against the handle to detect
 * the path having been replaced (including by a symlink) between whatever
 * earlier check ran and this open.
 */
async function readStoreFile(file) {
    let fh = null;
    try {
        try {
            fh = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
        } catch (e) {
            if (e && e.code === "ENOENT") return { status: "missing" };
            return { status: "broken" };
        }
        const st = await fh.stat();
        if (!st.isFile()) return { status: "broken" };
        if (st.size > MAX_STORE_BYTES) return { status: "broken" };
        let lst;
        try { lst = await fs.promises.lstat(file); } catch { return { status: "broken" }; }
        if (lst.isSymbolicLink() || lst.dev !== st.dev || lst.ino !== st.ino) return { status: "broken" };
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
    if (!resolvedLockOpts.ok) return resolvedLockOpts; // INVALID_LOCK_OPTION: fail closed before any lock/journey I/O

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
            if (acq.code === "INVALID_LOCK_OPTION") return acq;
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
                // An "err:*" fingerprint is never trusted as a basis for
                // "unchanged" — two equal error strings do not prove the
                // file's content is actually the same, only that the same
                // kind of read failure happened twice. Fail closed whenever
                // either fingerprint is an error, even if they are identical.
                if (fingerprintBefore.startsWith("err:") || fingerprintAfter.startsWith("err:") || fingerprintAfter !== fingerprintBefore) {
                    return bad("LOCK_LOST", "events file changed unexpectedly under lock");
                }
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
    // G77B-03 (issue #125): deterministic, Git-ignored default store
    // location and its fail-closed override validation. Additive only —
    // propose/approve/reject/status/isApproved above are unchanged and never
    // call these; callers that want the default location call
    // resolveStoreRoot() themselves and pass its `root` through.
    defaultStoreRoot, resolveStoreRoot, DEFAULT_STORE_SUBPATH,
    // G77B-02 (issue #125): documented lock-option bounds, exposed read-only
    // so tests can assert against the real constants instead of duplicating
    // the numbers. lockRetryMs's effective max is additionally capped per
    // call at the resolved lockTimeoutMs (see lockOptsOf); this is the
    // absolute ceiling before that per-call cap.
    LOCK_OPTION_BOUNDS: Object.freeze({
        lockTimeoutMs: Object.freeze({ min: MIN_LOCK_TIMEOUT_MS, max: MAX_LOCK_TIMEOUT_MS, default: DEFAULT_LOCK_TIMEOUT_MS }),
        lockStaleMs: Object.freeze({ min: MIN_LOCK_STALE_MS, max: MAX_LOCK_STALE_MS, default: DEFAULT_LOCK_STALE_MS }),
        lockRetryMs: Object.freeze({ min: MIN_LOCK_RETRY_MS, max: MAX_LOCK_RETRY_MS, default: DEFAULT_LOCK_RETRY_MS }),
    }),
    // Exposed only for deterministic cross-process lock testing
    // (tests/unit/ContractStoreConcurrency.check.js). Not part of the public
    // contract-lifecycle API and must not be used to bypass lifecycle rules.
    __lockTestHooks: { acquireLock, releaseLock, lockOptsOf, setPause: __setPause },
};
