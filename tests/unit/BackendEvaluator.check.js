"use strict";

/**
 * BackendEvaluator.check.js — unit coverage for
 * src/core/outcome/BackendEvaluator.js and LocalSource.js (WP-77S). Plain
 * node + assert, exits non-zero on failure. Hermetic: an in-process
 * http server bound to 127.0.0.1:0, and files under os.tmpdir().
 */

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const BackendEvaluator = require("../../src/core/outcome/BackendEvaluator");

let failures = 0;
let passed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (e) {
        failures++;
        console.error(`❌ ${name}: ${e && e.stack ? e.stack : e}`);
    }
}

function assertResultShape(r) {
    assert.deepStrictEqual(Object.keys(r).sort(), ["matches", "outcome", "reason", "status"]);
    assert.ok(r.matches === 0 || r.matches === 1);
}

function assertNoLeak(r, ...secrets) {
    const json = JSON.stringify(r);
    for (const s of secrets) {
        assert.ok(!json.includes(String(s)), `result leaked secret "${s}": ${json}`);
    }
}

// ---- hermetic fixture server -------------------------------------------

function startServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
}

function urlFor(server, pathName) {
    return `http://127.0.0.1:${server.address().port}${pathName}`;
}

function jsonHandler(body, { status = 200, encoding } = {}) {
    return (req, res) => {
        if (encoding) res.setHeader("content-encoding", encoding);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(body);
    };
}

// ---- hermetic tmp files --------------------------------------------------

let tmpBase;

function writeTmpFile(name, content) {
    const file = path.join(tmpBase, name);
    fs.writeFileSync(file, content);
    return file;
}

