/**
 * src/production-cycle/RunPaths.js — run-id validation and no-follow path
 * resolution for the production-cycle ledger tree (ADR-0018 section 7,
 * Sec-00b D-06/D-07).
 *
 * Nothing here shells out — the git common dir is injected by the caller
 * (e.g. via `git rev-parse --git-common-dir`), never resolved in this
 * module, keeping this file synchronous, dependency-free, and testable
 * against an mkdtemp fixture that is never the real repository.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const RUN_ID_MAX = 64;
// ASCII-only by construction — a unicode lookalike digit/letter simply
// cannot match this class, so it is rejected without special-casing.
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const WINDOWS_DEVICE_NAMES = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
]);

/**
 * Validate a candidate run id against the closed rule set (D-06): the
 * schema's own regex, length cap, no "." / ".." anywhere, no path
 * separators, no "%", not absolute, no trailing ".", not a Windows
 * reserved device name (case-insensitive), no leading "-". Never throws.
 *
 * @param {*} runId
 * @returns {{ok: boolean, code?: string}}
 */
function validateRunId(runId) {
    if (typeof runId !== "string" || runId.length === 0) {
        return { ok: false, code: "RUNID_INVALID" };
    }
    if (runId.length > RUN_ID_MAX) {
        return { ok: false, code: "RUNID_TOO_LONG" };
    }
    if (runId === "." || runId === "..") {
        return { ok: false, code: "RUNID_DOT_SEGMENT" };
    }
    if (runId.includes("..")) {
        return { ok: false, code: "RUNID_TRAVERSAL" };
    }
    if (runId.includes("/") || runId.includes("\\")) {
        return { ok: false, code: "RUNID_SEPARATOR" };
    }
    if (runId.includes("%")) {
        return { ok: false, code: "RUNID_PERCENT" };
    }
    if (path.isAbsolute(runId)) {
        return { ok: false, code: "RUNID_ABSOLUTE" };
    }
    if (runId.endsWith(".")) {
        return { ok: false, code: "RUNID_TRAILING_DOT" };
    }
    if (runId.startsWith("-")) {
        return { ok: false, code: "RUNID_LEADING_DASH" };
    }
    const base = runId.split(".")[0].toUpperCase();
    if (WINDOWS_DEVICE_NAMES.has(base)) {
        return { ok: false, code: "RUNID_RESERVED_DEVICE_NAME" };
    }
    if (!RUN_ID_RE.test(runId)) {
        return { ok: false, code: "RUNID_INVALID" };
    }
    return { ok: true };
}

/**
 * Resolve the run directory for an already-validated runId under
 * `<gitCommonDir>/production-cycle/<runId>`, refusing any symlink or
 * ownership mismatch on the way down (D-06/D-07). `gitCommonDir` is
 * supplied by the caller — this module never shells out to discover it.
 * Never throws; every failure mode returns `{ok:false, code}`.
 *
 * @param {string} gitCommonDir
 * @param {string} runId
 * @returns {{ok: boolean, code?: string, runDir?: string, eventsPath?: string}}
 */
function resolveRunDir(gitCommonDir, runId) {
    const idCheck = validateRunId(runId);
    if (!idCheck.ok) return idCheck;

    if (typeof gitCommonDir !== "string" || gitCommonDir.length === 0) {
        return { ok: false, code: "RUNID_ROOT_INVALID" };
    }

    const pcDir = path.join(gitCommonDir, "production-cycle");
    let pcLstat;
    try {
        pcLstat = fs.lstatSync(pcDir);
    } catch {
        return { ok: false, code: "RUNID_ROOT_MISSING" };
    }
    if (pcLstat.isSymbolicLink()) {
        return { ok: false, code: "RUNID_ROOT_SYMLINK" };
    }
    if (!pcLstat.isDirectory()) {
        return { ok: false, code: "RUNID_ROOT_NOT_DIR" };
    }
    if (typeof process.getuid === "function" && pcLstat.uid !== process.getuid()) {
        return { ok: false, code: "RUNID_ROOT_OWNER_MISMATCH" };
    }

    const candidate = path.join(pcDir, runId);
    let runLstat;
    try {
        runLstat = fs.lstatSync(candidate);
    } catch {
        return { ok: false, code: "RUNID_DIR_MISSING" };
    }
    if (runLstat.isSymbolicLink()) {
        return { ok: false, code: "RUNID_DIR_SYMLINK" };
    }
    if (!runLstat.isDirectory()) {
        return { ok: false, code: "RUNID_DIR_NOT_DIR" };
    }

    let realDir;
    try {
        realDir = fs.realpathSync(candidate);
    } catch {
        return { ok: false, code: "RUNID_DIR_MISSING" };
    }
    const expected = path.join(pcDir, runId);
    if (realDir !== fs.realpathSync(pcDir) + path.sep + runId && realDir !== expected) {
        // realpath of pcDir may itself differ by trailing separators across
        // platforms; compare against the fully-realpath'd expectation too.
        if (realDir !== path.join(fs.realpathSync(pcDir), runId)) {
            return { ok: false, code: "RUNID_DIR_REALPATH_MISMATCH" };
        }
    }

    const eventsPath = path.join(candidate, "events.jsonl");
    let eventsLstat;
    try {
        eventsLstat = fs.lstatSync(eventsPath);
    } catch {
        return { ok: true, runDir: candidate, eventsPath, eventsMissing: true };
    }
    if (eventsLstat.isSymbolicLink()) {
        return { ok: false, code: "EVENTS_SYMLINK" };
    }
    if (!eventsLstat.isFile()) {
        return { ok: false, code: "EVENTS_NOT_FILE" };
    }
    if (eventsLstat.nlink !== 1) {
        return { ok: false, code: "EVENTS_HARD_LINKED" };
    }

    return { ok: true, runDir: candidate, eventsPath };
}

/**
 * Open the ledger file for reading without ever following a symlink
 * (D-07) — O_RDONLY|O_NOFOLLOW. Returns the fd plus the fstat dev/ino pair
 * so a caller can re-check for a swap after startup. Never throws; a
 * failure (including ELOOP for a symlink target) returns `{ok:false}`.
 *
 * @param {string} filePath
 * @returns {{ok: boolean, code?: string, fd?: number, dev?: number, ino?: number}}
 */
function openLedgerNoFollow(filePath) {
    const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
    let fd;
    try {
        fd = fs.openSync(filePath, flags);
    } catch {
        return { ok: false, code: "EVENTS_OPEN_FAILED" };
    }
    try {
        const st = fs.fstatSync(fd);
        if (!st.isFile()) {
            fs.closeSync(fd);
            return { ok: false, code: "EVENTS_NOT_FILE" };
        }
        return { ok: true, fd, dev: st.dev, ino: st.ino };
    } catch {
        try {
            fs.closeSync(fd);
        } catch {
            /* already invalid, nothing to clean up */
        }
        return { ok: false, code: "EVENTS_FSTAT_FAILED" };
    }
}

module.exports = { validateRunId, resolveRunDir, openLedgerNoFollow, WINDOWS_DEVICE_NAMES };
