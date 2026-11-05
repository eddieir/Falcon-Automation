"use strict";

/**
 * LocalSource.js — WP-77S bounded, hermetic readers for the two backend
 * evidence sources an approved contract may cite: an `http-json` endpoint
 * reachable from this process, or a `file-json` document on local disk.
 *
 * Both readers are read-only, make no DNS lookups, follow no redirects, and
 * cap the response body at 64 KiB. Neither reader ever throws; every outcome
 * is reported as a fixed code in `OUTCOME`, never as request/file content,
 * a URL, a path, a pointer, or an underlying error message.
 *
 * http-json safety:
 *   - GET only, over plain `http:`, via `node:http` directly (never `fetch`
 *     or a library that honours `HTTP_PROXY`/`NODE_USE_ENV_PROXY`).
 *   - The host must already be a literal IP address, or the literal name
 *     `localhost` (mapped to `127.0.0.1`); no hostname is ever resolved via
 *     DNS. The connected socket's `remoteAddress` is re-checked as loopback
 *     once connected, as defence in depth against a misconfigured target.
 *   - A fresh socket per call (`agent: false`); only `Accept` is sent, and
 *     the `Host` header is set explicitly from the original URL.
 *   - A 3xx response is never followed; only a bare 200 is accepted.
 *   - A `content-encoding` response header is refused unread (this reader
 *     never decompresses).
 *   - The per-call timeout is `min(2000ms, caller budget)`.
 *
 * file-json safety:
 *   - Opened `O_RDONLY | O_NONBLOCK | O_NOFOLLOW` (O_NOFOLLOW is absent on
 *     Windows, where the lstat/inode cross-check below is the only guard); a symlink target is
 *     refused by this open call failing with `ELOOP`.
 *   - `fstat`/`lstat` are cross-checked (dev/ino) against a TOCTOU swap.
 *   - The resolved real path must sit under the real path of the supplied
 *     `baseDir`; anything outside it is refused.
 */

const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const MAX_BODY_BYTES = 64 * 1024;
const MAX_HTTP_TIMEOUT_MS = 2000;

const OUTCOME = Object.freeze({
    SOURCE_UNREACHABLE: "source_unreachable",
    REDIRECT_REFUSED: "redirect_refused",
    HTTP_STATUS: "http_status",
    BODY_TOO_LARGE: "body_too_large",
    INVALID_JSON: "invalid_json",
    SOURCE_UNSAFE: "source_unsafe",
    READ_FAILED: "read_failed",
});

function fail(outcome) {
    return { ok: false, outcome };
}

function isLoopbackAddress(addr) {
    if (typeof addr !== "string" || addr.length === 0) return false;
    if (addr === "::1" || addr === "::ffff:127.0.0.1") return true;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

// Literal IP (v4/v6) only, or the literal name `localhost`; never a DNS name.
function resolveLiteralHost(hostname) {
    if (hostname === "localhost") return "127.0.0.1";
    // WHATWG URL reports IPv6 hosts in brackets.
    const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
    return net.isIP(bare) ? bare : null;
}

function parseJsonBody(buf) {
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
        return fail(OUTCOME.INVALID_JSON);
    }
    try {
        return { ok: true, body: JSON.parse(text) };
    } catch {
        return fail(OUTCOME.INVALID_JSON);
    }
}

/**
 * @param {string} urlString - an `http:` URL with a literal-IP (or
 *   `localhost`) host.
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{ok: true, body: any} | {ok: false, outcome: string}>}
 */
