/**
 * src/core/llm/transport/guardedFetch.js — Phase 17 hardened HTTP(S) transport
 * for pluggable LLM providers (ADR-0017 section 8, Sec-00 S-02/S-03/S-04/S-06/
 * S-07/S-13).
 *
 * This is the ONLY place that performs real network I/O for an LLM request.
 * `createGuardedFetch` takes the provider's single configured *base* endpoint
 * URL and validates it ONCE, at creation time, via
 * EndpointPolicy.validateEndpointUrl — before any request is ever made. A
 * bad base configuration makes every subsequent call fail immediately with
 * that same error code and zero I/O (fail closed).
 *
 * Every call's request URL is then checked, with no new network/DNS work,
 * against a single fixed shape: it must be exactly
 * `<base-without-trailing-slash>/chat/completions`, same origin, no query,
 * fragment, or userinfo. Anything else is ENDPOINT_POLICY_REJECTED with zero
 * connections attempted — this is what keeps the OpenAI-SDK-shaped request
 * URL (base + "/chat/completions") compatible with the policy's "/v1" base
 * shape without re-validating (and potentially re-classifying) an
 * attacker-influenced request URL per call.
 *
 * This module never trusts EndpointPolicy's shape-level classification
 * alone for the base host: it re-resolves the configured hostname itself,
 * re-validates EVERY resolved address, and pins the single validated
 * address the socket actually connects to (DNS-rebinding defence) — so a
 * second, later resolution of the same hostname can never be used to reach
 * a different (denied) address.
 *
 * Error reporting is deliberately opaque: every rejection is an Error whose
 * `.message` is a fixed, code-only string and whose `.llmCode` is a member
 * of LlmProvider.ERROR_CODES. Nothing request/response-shaped (URLs,
 * headers, redirect targets, upstream error text) is ever placed on the
 * error or logged (S-17).
 */

"use strict";

const dns = require("node:dns");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const Logger = require("../../../../utils/Logger");
const { validateEndpointUrl, assertAllResolvedAllowed } = require("./EndpointPolicy");
const { ERROR_CODES } = require("../LlmProvider");

const KNOWN_ERROR_CODES = new Set(ERROR_CODES);
const MAX_REDIRECT_BODY_BYTES = 1024;
const ALLOWED_RESPONSE_HEADERS = Object.freeze(["content-type", "retry-after"]);
const CHAT_COMPLETIONS_SUFFIX = "/chat/completions";
// Hop-by-hop headers that must never be forwarded verbatim: `content-length`
// is always recomputed from the actual outgoing body by Node's http(s)
// client, and `connection`/`transfer-encoding`/`keep-alive`/`proxy-*` are
// connection-management headers that only make sense for the hop the caller
// thinks it is making, not the pinned, non-proxied hop this module performs.
const HOP_BY_HOP_HEADERS = new Set(["connection", "transfer-encoding", "content-length", "keep-alive"]);

/**
 * Normalizes `init.headers` from any shape a caller (including the openai
 * SDK, which passes a WHATWG `Headers` instance) may supply into a plain,
 * lowercase-keyed object suitable for Node's http(s) request options.
 *
 * The global `Headers` constructor already accepts a `Headers` instance, a
 * plain object/record, or an iterable of `[name, value]` pairs, so routing
 * every shape through it is both the simplest and the most faithful way to
 * merge duplicate/differently-cased header names the way the fetch spec
 * does. Hop-by-hop headers are stripped afterwards; header values are never
 * logged (S-17).
 */
function normalizeHeaders(initHeaders) {
    const merged = new Headers(initHeaders || {});
    const out = {};
    for (const [name, value] of merged.entries()) {
        const key = name.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(key) || key.startsWith("proxy-")) continue;
        out[key] = value;
    }
    return out;
}

function transportError(code) {
    const safeCode = KNOWN_ERROR_CODES.has(code) ? code : "NETWORK_ERROR";
    Logger.error(`guardedFetch transport rejection: ${safeCode}`);
    const err = new Error(safeCode);
    err.llmCode = safeCode;
    return err;
}

