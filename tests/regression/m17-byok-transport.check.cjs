/**
 * tests/regression/m17-byok-transport.check.cjs — WP1 vocabulary + transport
 * safety primitives for the BYOK invocation-scoped providers maintenance
 * (ADR-0019). Covers AC18, AC28, N03, N06, N08 and coordinator conditions
 * C8 (header-normalize wrap), C9 (fixed-host shape), C10 (key-shaped value
 * detector) per Sec-00/ADR-0019.
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/m17-byok-transport.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");

const { PROVIDER_IDS, ENDPOINT_CLASSES, ERROR_CODES } = require("../../src/core/llm/LlmProvider");
const {
    createGuardedFetch,
    isValidCredentialShape,
    isKeyShapedValue,
} = require("../../src/core/llm/transport/guardedFetch");

const TEST_OPTS = { timeout: 8000 };

// --- Vocabulary (ADR-0019 section 4) ---------------------------------------

test("PROVIDER_IDS includes anthropic and gemini, frozen, no duplicates", () => {
    assert.ok(Object.isFrozen(PROVIDER_IDS));
    assert.ok(PROVIDER_IDS.includes("anthropic"));
    assert.ok(PROVIDER_IDS.includes("gemini"));
    assert.equal(new Set(PROVIDER_IDS).size, PROVIDER_IDS.length);
});

test("ENDPOINT_CLASSES includes anthropic_public and gemini_public, frozen", () => {
    assert.ok(Object.isFrozen(ENDPOINT_CLASSES));
    assert.ok(ENDPOINT_CLASSES.includes("anthropic_public"));
    assert.ok(ENDPOINT_CLASSES.includes("gemini_public"));
});

test("ERROR_CODES includes CONTENT_BLOCKED, frozen, length 20", () => {
    assert.ok(Object.isFrozen(ERROR_CODES));
    assert.ok(ERROR_CODES.includes("CONTENT_BLOCKED"));
    assert.equal(ERROR_CODES.length, 20);
});

// --- Helpers for fixed-host guardedFetch tests (spy transport, no real
// sockets, matching the p17-transport.check.cjs convention for https cases)

function makeSpyRequest(respond) {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => {
        setImmediate(() => respond());
    };
    return req;
}

function okResponder(callback, { statusCode = 200, headers = { "content-type": "application/json" }, body = "{}" } = {}) {
    return () => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        res.headers = headers;
        res.destroy = () => {};
        callback(res);
        setImmediate(() => {
            res.emit("data", Buffer.from(body));
            res.emit("end");
        });
    };
}

function makeFixedHostFetch({ fixedHost, policyOpts, lookup, httpsRequestSpy, timeoutMs = 3000, maxResponseBytes = 4096 }) {
    return createGuardedFetch({
        mode: "fixed-host",
        fixedHost,
        policyOpts: policyOpts || {},
        timeoutMs,
        maxResponseBytes,
        deps: {
            lookup: lookup || ((_h, _o, cb) => cb(null, [{ address: "203.0.113.9", family: 4 }])),
            httpRequest: http.request,
            httpsRequest: httpsRequestSpy,
        },
    });
}

const FIXED_HOST = { host: "api.anthropic.test", pathAllowlist: ["/v1/messages"], port: 443 };

// --- C9: fixed-host shape --------------------------------------------------

test("fixed-host: exact host+port+path match succeeds, zero extra connections", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = (options, callback) => {
        hits += 1;
        return makeSpyRequest(okResponder(callback));
    };
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });
    const res = await fetchFn("https://api.anthropic.test/v1/messages", { method: "POST", body: "{}" });
    assert.equal(res.status, 200);
    assert.equal(hits, 1);
});

test("fixed-host: path outside the allowlist is rejected with zero connections", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });
    await assert.rejects(
        fetchFn("https://api.anthropic.test/v1/models", { method: "POST", body: "{}" }),
        (err) => {
            assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
            return true;
        },
    );
    assert.equal(hits, 0);
});

test("fixed-host: query string, fragment, or userinfo on the request url is rejected", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });
    for (const url of [
        "https://api.anthropic.test/v1/messages?x=1",
        "https://api.anthropic.test/v1/messages#frag",
        "https://user:pw@api.anthropic.test/v1/messages",
    ]) {
        await assert.rejects(fetchFn(url, { method: "POST", body: "{}" }), (err) => {
            assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
            return true;
        });
    }
    assert.equal(hits, 0);
});

test("fixed-host: a different host than configured is rejected with zero connections", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });
    await assert.rejects(
        fetchFn("https://evil.example.com/v1/messages", { method: "POST", body: "{}" }),
        (err) => {
            assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
            return true;
        },
    );
    assert.equal(hits, 0);
});

test("fixed-host: a different port than configured is rejected with zero connections", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });
    await assert.rejects(
        fetchFn("https://api.anthropic.test:8443/v1/messages", { method: "POST", body: "{}" }),
        (err) => {
            assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
            return true;
        },
    );
    assert.equal(hits, 0);
});

test("fixed-host: http scheme is rejected, never https-downgraded", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });
    await assert.rejects(
        fetchFn("http://api.anthropic.test/v1/messages", { method: "POST", body: "{}" }),
        (err) => {
            assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
            return true;
        },
    );
    assert.equal(hits, 0);
});

test("fixed-host: policy is forced no-loopback/no-private even if caller opts in", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const lookup = (_h, _o, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]);
    const fetchFn = makeFixedHostFetch({
        fixedHost: FIXED_HOST,
        policyOpts: { allowLoopback: true, allowPrivate: true, allowHttpLoopback: true },
        lookup,
        httpsRequestSpy,
    });
    await assert.rejects(
        fetchFn("https://api.anthropic.test/v1/messages", { method: "POST", body: "{}" }),
        (err) => {
            assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
            return true;
        },
    );
    assert.equal(hits, 0);
});

test("fixed-host: mixed resolved addresses (public + private) reject the whole lookup", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const lookup = (_h, _o, cb) =>
        cb(null, [
            { address: "203.0.113.9", family: 4 },
            { address: "10.0.0.5", family: 4 },
        ]);
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, lookup, httpsRequestSpy });
    await assert.rejects(
        fetchFn("https://api.anthropic.test/v1/messages", { method: "POST", body: "{}" }),
        (err) => {
            assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
            return true;
        },
    );
    assert.equal(hits, 0);
});

test("fixed-host: a 30x redirect response is rejected and never followed", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = (options, callback) => {
        hits += 1;
        return makeSpyRequest(
            okResponder(callback, { statusCode: 302, headers: { location: "https://evil.example.com/steal" }, body: "redirecting" }),
        );
    };
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });
    await assert.rejects(
        fetchFn("https://api.anthropic.test/v1/messages", { method: "POST", body: "{}" }),
        (err) => {
            assert.equal(err.llmCode, "REDIRECT_REJECTED");
            return true;
        },
    );
    assert.equal(hits, 1, "exactly one request is attempted before the redirect is rejected");
});

test("fixed-host: NODE_USE_ENV_PROXY=1 + HTTPS_PROXY is never consulted", TEST_OPTS, async () => {
    let hits = 0;
    let seenOptions = null;
    const httpsRequestSpy = (options, callback) => {
        hits += 1;
        seenOptions = options;
        return makeSpyRequest(okResponder(callback));
    };
    process.env.HTTPS_PROXY = "http://127.0.0.1:1/decoy";
    process.env.NODE_USE_ENV_PROXY = "1";
    try {
        const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });
        const res = await fetchFn("https://api.anthropic.test/v1/messages", { method: "POST", body: "{}" });
        assert.equal(res.status, 200);
    } finally {
        delete process.env.HTTPS_PROXY;
        delete process.env.NODE_USE_ENV_PROXY;
    }
    assert.equal(hits, 1);
    assert.equal(seenOptions.hostname, "api.anthropic.test");
    assert.equal(seenOptions.agent.options.proxy, undefined);
});

test("fixed-host: response handed back exposes only allowlisted headers (no raw provider body leak path)", TEST_OPTS, async () => {
    const MARKER = "FAKEMARKER_t9q2";
    const httpsRequestSpy = (options, callback) =>
        makeSpyRequest(
            okResponder(callback, {
                statusCode: 400,
                headers: { "content-type": "application/json", "retry-after": "3", "x-upstream-secret": MARKER },
                body: JSON.stringify({ error: { message: `bad request ${MARKER}` } }),
            }),
        );
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });
    const res = await fetchFn("https://api.anthropic.test/v1/messages", { method: "POST", body: "{}" });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("retry-after"), "3");
    assert.equal(res.headers.get("x-upstream-secret"), null);
});

test("fixed-host: unconfigured/empty fixedHost is CONFIG_INVALID with zero connections", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const fetchFn = makeFixedHostFetch({ fixedHost: { host: "", pathAllowlist: [] }, httpsRequestSpy });
    await assert.rejects(
        fetchFn("https://api.anthropic.test/v1/messages", { method: "POST", body: "{}" }),
        (err) => {
            assert.equal(err.llmCode, "CONFIG_INVALID");
            return true;
        },
    );
    assert.equal(hits, 0);
});

test("fixed-host: default mode (no mode option) behaves exactly as before", TEST_OPTS, async () => {
    // Regression guard: adding the fixed-host branch must not change the
    // shipped default-mode shape check.
    let hits = 0;
    const server = http.createServer((req, res) => {
        hits += 1;
        res.setHeader("content-type", "application/json");
        res.end("{}");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const fetchFn = createGuardedFetch({
        baseUrl,
        policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [port] },
        timeoutMs: 3000,
        maxResponseBytes: 4096,
        deps: { lookup: require("node:dns").lookup, httpRequest: http.request, httpsRequest: require("node:https").request },
    });
    const res = await fetchFn(`${baseUrl}/chat/completions`, { method: "POST", body: "{}" });
    assert.equal(res.status, 200);
    assert.equal(hits, 1);
    await new Promise((r) => server.close(r));
});

// --- C8: header-normalize wrap ----------------------------------------------

test("C8: a CR/LF-poisoned header value yields CONFIG_INVALID, never throws, marker never surfaces", TEST_OPTS, async () => {
    const MARKER = "FAKEMARKER_crlf7a";
    const Logger = require("../../utils/Logger");
    const captured = [];
    const originalError = Logger.error;
    Logger.error = (msg) => captured.push(String(msg));

    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const fetchFn = makeFixedHostFetch({ fixedHost: FIXED_HOST, httpsRequestSpy });

    let caughtMessage = "";
    try {
        await fetchFn("https://api.anthropic.test/v1/messages", {
            method: "POST",
            body: "{}",
            headers: { "x-api-key": `good\r\nvalue-${MARKER}` },
        });
        assert.fail("expected a rejection");
    } catch (err) {
        assert.equal(err.llmCode, "CONFIG_INVALID");
        caughtMessage = err.message;
    } finally {
        Logger.error = originalError;
    }
    assert.equal(caughtMessage.includes(MARKER), false);
    assert.equal(captured.some((line) => line.includes(MARKER)), false);
    assert.equal(hits, 0, "no connection is attempted once the header shape is rejected");
});

test("C8: default mode is also protected by the header-normalize wrap", TEST_OPTS, async () => {
    const server = http.createServer((req, res) => res.end("{}"));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const fetchFn = createGuardedFetch({
        baseUrl,
        policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [port] },
        timeoutMs: 3000,
        maxResponseBytes: 4096,
        deps: { lookup: require("node:dns").lookup, httpRequest: http.request, httpsRequest: require("node:https").request },
    });
    await assert.rejects(
        fetchFn(`${baseUrl}/chat/completions`, {
            method: "POST",
            body: "{}",
            headers: { "x-custom": "bad\r\nvalue" },
        }),
        (err) => {
            assert.equal(err.llmCode, "CONFIG_INVALID");
            return true;
        },
    );
    await new Promise((r) => server.close(r));
});

// --- C10: credential shape + key-shaped-value detectors ---------------------

test("isValidCredentialShape accepts a printable-ASCII token within length bounds", () => {
    assert.equal(isValidCredentialShape("FAKEMARKER_abcDEF-123._~"), true);
    assert.equal(isValidCredentialShape("a".repeat(512)), true);
});

test("isValidCredentialShape rejects empty, oversized, non-ASCII, or control-character values", () => {
    assert.equal(isValidCredentialShape(""), false);
    assert.equal(isValidCredentialShape("a".repeat(513)), false);
    assert.equal(isValidCredentialShape("value with space"), false);
    assert.equal(isValidCredentialShape("bad\r\nvalue"), false);
    assert.equal(isValidCredentialShape("café"), false);
    assert.equal(isValidCredentialShape(123), false);
    assert.equal(isValidCredentialShape(null), false);
    assert.equal(isValidCredentialShape(undefined), false);
});

test("isKeyShapedValue detects an AIza-style Gemini key shape", () => {
    assert.equal(isKeyShapedValue(`AIza${"A".repeat(35)}`), true);
    assert.equal(isKeyShapedValue(`model-AIza${"B1".repeat(18)}-suffix`), true);
});

test("isKeyShapedValue detects sk- and sk-ant- style key shapes", () => {
    assert.equal(isKeyShapedValue("sk-" + "ant-FAKEMARKERabcdefghijklmnop"), true);
    assert.equal(isKeyShapedValue("s" + "k-FAKEMARKERabcdefghijklmnop"), true);
});

test("isKeyShapedValue returns false for ordinary model/path field values", () => {
    assert.equal(isKeyShapedValue("claude-3-5-sonnet"), false);
    assert.equal(isKeyShapedValue("/v1/messages"), false);
    assert.equal(isKeyShapedValue(""), false);
    assert.equal(isKeyShapedValue(42), false);
    assert.equal(isKeyShapedValue(null), false);
});
