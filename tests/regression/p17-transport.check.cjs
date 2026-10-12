/**
 * tests/regression/p17-transport.check.cjs — Phase 17 guardedFetch transport
 * regression checks (ADR-0017 section 8, Sec-00 S-02/S-03/S-04/S-06/S-07/S-13).
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/p17-transport.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const { EventEmitter } = require("node:events");

const { createGuardedFetch } = require("../../src/core/llm/transport/guardedFetch");

const TEST_OPTS = { timeout: 8000 };
const MARKER = "secret-marker-9f3a";

function listen(server) {
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
}

function closeAll(...servers) {
    return Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
}

function policyOptsFor(port) {
    return { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [port] };
}

function makeFetch({ port, policyOpts, timeoutMs = 3000, maxResponseBytes = 1024 * 1024, deps }) {
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    return {
        baseUrl,
        chatUrl: `${baseUrl}/chat/completions`,
        fetchFn: createGuardedFetch({
            baseUrl,
            policyOpts: policyOpts || policyOptsFor(port),
            timeoutMs,
            maxResponseBytes,
            deps: deps || { lookup: require("node:dns").lookup, httpRequest: http.request, httpsRequest: https.request },
        }),
    };
}

// A minimal fake request/response pair for tests that must never touch a
// real socket (DNS-rebinding and TLS-option assertions use this spy, not a
// real network connection).
function makeSpyRequest(respond) {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => {
        setImmediate(() => respond());
    };
    return req;
}

test("redirect response is rejected and never followed", TEST_OPTS, async () => {
    let decoyHits = 0;
    const decoy = http.createServer((req, res) => {
        decoyHits += 1;
        res.end("should-not-be-hit");
    });
    const decoyPort = await listen(decoy);

    const server = http.createServer((req, res) => {
        res.writeHead(302, { Location: `http://127.0.0.1:${decoyPort}/${MARKER}` });
        res.end("redirecting");
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port });

    await assert.rejects(
        fetchFn(chatUrl, { method: "POST", body: "{}" }),
        (err) => {
            assert.equal(err.llmCode, "REDIRECT_REJECTED");
            assert.equal(err.message.includes(MARKER), false);
            return true;
        }
    );
    assert.equal(decoyHits, 0);
    await closeAll(server, decoy);
});

test("oversized response rejected via Content-Length", TEST_OPTS, async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Length": String(10 * 1024 * 1024), "Content-Type": "application/json" });
        res.end();
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port, maxResponseBytes: 1024 });
    await assert.rejects(fetchFn(chatUrl, { method: "POST", body: "{}" }), (err) => {
        assert.equal(err.llmCode, "OVERSIZED");
        return true;
    });
    await closeAll(server);
});

test("oversized chunked stream rejected and memory stays bounded", TEST_OPTS, async () => {
    const server = http.createServer((req, res) => {
        res.on("error", () => {});
        res.writeHead(200, { "Content-Type": "application/json" });
        const chunk = Buffer.alloc(64 * 1024, 1);
        let sent = 0;
        const total = 10 * 1024 * 1024;
        const iv = setInterval(() => {
            if (sent >= total || res.destroyed || res.writableEnded) {
                clearInterval(iv);
                if (!res.destroyed && !res.writableEnded) res.end();
                return;
            }
            try {
                res.write(chunk);
            } catch {
                clearInterval(iv);
                return;
            }
            sent += chunk.length;
        }, 1);
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port, timeoutMs: 4000, maxResponseBytes: 1024 * 1024 });
    const before = process.memoryUsage().heapUsed;
    await assert.rejects(fetchFn(chatUrl, { method: "POST", body: "{}" }), (err) => {
        assert.equal(err.llmCode, "OVERSIZED");
        return true;
    });
    const after = process.memoryUsage().heapUsed;
    assert.ok(after - before < 20 * 1024 * 1024, "heap growth should stay bounded, not scale with the 10MB stream");
    await closeAll(server);
});

test("gzip content-encoding rejected as malformed response", TEST_OPTS, async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Encoding": "gzip", "Content-Type": "application/json" });
        res.end(Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port });
    await assert.rejects(fetchFn(chatUrl, { method: "POST", body: "{}" }), (err) => {
        assert.equal(err.llmCode, "MALFORMED_RESPONSE");
        return true;
    });
    await closeAll(server);
});

test("hang times out within bound", TEST_OPTS, async () => {
    const server = http.createServer(() => {
        // never responds
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port, timeoutMs: 500 });
    const start = Date.now();
    await assert.rejects(fetchFn(chatUrl, { method: "POST", body: "{}" }), (err) => {
        assert.equal(err.llmCode, "TIMEOUT");
        return true;
    });
    assert.ok(Date.now() - start < 500 + 1000);
    await closeAll(server);
});

test("connection reset surfaces as NETWORK_ERROR", TEST_OPTS, async () => {
    const server = http.createServer((req) => {
        req.socket.destroy();
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port });
    await assert.rejects(fetchFn(chatUrl, { method: "POST", body: "{}" }), (err) => {
        assert.equal(err.llmCode, "NETWORK_ERROR");
        return true;
    });
    await closeAll(server);
});

test("request URL outside <base>/chat/completions is rejected with zero connections", TEST_OPTS, async () => {
    let hits = 0;
    const server = http.createServer((req, res) => {
        hits += 1;
        res.end("{}");
    });
    const port = await listen(server);
    const { fetchFn, baseUrl } = makeFetch({ port });

    await assert.rejects(fetchFn(`${baseUrl}/models`, { method: "POST", body: "{}" }), (err) => {
        assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
        return true;
    });
    await assert.rejects(fetchFn(`http://127.0.0.1:9/chat/completions`, { method: "POST", body: "{}" }), (err) => {
        assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
        return true;
    });
    await assert.rejects(fetchFn(`${baseUrl}/chat/completions?x=1`, { method: "POST", body: "{}" }), (err) => {
        assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
        return true;
    });
    assert.equal(hits, 0);
    await closeAll(server);
});

test("DNS-rebinding: second resolution is never used, pinned address is the one connected", TEST_OPTS, async () => {
    let lookupCalls = 0;
    const lookup = (hostname, options, callback) => {
        lookupCalls += 1;
        if (lookupCalls === 1) {
            callback(null, [{ address: "203.0.113.5", family: 4 }]);
        } else {
            callback(null, [{ address: "198.51.100.9", family: 4 }]);
        }
    };

    let seenConnectAddress = null;
    const httpsRequestSpy = (options, callback) => {
        // Resolve the pinned address through the custom `lookup` option the
        // same way Node's TLS/net layer would, without ever opening a real
        // socket.
        options.lookup("api.internal.test", {}, (err, address) => {
            seenConnectAddress = address;
        });
        return makeSpyRequest(() => {
            const res = new EventEmitter();
            res.statusCode = 200;
            res.headers = { "content-type": "application/json" };
            res.destroy = () => {};
            callback(res);
            setImmediate(() => {
                res.emit("data", Buffer.from("{}"));
                res.emit("end");
            });
        });
    };

    const baseUrl = "https://api.internal.test:443/v1";
    const fetchFn = createGuardedFetch({
        baseUrl,
        policyOpts: { allowLoopback: false, allowHttpLoopback: false },
        timeoutMs: 3000,
        maxResponseBytes: 1024,
        deps: { lookup, httpRequest: http.request, httpsRequest: httpsRequestSpy },
    });

    const res = await fetchFn(`${baseUrl}/chat/completions`, { method: "POST", body: "{}" });
    assert.equal(res.status, 200);
    assert.equal(lookupCalls, 1);
    assert.equal(seenConnectAddress, "203.0.113.5");
});

test("mixed resolved answers (public + private) are rejected with zero connections", TEST_OPTS, async () => {
    let hits = 0;
    const httpsRequestSpy = () => {
        hits += 1;
        return makeSpyRequest(() => {});
    };
    const lookup = (hostname, options, callback) => {
        callback(null, [
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.5", family: 4 },
        ]);
    };

    const baseUrl = "https://example.test:443/v1";
    const fetchFn = createGuardedFetch({
        baseUrl,
        policyOpts: { allowLoopback: false, allowHttpLoopback: false, allowPrivate: false },
        timeoutMs: 3000,
        maxResponseBytes: 1024,
        deps: { lookup, httpRequest: http.request, httpsRequest: httpsRequestSpy },
    });
    await assert.rejects(fetchFn(`${baseUrl}/chat/completions`, { method: "POST", body: "{}" }), (err) => {
        assert.equal(err.llmCode, "ENDPOINT_POLICY_REJECTED");
        return true;
    });
    assert.equal(hits, 0);
});

test("production-shaped https base is accepted by the policy path (spy, no real network)", TEST_OPTS, async () => {
    let seenOptions = null;
    const httpsRequestSpy = (options, callback) => {
        seenOptions = options;
        return makeSpyRequest(() => {
            const res = new EventEmitter();
            res.statusCode = 200;
            res.headers = { "content-type": "application/json" };
            res.destroy = () => {};
            callback(res);
            setImmediate(() => {
                res.emit("data", Buffer.from("{}"));
                res.emit("end");
            });
        });
    };
    const lookup = (hostname, options, callback) => callback(null, [{ address: "203.0.113.9", family: 4 }]);

    const baseUrl = "https://llm.example.org/v1";
    const fetchFn = createGuardedFetch({
        baseUrl,
        policyOpts: {},
        timeoutMs: 3000,
        maxResponseBytes: 1024,
        deps: { lookup, httpRequest: http.request, httpsRequest: httpsRequestSpy },
    });
    const res = await fetchFn(`${baseUrl}/chat/completions`, { method: "POST", body: "{}" });
    assert.equal(res.status, 200);
    assert.equal(seenOptions.path, "/v1/chat/completions");
    assert.equal(seenOptions.rejectUnauthorized, true);
});

test("error message and Logger output never contain a planted marker", TEST_OPTS, async () => {
    const Logger = require("../../utils/Logger");
    const captured = [];
    const originalError = Logger.error;
    Logger.error = (msg) => captured.push(String(msg));
    const server = http.createServer((req, res) => {
        res.writeHead(302, { Location: `http://127.0.0.1/${MARKER}` });
        res.end();
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port, maxResponseBytes: 1024 });
    let caughtMessage = "";
    try {
        await fetchFn(chatUrl, { method: "POST", body: "{}" });
    } catch (err) {
        caughtMessage = err.message;
    } finally {
        Logger.error = originalError;
    }
    assert.equal(caughtMessage.includes(MARKER), false);
    assert.equal(captured.some((line) => line.includes(MARKER)), false);
    await closeAll(server);
});

test("https: rejectUnauthorized is explicit true when the process environment relaxes TLS checks", TEST_OPTS, async () => {
    // Run in a child process so the relaxed environment never touches this one.
    const { spawnSync } = require("node:child_process");
    const path = require("node:path");
    const modulePath = path.join(__dirname, "..", "..", "src", "core", "llm", "transport", "guardedFetch");
    const script = `
        const { EventEmitter } = require("node:events");
        const { createGuardedFetch } = require(${JSON.stringify(modulePath)});
        let seen = null;
        const spy = (options, callback) => {
            seen = options;
            const req = new EventEmitter();
            req.setTimeout = () => req; req.write = () => {}; req.destroy = () => {};
            req.end = () => {
                const res = new EventEmitter();
                res.statusCode = 200; res.headers = { "content-type": "application/json" }; res.destroy = () => {};
                callback(res);
                setImmediate(() => { res.emit("data", Buffer.from("{}")); res.emit("end"); });
            };
            return req;
        };
        const baseUrl = "https://api.internal.test:443/v1";
        createGuardedFetch({
            baseUrl, policyOpts: {}, timeoutMs: 3000, maxResponseBytes: 1024,
            deps: { lookup: (h, o, cb) => cb(null, [{ address: "203.0.113.9", family: 4 }]), httpRequest: require("node:http").request, httpsRequest: spy },
        })(baseUrl + "/chat/completions", { method: "POST", body: "{}" }).then(() => {
            process.stdout.write(JSON.stringify({ ru: seen.rejectUnauthorized, sn: seen.servername }));
        });
    `;
    const relaxed = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
    const out = spawnSync(process.execPath, ["-e", script], { env: relaxed, encoding: "utf8", timeout: 6000 });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), { ru: true, sn: "api.internal.test" });
});

test("no proxy settings are consulted even with proxy env vars pointing at a decoy", TEST_OPTS, async () => {
    let decoyHits = 0;
    const decoy = http.createServer((req, res) => {
        decoyHits += 1;
        res.end("decoy");
    });
    const decoyPort = await listen(decoy);

    const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    const port = await listen(server);

    process.env.HTTP_PROXY = `http://127.0.0.1:${decoyPort}`;
    process.env.HTTPS_PROXY = `http://127.0.0.1:${decoyPort}`;
    process.env.ALL_PROXY = `http://127.0.0.1:${decoyPort}`;
    process.env.NODE_USE_ENV_PROXY = "1";
    try {
        const { fetchFn, chatUrl } = makeFetch({ port });
        const res = await fetchFn(chatUrl, { method: "POST", body: "{}" });
        assert.equal(res.status, 200);
    } finally {
        delete process.env.HTTP_PROXY;
        delete process.env.HTTPS_PROXY;
        delete process.env.ALL_PROXY;
        delete process.env.NODE_USE_ENV_PROXY;
    }
    assert.equal(decoyHits, 0);
    await closeAll(server, decoy);
});

test("DEF-02: WHATWG Headers instance carrying authorization/content-type survives to the wire", TEST_OPTS, async () => {
    let seenHeaders = null;
    const server = http.createServer((req, res) => {
        seenHeaders = req.headers;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port });
    const headers = new Headers([
        ["Authorization", "Bearer TESTKEY123"],
        ["Content-Type", "application/json"],
    ]);
    const res = await fetchFn(chatUrl, { method: "POST", body: "{}", headers });
    assert.equal(res.status, 200);
    assert.equal(seenHeaders.authorization, "Bearer TESTKEY123");
    assert.equal(seenHeaders["content-type"], "application/json");
    assert.equal(seenHeaders["accept-encoding"], "identity");
    await closeAll(server);
});

test("DEF-02: plain-object headers still survive to the wire", TEST_OPTS, async () => {
    let seenHeaders = null;
    const server = http.createServer((req, res) => {
        seenHeaders = req.headers;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port });
    const res = await fetchFn(chatUrl, {
        method: "POST",
        body: "{}",
        headers: { Authorization: "Bearer TESTKEY123", "X-Custom": "yes" },
    });
    assert.equal(res.status, 200);
    assert.equal(seenHeaders.authorization, "Bearer TESTKEY123");
    assert.equal(seenHeaders["x-custom"], "yes");
    assert.equal(seenHeaders["accept-encoding"], "identity");
    await closeAll(server);
});

test("DEF-02: array-of-pairs headers still survive to the wire", TEST_OPTS, async () => {
    let seenHeaders = null;
    const server = http.createServer((req, res) => {
        seenHeaders = req.headers;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port });
    const res = await fetchFn(chatUrl, {
        method: "POST",
        body: "{}",
        headers: [["Authorization", "Bearer TESTKEY123"]],
    });
    assert.equal(res.status, 200);
    assert.equal(seenHeaders.authorization, "Bearer TESTKEY123");
    assert.equal(seenHeaders["accept-encoding"], "identity");
    await closeAll(server);
});

test("DEF-02: hop-by-hop headers from the caller are stripped, not forwarded", TEST_OPTS, async () => {
    let seenHeaders = null;
    const server = http.createServer((req, res) => {
        seenHeaders = req.headers;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port });
    try {
        const res = await fetchFn(chatUrl, {
            method: "POST",
            body: "{}",
            headers: new Headers([
                ["Authorization", "Bearer TESTKEY123"],
                ["Connection", "keep-alive"],
                ["Transfer-Encoding", "chunked"],
                ["Content-Length", "999"],
                ["Proxy-Authorization", "Basic xxx"],
            ]),
        });
        assert.equal(res.status, 200);
        assert.equal(seenHeaders.authorization, "Bearer TESTKEY123");
        // The caller's forged Content-Length (999) must never reach the wire
        // verbatim; Node recomputes the actual framing for the 2-byte body.
        assert.notEqual(seenHeaders["content-length"], "999");
        assert.equal(seenHeaders["proxy-authorization"], undefined);
    } finally {
        await closeAll(server);
    }
});

test("response handed back exposes only allowlisted headers", TEST_OPTS, async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Retry-After": "5",
            "X-Secret-Internal": MARKER,
        });
        res.end("{\"ok\":true}");
    });
    const port = await listen(server);
    const { fetchFn, chatUrl } = makeFetch({ port });
    const res = await fetchFn(chatUrl, { method: "POST", body: "{}" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("retry-after"), "5");
    assert.equal(res.headers.get("x-secret-internal"), null);
    const text = await res.text();
    assert.equal(text, "{\"ok\":true}");
    await closeAll(server);
});
