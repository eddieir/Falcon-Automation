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
 *   - Opened `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`; a symlink target is
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
    return net.isIP(hostname) ? hostname : null;
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
        const finish = (value) => {
            if (settled) return;
            settled = true;
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
        if (!ip) {
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
                path: `${u.pathname}${u.search || ""}`,
                headers: { Host: u.host, Accept: "application/json" },
                agent: false,
                timeout: timeoutMs,
            });
        } catch {
            finish(fail(OUTCOME.SOURCE_UNREACHABLE));
            return;
        }

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

    let fh = null;
    try {
        try {
            fh = await fs.promises.open(
                filePath,
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
            lst = await fs.promises.lstat(filePath);
        } catch {
            return fail(OUTCOME.READ_FAILED);
        }
        if (lst.isSymbolicLink() || lst.dev !== st.dev || lst.ino !== st.ino) {
            return fail(OUTCOME.SOURCE_UNSAFE);
        }

        let realFile;
        try {
            realFile = await fs.promises.realpath(filePath);
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

module.exports = { readHttpJson, readFileJson, OUTCOME, MAX_BODY_BYTES };
