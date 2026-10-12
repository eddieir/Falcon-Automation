/**
 * src/core/llm/transport/EndpointPolicy.js — Phase 17 custom-endpoint SSRF
 * policy (ADR-0017 section 8, Sec-00 S-01/S-02).
 *
 * PURE classification only. No network I/O, no DNS, no sockets. Parses and
 * classifies a configured `FALCON_LLM_ENDPOINT` URL shape (validateEndpointUrl)
 * and classifies individual IP addresses (classifyAddress / assertAllResolvedAllowed)
 * so the real transport (guardedFetch, implemented separately) can pin the
 * resolved address it actually connects to and reject anything this module
 * would reject. This module never throws; every path returns a closed error
 * code from LlmProvider.ERROR_CODES.
 */

"use strict";

const net = require("node:net");
const { ERROR_CODES } = require("../LlmProvider");

const KNOWN_ERROR_CODES = new Set(ERROR_CODES);

function errorResult(errorCode) {
    if (!KNOWN_ERROR_CODES.has(errorCode)) {
        // Defensive: never leak an unlisted code even on a coding mistake.
        return { ok: false, errorCode: "CONFIG_INVALID" };
    }
    return { ok: false, errorCode };
}

const DEFAULT_ALLOWED_PORTS = Object.freeze([80, 443, 8000, 8080, 11434]);

// --- IPv4 helpers --------------------------------------------------------

function ipv4ToInt(ip) {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const v = Number(part);
        if (v > 255) return null;
        n = (n << 8) | v;
    }
    return n >>> 0;
}

function v4InRange(ipInt, baseStr, bits) {
    const base = ipv4ToInt(baseStr);
    if (base === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipInt & mask) >>> 0 === (base & mask) >>> 0;
}

// Always-deny IPv4 ranges — never overridden by any opt-in (Sec-00 S-01).
const V4_ALWAYS_DENY = Object.freeze([
    { base: "0.0.0.0", bits: 8 },
    { base: "100.100.100.200", bits: 32 }, // Alibaba metadata
    { base: "168.63.129.16", bits: 32 }, // Azure host
    { base: "169.254.0.0", bits: 16 }, // link-local / cloud metadata
    { base: "198.18.0.0", bits: 15 }, // benchmarking
    { base: "192.0.0.0", bits: 24 }, // IETF protocol assignments
    { base: "224.0.0.0", bits: 4 }, // multicast
    { base: "240.0.0.0", bits: 4 }, // reserved
    { base: "255.255.255.255", bits: 32 }, // broadcast
]);

const V4_PRIVATE = Object.freeze([
    { base: "10.0.0.0", bits: 8 },
    { base: "172.16.0.0", bits: 12 },
    { base: "192.168.0.0", bits: 16 },
    { base: "100.64.0.0", bits: 10 },
]);

function classifyV4(ipInt, opts) {
    for (const range of V4_ALWAYS_DENY) {
        if (v4InRange(ipInt, range.base, range.bits)) {
            return { allowed: false, endpointClass: null, reason: "always_deny" };
        }
    }
    if (v4InRange(ipInt, "127.0.0.0", 8)) {
        if (opts.allowLoopback) {
            return { allowed: true, endpointClass: "custom_loopback", reason: "loopback" };
        }
        return { allowed: false, endpointClass: null, reason: "loopback_opt_in_required" };
    }
    for (const range of V4_PRIVATE) {
        if (v4InRange(ipInt, range.base, range.bits)) {
            if (opts.allowPrivate) {
                return { allowed: true, endpointClass: "custom_private", reason: "private" };
            }
            return { allowed: false, endpointClass: null, reason: "private_opt_in_required" };
        }
    }
    return { allowed: true, endpointClass: "custom_public", reason: "public" };
}

// --- IPv6 helpers --------------------------------------------------------

/** @returns {number[]|null} 8 uint16 hextets, or null if `ip` is not valid IPv6 text. */
function parseV6Hextets(ip) {
    if (ip.indexOf("%") !== -1) return null; // zone ids rejected upstream already
    const doubleColonCount = (ip.match(/::/g) || []).length;
    if (doubleColonCount > 1) return null;
    const halves = ip.split("::");
    const parseGroup = (str) => (str === "" ? [] : str.split(":"));
    let head;
    let tail;
    if (halves.length === 2) {
        head = parseGroup(halves[0]);
        tail = parseGroup(halves[1]);
    } else {
        head = parseGroup(halves[0]);
        tail = [];
    }
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 && missing !== 0) return null;
    if (halves.length === 2 && missing < 0) return null;
    const hex = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
    if (hex.length !== 8) return null;
    const hextets = [];
    for (const h of hex) {
        if (!/^[0-9a-f]{1,4}$/i.test(h)) return null;
        hextets.push(parseInt(h, 16));
    }
    return hextets;
}