function readHttpJson(urlString, options = {}) {
    return new Promise((resolve) => {
        let settled = false;
        let wallTimer = null;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            if (wallTimer) clearTimeout(wallTimer);
            resolve(value);
        };

        let u;
        try {
            u = new URL(urlString);
        } catch {
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
            return;
        }
        if (u.protocol !== "http:") {
            finish(fail(OUTCOME.SOURCE_UNSAFE));
            return;
        }
        const ip = resolveLiteralHost(u.hostname);
        // Refuse before any socket is opened: only loopback literals are ever contacted.
        if (!ip || !isLoopbackAddress(ip)) {
            finish(fail(OUTCOME.SOURCE_UNSAFE));
            return;
        }

        const budget = Number(options && options.timeoutMs);
        const timeoutMs = Math.max(1, Math.min(MAX_HTTP_TIMEOUT_MS, Number.isFinite(budget) ? budget : MAX_HTTP_TIMEOUT_MS));

        let req;
        try {
            req = http.request({
                method: "GET",
                host: ip,
                port: u.port ? Number(u.port) : 80,
                path: u.pathname,
                headers: { Host: u.host, Accept: "application/json" },
                agent: false,
                timeout: timeoutMs,
            });
        } catch {
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
            return;
        }

        // `timeout` above is only a socket idle timeout; a trickling response
        // would keep it alive, so also enforce a wall-clock deadline.
        wallTimer = setTimeout(() => {
            req.destroy();
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
        }, timeoutMs);

        req.on("socket", (socket) => {
            socket.once("connect", () => {
                if (!isLoopbackAddress(socket.remoteAddress)) {
                    finish(fail(OUTCOME.SOURCE_UNSAFE));
                    req.destroy();
                }
            });
        });

        req.on("timeout", () => {
            req.destroy();
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
        });

        req.on("error", () => {
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
        });

        req.on("response", (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400) {
                res.resume();
                req.destroy();
                finish(fail(OUTCOME.REDIRECT_REFUSED));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                req.destroy();
                finish(fail(OUTCOME.HTTP_STATUS));
                return;
            }
            if (res.headers["content-encoding"]) {
                res.resume();
                req.destroy();
                finish(fail(OUTCOME.SOURCE_UNSAFE));
                return;
            }

            const chunks = [];
            let total = 0;
            let overflowed = false;
            res.on("data", (chunk) => {
                if (overflowed) return;
                total += chunk.length;
                if (total > MAX_BODY_BYTES) {
                    overflowed = true;
                    res.destroy();
                    req.destroy();
                    finish(fail(OUTCOME.BODY_TOO_LARGE));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => {
                if (overflowed) return;
                finish(parseJsonBody(Buffer.concat(chunks)));
            });
            res.on("error", () => {
                if (overflowed) return;
                finish(fail(OUTCOME.READ_FAILED));
            });
        });

        req.end();
    });
}

const MAX_AUTH_HEADER_LEN = 600;
const ALLOWED_PROBE_HEADERS = new Set(["Authorization"]);

function headersUsable(headers) {
    if (headers === undefined || headers === null) return true;
    if (typeof headers !== "object") return false;
    for (const key of Object.keys(headers)) {
        if (!ALLOWED_PROBE_HEADERS.has(key)) return false;
        const value = headers[key];
        if (typeof value !== "string" || value.length === 0 || value.length > MAX_AUTH_HEADER_LEN) return false;
        if (/[\r\n]/.test(value)) return false;
    }
    return true;
}

/**
 * Probes an `http:` endpoint for its status only, never its body. Shares the
 * loopback-literal-only, no-DNS, no-proxy, fresh-socket safety of
 * `readHttpJson`, but:
 *   - never follows a redirect (a 3xx is reported as `ok: true` with that
 *     status, exactly like any other status);
 *   - never reads the response body (`res.resume()` then `res.destroy()`);
 *   - sends only `Accept` plus the caller-supplied `headers`, which may
 *     contain only an `Authorization` string header (max 600 chars, no CR/LF)
 *     — anything else fails `source_unsafe` before a socket is opened.
 *
 * @param {string} urlString - an `http:` URL with a literal-IP (or
 *   `localhost`) host.
 * @param {{timeoutMs?: number, headers?: {Authorization?: string}}} [options]
 * @returns {Promise<{ok: true, status: number} | {ok: false, outcome: string}>}
 */
