"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Limits = require("./Limits");

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class SafeFsError extends Error {
    constructor(code, message) {
        super(String(message || code).slice(0, 200));
        this.name = "SafeFsError";
        this.code = code;
    }
}

function _real(p) {
    return fs.realpathSync(p);
}

function _under(root, target) {
    const rel = path.relative(root, target);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Join bare names onto root. Every name must match the fixed pattern and not
 * be a dot-only name. The result must stay under realpath(root), including
 * through any already-existing symlinked intermediate directory.
 * Throws SafeFsError.
 */
function resolveUnder(root, ...names) {
    if (typeof root !== "string" || root.length === 0 || root.includes("\0")) {
        throw new SafeFsError("PATH_ROOT_INVALID", "root is invalid");
    }
    if (names.length === 0) throw new SafeFsError("PATH_NAME_INVALID", "no name given");
    for (const n of names) {
        if (typeof n !== "string" || !Limits.NAME_PATTERN.test(n) || /^\.+$/.test(n)) {
            throw new SafeFsError("PATH_NAME_INVALID", "name rejected");
        }
    }
    let realRoot;
    try { realRoot = _real(root); } catch { throw new SafeFsError("PATH_ROOT_INVALID", "root not resolvable"); }
    let cur = realRoot;
    for (const n of names) {
        cur = path.join(cur, n);
        let st = null;
        try { st = fs.lstatSync(cur); } catch { /* not yet created */ }
        if (st) {
            let r;
            try { r = _real(cur); } catch { throw new SafeFsError("PATH_ESCAPE", "path not resolvable"); }
            if (!_under(realRoot, r)) throw new SafeFsError("PATH_ESCAPE", "path escapes root");
        }
    }
    if (!_under(realRoot, cur)) throw new SafeFsError("PATH_ESCAPE", "path escapes root");
    return cur;
}

/** Iterative walk: depth, forbidden keys, non-finite numbers. Returns error code or null. */
function inspectValue(value, maxDepth) {
    const stack = [[value, 1]];
    while (stack.length) {
        const [v, d] = stack.pop();
        if (typeof v === "number") {
            if (!Number.isFinite(v)) return "NON_FINITE";
        } else if (v !== null && typeof v === "object") {
            if (d > maxDepth) return "TOO_DEEP";
            const keys = Object.keys(v);
            for (const k of keys) {
                if (FORBIDDEN_KEYS.has(k)) return "FORBIDDEN_KEY";
                stack.push([v[k], d + 1]);
            }
        }
    }
    return null;
}

/** Cheap pre-parse nesting scan so a hostile file cannot exhaust the parser. */
function _scanDepth(text, maxDepth) {
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (inStr) {
            if (c === 92) i++;
            else if (c === 34) inStr = false;
        } else if (c === 34) inStr = true;
        else if (c === 123 || c === 91) { if (++depth > maxDepth) return false; }
        else if (c === 125 || c === 93) depth--;
    }
    return true;
}

function fail(code, message) {
    return { ok: false, code, message: String(message || code).slice(0, 200) };
}

/**
 * Bounded, symlink-refusing JSON read. Never throws, never returns raw content
 * in errors. The sha256 is of the exact buffer that was parsed. Returns {ok:true,value,bytes,sha256} | {ok:false,code,message}.
 */
async function readBoundedJson(file, opts = {}) {
    const maxBytes = opts.maxBytes;
    const maxDepth = opts.maxDepth;
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || !Number.isInteger(maxDepth) || maxDepth < 1) {
        return fail("READ_OPTIONS_INVALID", "maxBytes and maxDepth are required");
    }
    if (typeof file !== "string" || file.length === 0 || file.includes("\0")) {
        return fail("READ_PATH_INVALID", "path invalid");
    }
    let fh = null;
    try {
        let lst;
        try { lst = await fs.promises.lstat(file); } catch (e) {
            return fail(e && e.code === "ENOENT" ? "READ_NOT_FOUND" : "READ_FAILED", "cannot stat file");
        }
        if (lst.isSymbolicLink()) return fail("READ_SYMLINK", "symlink refused");
        if (!lst.isFile()) return fail("READ_NOT_REGULAR", "not a regular file");
        try {
            fh = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        } catch (e) {
            return fail(e && e.code === "ELOOP" ? "READ_SYMLINK" : "READ_FAILED", "cannot open file");
        }
        const st = await fh.stat();
        if (!st.isFile()) return fail("READ_NOT_REGULAR", "not a regular file");
        if (st.size > maxBytes) return fail("READ_TOO_LARGE", "file exceeds size cap");
        const buf = Buffer.alloc(st.size + 1);
        let off = 0;
        for (;;) {
            const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
            if (bytesRead === 0) break;
            off += bytesRead;
            if (off > st.size) return fail("READ_TOO_LARGE", "file changed while reading");
            if (off > maxBytes) return fail("READ_TOO_LARGE", "file exceeds size cap");
            if (off >= buf.length) break;
        }
        let text;
        try {
            text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, off));
        } catch { return fail("READ_NOT_UTF8", "invalid UTF-8"); }
        if (!_scanDepth(text, maxDepth)) return fail("READ_TOO_DEEP", "nesting too deep");
        let value;
        try { value = JSON.parse(text); } catch { return fail("READ_PARSE", "invalid JSON"); }
        const bad = inspectValue(value, maxDepth);
        if (bad) return fail("READ_" + bad, "value rejected");
        const sha256 = crypto.createHash("sha256").update(buf.subarray(0, off)).digest("hex");
        return { ok: true, value, bytes: off, sha256 };
    } catch {
        return fail("READ_FAILED", "read failed");
    } finally {
        if (fh) { try { await fh.close(); } catch { /* ignore */ } }
    }
}

/**
 * Atomic private write: temp file (wx, 0600) in the destination directory,
 * fsync, rename. Directories 0700. Never rejects. The destination is
 * untouched on any failure.
 */
async function writeAtomicPrivate(file, content) {
    if (typeof file !== "string" || file.length === 0 || file.includes("\0") || typeof content !== "string") {
        return { ok: false, error: "WRITE_ARGS_INVALID" };
    }
    const dir = path.dirname(file);
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
    let fh = null;
    let created = false;
    try {
        await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
        fh = await fs.promises.open(tmp, "wx", 0o600);
        created = true;
        await fh.writeFile(content, "utf8");
        await fh.sync();
        await fh.close();
        fh = null;
        await fs.promises.rename(tmp, file);
        return { ok: true };
    } catch (e) {
        if (fh) { try { await fh.close(); } catch { /* ignore */ } }
        if (created) { try { await fs.promises.unlink(tmp); } catch { /* ignore */ } }
        return { ok: false, error: "WRITE_FAILED:" + String((e && e.code) || "UNKNOWN").slice(0, 30) };
    }
}

module.exports = { resolveUnder, readBoundedJson, writeAtomicPrivate, inspectValue, SafeFsError, FORBIDDEN_KEYS };