function stripBrackets(hostname) {
    if (hostname.length >= 2 && hostname[0] === "[" && hostname[hostname.length - 1] === "]") {
        return hostname.slice(1, -1);
    }
    return hostname;
}

function effectivePort(parsedUrl) {
    if (parsedUrl.port !== "") return Number(parsedUrl.port);
    return parsedUrl.protocol === "https:" ? 443 : 80;
}

function filterResponseHeaders(rawHeaders) {
    const out = {};
    for (const name of ALLOWED_RESPONSE_HEADERS) {
        const value = rawHeaders[name];
        if (typeof value === "string") out[name] = value;
    }
    return out;
}

/**
 * @param {{baseUrl:string, policyOpts?:object, timeoutMs:number, maxResponseBytes:number, deps?:{lookup:Function, httpRequest:Function, httpsRequest:Function}}} config
 * @returns {(url:string, init:{method:string, headers?:object, body?:(string|Buffer)}) => Promise<Response>}
 */
function createGuardedFetch(config = {}) {
    const policyOpts = config.policyOpts || {};
    const timeoutMs = config.timeoutMs;
    const maxResponseBytes = config.maxResponseBytes;
    const deps = config.deps || {};
    const lookupFn = deps.lookup || dns.lookup;
    const httpRequestFn = deps.httpRequest || http.request;
    const httpsRequestFn = deps.httpsRequest || https.request;

    // Validated exactly once, at creation time, before any request is ever
    // made. A bad base configuration is a permanent failure for every call.
    const baseShape =
        typeof config.baseUrl === "string" && config.baseUrl !== ""
            ? validateEndpointUrl(config.baseUrl, policyOpts)
            : { ok: false, errorCode: "CONFIG_INVALID" };
    const expectedPath = baseShape.ok ? `${baseShape.url.pathname.replace(/\/$/, "")}${CHAT_COMPLETIONS_SUFFIX}` : null;

    return function guardedFetch(url, init = {}) {
        return new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;
            let activeRequest = null;

            function finish(fn, value) {
                if (settled) return;
                settled = true;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                fn(value);
            }

            function failWith(code) {
                finish(reject, transportError(code));
            }

            if (!baseShape.ok) {
                failWith(baseShape.errorCode);
                return;
            }
            if (!init || init.method !== "POST") {
                failWith("CONFIG_INVALID");
                return;
            }

            let parsedReq;
            try {
                parsedReq = new URL(String(url));
            } catch {
                failWith("ENDPOINT_POLICY_REJECTED");
                return;
            }

            const sameOrigin =
                parsedReq.protocol === baseShape.url.protocol &&
                parsedReq.hostname.toLowerCase() === baseShape.url.hostname.toLowerCase() &&
                effectivePort(parsedReq) === Number(baseShape.url.port);
            const matchesShape =
                sameOrigin &&
                parsedReq.pathname === expectedPath &&
                parsedReq.search === "" &&
                parsedReq.hash === "" &&
                parsedReq.username === "" &&
                parsedReq.password === "";
            if (!matchesShape) {
                failWith("ENDPOINT_POLICY_REJECTED");
                return;
            }

            timer = setTimeout(() => {
                if (activeRequest) {
                    try {
                        activeRequest.destroy();
                    } catch {
                        // best-effort; the request is being abandoned anyway.
                    }
                }
                failWith("TIMEOUT");
            }, timeoutMs);

            const isHttps = baseShape.url.protocol === "https:";
            const rawHostname = baseShape.url.hostname;
            const unbracketed = stripBrackets(rawHostname);
            const port = Number(baseShape.url.port);

            function proceedWithAddress(pinnedAddress) {
                if (settled) return;

                const pinnedLookup = (_hostname, _options, callback) => {
                    // Pinned: never performs a second resolution. The address
                    // used here is exactly the one already policy-checked.
                    // Node >= 20 may ask for { all: true } and then requires an array.
                    const family = net.isIP(pinnedAddress) || undefined;
                    if (_options && _options.all) callback(null, [{ address: pinnedAddress, family }]);
                    else callback(null, pinnedAddress, family);
                };

                const headers = normalizeHeaders(init.headers);
                headers["accept-encoding"] = "identity";
                headers.host = port === (isHttps ? 443 : 80) ? rawHostname : `${rawHostname}:${port}`;

                const requestOptions = {
                    method: "POST",
                    hostname: unbracketed,
                    port,
                    path: expectedPath,
                    headers,
                    lookup: pinnedLookup,
                    agent: isHttps
                        ? new https.Agent({ keepAlive: false, proxy: undefined })
                        : new http.Agent({ keepAlive: false, proxy: undefined }),
                };

                if (isHttps) {
                    requestOptions.rejectUnauthorized = true;
                    if (baseShape.hostKind !== "ip") requestOptions.servername = rawHostname;
                }

                const requestFn = isHttps ? httpsRequestFn : httpRequestFn;
                let req;
                try {
                    req = requestFn(requestOptions, (res) => onResponse(res));
                } catch {
                    failWith("NETWORK_ERROR");
                    return;
                }
                activeRequest = req;

                req.on("error", () => {
                    failWith("NETWORK_ERROR");
                });

                try {
                    if (init.body !== undefined && init.body !== null) {
                        req.write(init.body);
                    }
                    req.end();
                } catch {
                    failWith("NETWORK_ERROR");
                }
            }

            function onResponse(res) {
                if (settled) {
                    res.destroy();
                    return;
                }

                const statusCode = res.statusCode;

                if (statusCode >= 300 && statusCode < 400) {
                    let consumed = 0;
                    res.on("data", (chunk) => {
                        consumed += chunk.length;
                        if (consumed > MAX_REDIRECT_BODY_BYTES) {
                            res.destroy();
                        }
                    });
                    res.on("error", () => {});
                    res.on("end", () => failWith("REDIRECT_REJECTED"));
                    res.on("close", () => failWith("REDIRECT_REJECTED"));
                    return;
                }

                const contentEncoding = res.headers["content-encoding"];
                if (contentEncoding !== undefined && String(contentEncoding).toLowerCase() !== "identity") {
                    res.destroy();
                    failWith("MALFORMED_RESPONSE");
                    return;
                }

                const declaredLength = res.headers["content-length"];
                if (declaredLength !== undefined) {
                    const declared = Number(declaredLength);
                    if (Number.isFinite(declared) && declared > maxResponseBytes) {
                        res.destroy();
                        failWith("OVERSIZED");
                        return;
                    }
                }

                const chunks = [];
                let total = 0;
                res.on("data", (chunk) => {
                    total += chunk.length;
                    if (total > maxResponseBytes) {
                        res.destroy();
                        failWith("OVERSIZED");
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on("error", () => failWith("NETWORK_ERROR"));
                res.on("end", () => {
                    if (settled) return;
                    const body = Buffer.concat(chunks, total);
                    const headers = filterResponseHeaders(res.headers);
                    let response;
                    try {
                        response = new Response(body, { status: statusCode, headers });
                    } catch {
                        // 204/205/304 with a body, or a status outside 200-599.
                        failWith("MALFORMED_RESPONSE");
                        return;
                    }
                    finish(resolve, response);
                });
            }

            if (baseShape.hostKind === "ip") {
                proceedWithAddress(unbracketed);
                return;
            }

            lookupFn(unbracketed, { all: true, verbatim: true }, (err, addresses) => {
                if (settled) return;
                if (err) {
                    failWith("NETWORK_ERROR");
                    return;
                }
                const list = Array.isArray(addresses) ? addresses : [{ address: addresses }];
                const policyResult = assertAllResolvedAllowed(list.map((a) => a.address), policyOpts);
                if (!policyResult.ok) {
                    failWith(policyResult.errorCode);
                    return;
                }
                proceedWithAddress(list[0].address);
            });
        });
    };
}

module.exports = { createGuardedFetch };