function hextetsToBigInt(hextets) {
    let n = 0n;
    for (const h of hextets) n = (n << 16n) | BigInt(h);
    return n;
}

function v6RangeBigInt(prefixStr, bits) {
    const hextets = parseV6Hextets(prefixStr);
    const base = hextetsToBigInt(hextets);
    const mask = bits === 0 ? 0n : (((1n << 128n) - 1n) << BigInt(128 - bits)) & ((1n << 128n) - 1n);
    return { base: base & mask, mask };
}

function v6InRange(ipBig, prefixStr, bits) {
    const { base, mask } = v6RangeBigInt(prefixStr, bits);
    return (ipBig & mask) === base;
}

const V6_ALWAYS_DENY = Object.freeze([
    { base: "fe80::", bits: 10 }, // link-local
    { base: "fec0::", bits: 10 }, // deprecated site-local
    { base: "ff00::", bits: 8 }, // multicast
    { base: "fd00:ec2::254", bits: 128 }, // AWS IMDS (IPv6)
    { base: "64:ff9b::", bits: 96 }, // NAT64
    { base: "2002::", bits: 16 }, // 6to4
    { base: "2001::", bits: 32 }, // Teredo
]);

function classifyV6(hextets, opts) {
    const ipBig = hextetsToBigInt(hextets);

    if (ipBig === 0n) {
        return { allowed: false, endpointClass: null, reason: "always_deny" }; // "::"
    }
    if (ipBig === 1n) {
        if (opts.allowLoopback) {
            return { allowed: true, endpointClass: "custom_loopback", reason: "loopback" };
        }
        return { allowed: false, endpointClass: null, reason: "loopback_opt_in_required" }; // "::1"
    }

    // IPv4-mapped (::ffff:a.b.c.d) or deprecated IPv4-compatible (::a.b.c.d):
    // decode the embedded v4 and classify by the v4 rules (always-deny wins).
    const isMapped = hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0xffff;
    const isCompat = hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0;
    if (isMapped || isCompat) {
        const v4Int = ((hextets[6] << 16) | hextets[7]) >>> 0;
        return classifyV4(v4Int, opts);
    }

    for (const range of V6_ALWAYS_DENY) {
        if (v6InRange(ipBig, range.base, range.bits)) {
            return { allowed: false, endpointClass: null, reason: "always_deny" };
        }
    }
    if (v6InRange(ipBig, "fc00::", 7)) {
        if (opts.allowPrivate) {
            return { allowed: true, endpointClass: "custom_private", reason: "private" };
        }
        return { allowed: false, endpointClass: null, reason: "private_opt_in_required" };
    }
    return { allowed: true, endpointClass: "custom_public", reason: "public" };
}

/**
 * Classify a single already-resolved IP address string. Pure; no I/O.
 * @param {string} ip - unbracketed IPv4 or IPv6 literal.
 * @param {{allowLoopback?:boolean, allowPrivate?:boolean}} [opts]
 * @returns {{allowed:boolean, endpointClass:(string|null), reason:string}}
 */
function classifyAddress(ip, opts = {}) {
    if (typeof ip !== "string" || ip === "") {
        return { allowed: false, endpointClass: null, reason: "invalid_address" };
    }
    const version = net.isIP(ip);
    if (version === 4) {
        const ipInt = ipv4ToInt(ip);
        if (ipInt === null) return { allowed: false, endpointClass: null, reason: "invalid_address" };
        return classifyV4(ipInt, opts);
    }
    if (version === 6) {
        const hextets = parseV6Hextets(ip);
        if (!hextets) return { allowed: false, endpointClass: null, reason: "invalid_address" };
        return classifyV6(hextets, opts);
    }
    return { allowed: false, endpointClass: null, reason: "invalid_address" };
}

/**
 * S-02: every address a DNS lookup resolved to must independently pass the
 * same policy — if ANY resolved address is denied, the whole lookup is
 * rejected (prevents picking the "nice" address while another resolves to
 * a metadata/private target).
 * @param {string[]} addresses
 * @param {{allowLoopback?:boolean, allowPrivate?:boolean}} [opts]
 * @returns {{ok:true, endpointClass:string}|{ok:false, errorCode:string}}
 */
function assertAllResolvedAllowed(addresses, opts = {}) {
    if (!Array.isArray(addresses) || addresses.length === 0) {
        return errorResult("ENDPOINT_POLICY_REJECTED");
    }
    let endpointClass = null;
    for (const addr of addresses) {
        const result = classifyAddress(addr, opts);
        if (!result.allowed) {
            return errorResult("ENDPOINT_POLICY_REJECTED");
        }
        if (endpointClass === null) endpointClass = result.endpointClass;
    }
    return { ok: true, endpointClass };
}

// --- URL shape validation --------------------------------------------------