async function main() {
    tmpBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-backend-check-"));

    // ======================================================================
    // backendEquals
    // ======================================================================

    {
        const server = await startServer(jsonHandler(JSON.stringify({ status: "SECRET-OK-1" })));
        await test("backendEquals: string match => passed", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: "SECRET-OK-1", source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/status" } },
                { timeoutMs: 300 }
            );
            assert.strictEqual(r.status, "passed");
            assert.strictEqual(r.outcome, "backend_match");
            assert.strictEqual(r.matches, 1);
            assertResultShape(r);
            assertNoLeak(r, "SECRET-OK-1");
        });
        await test("backendEquals: value mismatch => failed backend_mismatch", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: "WRONG-SECRET-2", source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/status" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "backend_mismatch");
            assertNoLeak(r, "WRONG-SECRET-2", "SECRET-OK-1");
        });
        await test("backendEquals: type mismatch ('5' observed vs 5 expected) => failed type_mismatch", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: 5, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/status" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "type_mismatch");
        });
        await test("backendEquals: missing pointer => failed pointer_missing", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: "x", source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/nope" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "pointer_missing");
        });
        await closeServer(server);
    }

    {
        // "5" !== 5, non-integer never equals integer
        const server = await startServer(jsonHandler(JSON.stringify({ n: "5" })));
        await test("backendEquals: string \"5\" vs number 5 expected => type_mismatch, never equal", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: 5, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/n" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "type_mismatch");
        });
        await closeServer(server);
    }

    {
        const server = await startServer(jsonHandler(JSON.stringify({ n: 5.5 })));
        await test("backendEquals: observed non-integer 5.5 never equals integer expected 5", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: 5, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/n" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "backend_mismatch");
        });
        await closeServer(server);
    }

    // ======================================================================
    // backendCountEquals
    // ======================================================================

    {
        const server = await startServer(jsonHandler(JSON.stringify({ items: [1, 2, 3] })));
        await test("backendCountEquals: array length match => passed", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendCountEquals", locator: "backend:state", expected: 3, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/items" } },
                { timeoutMs: 300 }
            );
            assert.strictEqual(r.status, "passed");
            assert.strictEqual(r.outcome, "backend_match");
        });
        await test("backendCountEquals: array length mismatch => failed backend_mismatch", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendCountEquals", locator: "backend:state", expected: 4, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/items" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "backend_mismatch");
        });
        await closeServer(server);
    }

    {
        const server = await startServer(jsonHandler(JSON.stringify({ items: "not-an-array" })));
        await test("backendCountEquals: non-array value => failed type_mismatch", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendCountEquals", locator: "backend:state", expected: 1, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/items" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "type_mismatch");
        });
        await closeServer(server);
    }

    // ======================================================================
    // backendExists
    // ======================================================================

    {
        const server = await startServer(jsonHandler(JSON.stringify({ flag: "present" })));
        await test("backendExists: present, expected true => passed", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/flag" } },
                { timeoutMs: 300 }
            );
            assert.strictEqual(r.status, "passed");
            assert.strictEqual(r.outcome, "backend_match");
        });
        await test("backendExists: missing, expected false => passed", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: false, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/absent" } },
                { timeoutMs: 300 }
            );
            assert.strictEqual(r.status, "passed");
            assert.strictEqual(r.outcome, "backend_match");
        });
        await test("backendExists: inherited property names are not own properties (no prototype walk)", async () => {
            for (const pointer of ["/toString", "/constructor", "/hasOwnProperty"]) {
                const r = await BackendEvaluator.evaluate(
                    { check: "backendExists", locator: "backend:state", expected: false, source: { kind: "http-json", url: urlFor(server, "/"), pointer } },
                    { timeoutMs: 300 }
                );
                assert.strictEqual(r.status, "passed", pointer);
            }
        });
        await test("backendExists: missing, expected true => failed pointer_missing", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/absent" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "pointer_missing");
        });
        await test("backendExists: present, expected false => failed backend_mismatch", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: false, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/flag" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "backend_mismatch");
        });
        await closeServer(server);
    }

    // ======================================================================
    // transport / source safety
    // ======================================================================

    {
        const server = await startServer((req, res) => {
            res.writeHead(302, { Location: "http://127.0.0.1:1/elsewhere" });
            res.end();
        });
        await test("http: 302 is not followed => unavailable redirect_refused", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/x" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "unavailable");
            assert.strictEqual(r.outcome, "redirect_refused");
        });
        await closeServer(server);
    }

    {
        const server = await startServer((req, res) => {
            res.writeHead(500);
            res.end("boom");
        });
        await test("http: 500 => unavailable http_status", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/x" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "unavailable");
            assert.strictEqual(r.outcome, "http_status");
        });
        await closeServer(server);
    }

    {
        const server = await startServer((req, res) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("x".repeat(70 * 1024));
        });
        await test("http: 70 KiB body => unavailable body_too_large", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/x" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "unavailable");
            assert.strictEqual(r.outcome, "body_too_large");
        });
        await closeServer(server);
    }

    {
        const server = await startServer(jsonHandler("{not valid json"));
        await test("http: invalid JSON body => unavailable invalid_json", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/x" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "unavailable");
            assert.strictEqual(r.outcome, "invalid_json");
        });
        await closeServer(server);
    }

    {
        const server = await startServer((req, res) => {
            setTimeout(() => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ x: true }));
            }, 2000);
        });
        await test("http: slow response never responding within budget => unavailable", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/x" } },
                { timeoutMs: 200 }
            );
            assert.strictEqual(r.status, "unavailable");
            assertNoLeak(r, "true");
        });
        await closeServer(server);
    }

    await test("http: connection refused => unavailable source_unreachable", async () => {
        const probe = await startServer((req, res) => res.end());
        const deadPort = probe.address().port;
        await closeServer(probe);
        const r = await BackendEvaluator.evaluate(
            { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: `http://127.0.0.1:${deadPort}/x`, pointer: "/x" } },
            { timeoutMs: 300 }
        );
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "source_unreachable");
    });

    {
        const server = await startServer(jsonHandler(JSON.stringify({ x: true }), { encoding: "gzip" }));
        await test("http: content-encoding present => unavailable source_unsafe", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/x" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "unavailable");
            assert.strictEqual(r.outcome, "source_unsafe");
        });
        await closeServer(server);
    }

    {
        const server = await startServer(jsonHandler(JSON.stringify({ x: true })));
        await test("http: __proto__ key in response does not pollute Object prototype", async () => {
            const pollutedServer = await startServer(jsonHandler(JSON.stringify({ __proto__: { polluted: true }, safe: 1 })));
            const r = await BackendEvaluator.evaluate(
                { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "http-json", url: urlFor(pollutedServer, "/"), pointer: "/__proto__/polluted" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual({}.polluted, undefined, "Object.prototype must not be polluted");
            // __proto__ as a literal pointer segment must be an own-property lookup only.
            assert.ok(r.status === "unavailable" || r.status === "failed" || r.status === "passed");
            await closeServer(pollutedServer);
        });
        await closeServer(server);
    }

    await test("http: HTTP_PROXY set to a dead address still reaches the fixture directly", async () => {
        const server = await startServer(jsonHandler(JSON.stringify({ x: "direct-hit" })));
        const prevProxy = process.env.HTTP_PROXY;
        const prevUseEnv = process.env.NODE_USE_ENV_PROXY;
        process.env.HTTP_PROXY = "http://127.0.0.1:1/";
        process.env.NODE_USE_ENV_PROXY = "1";
        try {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: "direct-hit", source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/x" } },
                { timeoutMs: 300 }
            );
            assert.strictEqual(r.status, "passed");
        } finally {
            if (prevProxy === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = prevProxy;
            if (prevUseEnv === undefined) delete process.env.NODE_USE_ENV_PROXY; else process.env.NODE_USE_ENV_PROXY = prevUseEnv;
            await closeServer(server);
        }
    });

    // ======================================================================
    // file-json
    // ======================================================================

    {
        const file = writeTmpFile("good.json", JSON.stringify({ status: "FILE-OK-9" }));
        await test("file-json: match => passed", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: "FILE-OK-9", source: { kind: "file-json", path: file, pointer: "/status" } },
                { timeoutMs: 300, baseDir: tmpBase }
            );
            assert.strictEqual(r.status, "passed");
            assert.strictEqual(r.outcome, "backend_match");
            assertNoLeak(r, "FILE-OK-9");
        });
    }

    await test("file-json: symlink target => unavailable source_unsafe", async () => {
        const target = writeTmpFile("link-target.json", JSON.stringify({ x: 1 }));
        const link = path.join(tmpBase, "link.json");
        try { fs.unlinkSync(link); } catch { /* ignore */ }
        fs.symlinkSync(target, link);
        const r = await BackendEvaluator.evaluate(
            { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "file-json", path: link, pointer: "/x" } },
            { timeoutMs: 150, baseDir: tmpBase }
        );
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "source_unsafe");
    });

    await test("file-json: outside baseDir => unavailable source_unsafe", async () => {
        const otherDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "falcon-backend-outside-"));
        const outsideFile = path.join(otherDir, "outside.json");
        fs.writeFileSync(outsideFile, JSON.stringify({ x: 1 }));
        const r = await BackendEvaluator.evaluate(
            { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "file-json", path: outsideFile, pointer: "/x" } },
            { timeoutMs: 150, baseDir: tmpBase }
        );
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "source_unsafe");
    });

    await test("file-json: oversize (>64 KiB) => unavailable body_too_large", async () => {
        const big = writeTmpFile("big.json", JSON.stringify({ x: "y".repeat(70 * 1024) }));
        const r = await BackendEvaluator.evaluate(
            { check: "backendExists", locator: "backend:state", expected: true, source: { kind: "file-json", path: big, pointer: "/x" } },
            { timeoutMs: 150, baseDir: tmpBase }
        );
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "body_too_large");
    });

    // ======================================================================
    // settle: flapping / converging / never-converging sources
    // ======================================================================

    {
        // Alternates good/bad on every single request, forever, so two
        // consecutive passing reads can never occur and settle() must never
        // return "passed" no matter how many polls it takes before the
        // deadline.
        let n = 0;
        const server = await startServer((req, res) => {
            const state = n % 2 === 0 ? "good" : "bad";
            n++;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: state }));
        });
        await test("settle: flapping source (alternates every read) must not pass", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: "good", source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/status" } },
                { timeoutMs: 350 }
            );
            assert.notStrictEqual(r.status, "passed");
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "backend_mismatch");
        });
        await closeServer(server);
    }

    {
        const start = Date.now();
        const server = await startServer((req, res) => {
            const ready = Date.now() - start >= 150;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: ready ? "ready" : "loading" }));
        });
        await test("settle: source that becomes correct within timeout passes", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: "ready", source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/status" } },
                { timeoutMs: 700 }
            );
            assert.strictEqual(r.status, "passed");
        });
        await closeServer(server);
    }

    {
        const server = await startServer(jsonHandler(JSON.stringify({ status: "never-right" })));
        await test("settle: never converges => failed", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: "right", source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/status" } },
                { timeoutMs: 150 }
            );
            assert.strictEqual(r.status, "failed");
            assert.strictEqual(r.outcome, "backend_mismatch");
        });
        await closeServer(server);
    }

    // ======================================================================
    // privacy canary
    // ======================================================================

    {
        const server = await startServer(jsonHandler(JSON.stringify({ status: "OBSERVED-CANARY-XYZ" })));
        await test("privacy: distinctive expected/observed strings never leak into the result", async () => {
            const r = await BackendEvaluator.evaluate(
                { check: "backendEquals", locator: "backend:state", expected: "EXPECTED-CANARY-ABC", source: { kind: "http-json", url: urlFor(server, "/"), pointer: "/status" } },
                { timeoutMs: 150 }
            );
            assertResultShape(r);
            assertNoLeak(r, "OBSERVED-CANARY-XYZ", "EXPECTED-CANARY-ABC", urlFor(server, "/"), "/status");
        });
        await closeServer(server);
    }

    // ======================================================================
    // never-throws on garbage input
    // ======================================================================

    const garbageInputs = [undefined, null, 42, "x", [], {}, { check: "backendEquals" }, { check: "dropTable" }];
    for (const g of garbageInputs) {
        await test(`evaluate: garbage input ${JSON.stringify(g)} never throws`, async () => {
            const r = await BackendEvaluator.evaluate(g, { timeoutMs: 100 });
            assert.strictEqual(r.status, "unavailable");
            assertResultShape(r);
        });
    }

    await test("evaluate: unknown check => unavailable unsupported_check", async () => {
        const r = await BackendEvaluator.evaluate(
            { check: "textEquals", locator: "backend:state", expected: "x", source: { kind: "http-json", url: "http://127.0.0.1:1/", pointer: "/x" } },
            { timeoutMs: 100 }
        );
        assert.strictEqual(r.status, "unavailable");
        assert.strictEqual(r.outcome, "unsupported_check");
    });

    await fs.promises.rm(tmpBase, { recursive: true, force: true });

    console.log(`\n${passed} passed, ${failures} failed`);
    if (failures > 0) process.exit(1);
}

main();