function probeHttpStatus(urlString, options = {}) {
    return new Promise((resolve) => {
        let settled = false;
        let wallTimer = null;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            if (wallTimer) clearTimeout(wallTimer);
            resolve(value);
        };

        let u;
        try {
            u = new URL(urlString);
        } catch {
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
            return;
        }
        if (u.protocol !== "http:") {
            finish(fail(OUTCOME.SOURCE_UNSAFE));
            return;
        }
        const ip = resolveLiteralHost(u.hostname);
        if (!ip || !isLoopbackAddress(ip)) {
            finish(fail(OUTCOME.SOURCE_UNSAFE));
            return;
        }

        const suppliedHeaders = options && options.headers;
        if (!headersUsable(suppliedHeaders)) {
            finish(fail(OUTCOME.SOURCE_UNSAFE));
            return;
        }

        const budget = Number(options && options.timeoutMs);
        const timeoutMs = Math.max(1, Math.min(MAX_HTTP_TIMEOUT_MS, Number.isFinite(budget) ? budget : MAX_HTTP_TIMEOUT_MS));

        const headers = Object.assign({ Host: u.host, Accept: "application/json" }, suppliedHeaders || {});

        let req;
        try {
            req = http.request({
                method: "GET",
                host: ip,
                port: u.port ? Number(u.port) : 80,
                path: u.pathname,
                headers,
                agent: false,
                timeout: timeoutMs,
            });
        } catch {
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
            return;
        }

        wallTimer = setTimeout(() => {
            req.destroy();
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
        }, timeoutMs);

        req.on("socket", (socket) => {
            socket.once("connect", () => {
                if (!isLoopbackAddress(socket.remoteAddress)) {
                    finish(fail(OUTCOME.SOURCE_UNSAFE));
                    req.destroy();
                }
            });
        });

        req.on("timeout", () => {
            req.destroy();
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
        });

        req.on("error", () => {
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
        });

        req.on("response", (res) => {
            const status = res.statusCode;
            res.resume();
            req.destroy();
            finish({ ok: true, status });
        });

        req.end();
    });
}

/**
 * @param {string} filePath - path to the JSON document.
 * @param {string} baseDir - directory the document must resolve under.
 * @returns {Promise<{ok: true, body: any} | {ok: false, outcome: string}>}
 */
async function readFileJson(filePath, baseDir) {
    if (typeof filePath !== "string" || filePath.length === 0) return fail(OUTCOME.READ_FAILED);
    if (typeof baseDir !== "string" || baseDir.length === 0) return fail(OUTCOME.SOURCE_UNSAFE);

    let realBase;
    try {
        realBase = await fs.promises.realpath(baseDir);
    } catch {
        return fail(OUTCOME.SOURCE_UNSAFE);
    }

    // Resolve against the base directory, never the process working directory.
    const absPath = path.resolve(realBase, filePath);

    let fh = null;
    try {
        try {
            fh = await fs.promises.open(
                absPath,
                fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0)
            );
        } catch (e) {
            if (e && e.code === "ELOOP") return fail(OUTCOME.SOURCE_UNSAFE);
            return fail(OUTCOME.READ_FAILED);
        }

        const st = await fh.stat();
        if (!st.isFile()) return fail(OUTCOME.SOURCE_UNSAFE);

        let lst;
        try {
            lst = await fs.promises.lstat(absPath);
        } catch {
            return fail(OUTCOME.READ_FAILED);
        }
        if (lst.isSymbolicLink() || lst.dev !== st.dev || lst.ino !== st.ino) {
            return fail(OUTCOME.SOURCE_UNSAFE);
        }

        let realFile;
        try {
            realFile = await fs.promises.realpath(absPath);
        } catch {
            return fail(OUTCOME.READ_FAILED);
        }
        const rel = path.relative(realBase, realFile);
        if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
            return fail(OUTCOME.SOURCE_UNSAFE);
        }

        if (st.size > MAX_BODY_BYTES) return fail(OUTCOME.BODY_TOO_LARGE);

        const buf = Buffer.alloc(MAX_BODY_BYTES + 1);
        let off = 0;
        for (;;) {
            const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
            if (bytesRead === 0) break;
            off += bytesRead;
            if (off > MAX_BODY_BYTES) return fail(OUTCOME.BODY_TOO_LARGE);
            if (off >= buf.length) break;
        }
        return parseJsonBody(buf.subarray(0, off));
    } catch {
        return fail(OUTCOME.READ_FAILED);
    } finally {
        if (fh) {
            try {
                await fh.close();
            } catch {
                /* ignore */
            }
        }
    }
}

module.exports = { readHttpJson, readFileJson, probeHttpStatus, OUTCOME, MAX_BODY_BYTES };