function stripBrackets(hostname) {
    if (hostname.length >= 2 && hostname[0] === "[" && hostname[hostname.length - 1] === "]") {
        return hostname.slice(1, -1);
    }
    return hostname;
}

function isAllowedPort(port, extraAllowedPorts) {
    const allowed = new Set(DEFAULT_ALLOWED_PORTS);
    if (Array.isArray(extraAllowedPorts)) {
        for (const p of extraAllowedPorts) allowed.add(p);
    }
    return allowed.has(port);
}

function hasDotSegmentEscape(pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return true; // malformed percent-encoding — treat as an escape attempt
    }
    if (/%2e%2e/i.test(pathname)) return true;
    const segments = decoded.split("/");
    return segments.includes("..") || segments.includes(".");
}

/**
 * Validate the *shape* of a configured endpoint URL and, for literal IP /
 * well-known-loopback hosts, the SSRF policy immediately (since no DNS
 * lookup is needed to know the address). Plain DNS hostnames are accepted
 * at the shape level with `hostKind: 'dns'` — their address classification
 * is deferred to `assertAllResolvedAllowed` at actual-lookup time (OD-5).
 *
 * Never throws. No network I/O.
 *
 * @param {string} urlString
 * @param {{allowHttpLoopback?:boolean, allowLoopback?:boolean, allowPrivate?:boolean, extraAllowedPorts?:number[]}} [opts]
 * @returns {{ok:true, url:{protocol:string,hostname:string,port:string,pathname:string}, hostKind:('dns'|'ip')}|{ok:false, errorCode:string}}
 */
function validateEndpointUrl(urlString, opts = {}) {
    let parsed;
    try {
        parsed = new URL(String(urlString));
    } catch {
        return errorResult("CONFIG_INVALID");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return errorResult("CONFIG_INVALID");
    }
    if (parsed.username !== "" || parsed.password !== "") {
        return errorResult("CONFIG_INVALID");
    }
    if (parsed.search !== "") {
        return errorResult("CONFIG_INVALID");
    }
    if (parsed.hash !== "") {
        return errorResult("CONFIG_INVALID");
    }
    if (parsed.hostname === "") {
        return errorResult("CONFIG_INVALID");
    }
    if (hasDotSegmentEscape(parsed.pathname)) {
        return errorResult("CONFIG_INVALID");
    }
    if (!/\/v1\/?$/.test(parsed.pathname)) {
        return errorResult("CONFIG_INVALID");
    }

    const defaultPort = parsed.protocol === "https:" ? 443 : 80;
    const port = parsed.port === "" ? defaultPort : Number(parsed.port);
    if (!Number.isInteger(port) || !isAllowedPort(port, opts.extraAllowedPorts)) {
        return errorResult("CONFIG_INVALID");
    }

    const rawHostname = parsed.hostname;
    const unbracketed = stripBrackets(rawHostname);
    const ipVersion = net.isIP(unbracketed);
    const isIpLiteral = ipVersion !== 0;
    const isLocalhostLiteral = unbracketed === "localhost" || unbracketed === "localhost.";

    const shape = {
        protocol: parsed.protocol,
        hostname: rawHostname,
        port: String(port),
        pathname: parsed.pathname,
    };

    if (!isIpLiteral && !isLocalhostLiteral) {
        // Plain DNS hostname: shape-valid. http is not a supported shape for
        // a DNS hostname (only literal loopback IPs may use http) — only
        // https defers to resolution time.
        if (parsed.protocol === "http:") {
            return errorResult("CONFIG_INVALID");
        }
        return { ok: true, url: shape, hostKind: "dns" };
    }

    // Literal IP (or well-known loopback name): classify immediately.
    const literalIp = isLocalhostLiteral ? "127.0.0.1" : unbracketed;
    const classification = classifyAddress(literalIp, {
        allowLoopback: parsed.protocol === "http:" ? Boolean(opts.allowHttpLoopback) : Boolean(opts.allowLoopback),
        allowPrivate: Boolean(opts.allowPrivate),
    });

    if (parsed.protocol === "http:") {
        if (classification.reason === "loopback" || classification.reason === "loopback_opt_in_required") {
            if (opts.allowHttpLoopback) {
                return { ok: true, url: shape, hostKind: "ip" };
            }
            return errorResult("CONFIG_ENDPOINT_OPT_IN_REQUIRED");
        }
        return errorResult("ENDPOINT_POLICY_REJECTED");
    }

    // https:
    if (!classification.allowed) {
        if (classification.reason === "loopback_opt_in_required" || classification.reason === "private_opt_in_required") {
            return errorResult("CONFIG_ENDPOINT_OPT_IN_REQUIRED");
        }
        return errorResult("ENDPOINT_POLICY_REJECTED");
    }
    return { ok: true, url: shape, hostKind: "ip" };
}

module.exports = {
    validateEndpointUrl,
    classifyAddress,
    assertAllResolvedAllowed,
};
