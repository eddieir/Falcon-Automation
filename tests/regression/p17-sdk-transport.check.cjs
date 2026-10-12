/**
 * tests/regression/p17-sdk-transport.check.cjs — Phase 17 end-to-end check
 * that the REAL openai SDK, driven through guardedFetch, sends an
 * authenticated, policy-compliant request and nothing leaks (ADR-0017
 * section 8, Sec-00 S-12/S-15). This REPLACES the redirect-based mechanism
 * of tests/regression/openai-sdk.check.cjs (which reaches its mock via
 * process.env.OPENAI_BASE_URL — exactly the redirect Phase 17 forbids).
 * That old file is left untouched by this task.
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/p17-sdk-transport.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const dns = require("node:dns");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");

const rq = createRequire(path.join(__dirname, "..", "..", "x.js"));
const { createGuardedFetch } = rq("./src/core/llm/transport/guardedFetch.js");
const OAI = rq("openai");
const OpenAI = OAI.OpenAI || OAI.default;

const TEST_OPTS = { timeout: 8000 };

function listen(server) {
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function closeAll(...servers) {
    return Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
}

function makeGuardedFetch(baseUrl, port, extra = {}) {
    return createGuardedFetch({
        baseUrl,
        policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [port] },
        timeoutMs: 4000,
        maxResponseBytes: 65536,
        deps: { lookup: dns.lookup, httpRequest: http.request, httpsRequest: require("node:https").request },
        ...extra,
    });
}

function chatPayload() {
    return {
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o-mini",
        choices: [{ index: 0, message: { role: "assistant", content: "3" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    };
}

test("(1) real SDK through guardedFetch: auth header, identity encoding, no org/project headers, body shape", TEST_OPTS, async () => {
    let seenHeaders = null;
    let seenBody = null;
    const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
            seenHeaders = req.headers;
            seenBody = JSON.parse(raw);
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(chatPayload()));
        });
    });
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/v1`;

    const client = new OpenAI({
        apiKey: "test-key-123",
        baseURL: baseUrl,
        organization: null,
        project: null,
        maxRetries: 0,
        timeout: 4000,
        fetch: makeGuardedFetch(baseUrl, port),
        logLevel: "off",
    });

    const reply = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "pick" }],
        max_tokens: 80,
        temperature: 0,
    });

    assert.equal(reply.choices[0].message.content, "3");
    assert.equal(reply.usage.prompt_tokens, 5);
    assert.equal(reply.usage.completion_tokens, 1);

    assert.equal(seenBody.model, "gpt-4o-mini");
    assert.equal(seenBody.max_tokens, 80);
    assert.equal(seenBody.temperature, 0);

    assert.equal(seenHeaders.authorization, "Bearer test-key-123");
    assert.equal(seenHeaders["accept-encoding"], "identity");
    assert.ok(seenHeaders["user-agent"], "user-agent must be present");
    assert.equal(seenHeaders["openai-organization"], undefined);
    assert.equal(seenHeaders["openai-project"], undefined);

    await closeAll(server);
});

test("(2) S-12: OPENAI_BASE_URL/ORG/PROJECT/ADMIN_KEY env vars pointed at a decoy are never consulted", TEST_OPTS, async () => {
    let decoyHits = 0;
    const decoy = http.createServer((req, res) => {
        decoyHits += 1;
        res.end("{}");
    });
    const decoyPort = await listen(decoy);

    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(chatPayload()));
    });
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/v1`;

    const savedEnv = {
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
        OPENAI_ORG_ID: process.env.OPENAI_ORG_ID,
        OPENAI_PROJECT_ID: process.env.OPENAI_PROJECT_ID,
        OPENAI_ADMIN_KEY: process.env.OPENAI_ADMIN_KEY,
    };
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${decoyPort}/v1`;
    process.env.OPENAI_ORG_ID = "org-MARK";
    process.env.OPENAI_PROJECT_ID = "proj-MARK";
    process.env.OPENAI_ADMIN_KEY = "admin-MARK";

    try {
        const client = new OpenAI({
            apiKey: "test-key-123",
            baseURL: baseUrl,
            organization: null,
            project: null,
            maxRetries: 0,
            timeout: 4000,
            fetch: makeGuardedFetch(baseUrl, port),
            logLevel: "off",
        });
        const reply = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "pick" }],
        });
        assert.equal(reply.choices[0].message.content, "3");
    } finally {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }

    assert.equal(decoyHits, 0);
    await closeAll(server, decoy);
});

test("(3) S-15: no key/org/project marker leaks to stdout/stderr even with OPENAI_LOG=debug", TEST_OPTS, async () => {
    const scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "p17-sdk-")), "child.cjs");
    const script = `
"use strict";
const http = require("node:http");
const dns = require("node:dns");
const { createRequire } = require("node:module");
const rq = createRequire(${JSON.stringify(path.join(__dirname, "..", "..", "x.js"))});
const { createGuardedFetch } = rq("./src/core/llm/transport/guardedFetch.js");
const OAI = rq("openai");
const OpenAI = OAI.OpenAI || OAI.default;

(async () => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(${JSON.stringify(chatPayload())}));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const bad = http.createServer((req, res) => {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: { message: "bad key" } }));
    });
    await new Promise((r) => bad.listen(0, "127.0.0.1", r));
    const badPort = bad.address().port;

    const mkFetch = (baseUrl, p) => createGuardedFetch({
        baseUrl,
        policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [p] },
        timeoutMs: 4000,
        maxResponseBytes: 65536,
        deps: { lookup: dns.lookup, httpRequest: http.request, httpsRequest: require("node:https").request },
    });

    const okBase = \`http://127.0.0.1:\${port}/v1\`;
    const okClient = new OpenAI({
        apiKey: "FALCONMARKKEY",
        baseURL: okBase,
        organization: "org-FALCONMARKORG",
        project: null,
        maxRetries: 0,
        timeout: 4000,
        fetch: mkFetch(okBase, port),
        logLevel: "off",
    });
    await okClient.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "x" }] });

    const badBase = \`http://127.0.0.1:\${badPort}/v1\`;
    const badClient = new OpenAI({
        apiKey: "FALCONMARKKEY",
        baseURL: badBase,
        organization: "org-FALCONMARKORG",
        project: null,
        maxRetries: 0,
        timeout: 4000,
        fetch: mkFetch(badBase, badPort),
        logLevel: "off",
    });
    try {
        await badClient.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "x" }] });
    } catch (e) {
        console.log("401-status:", e.status);
    }
    await new Promise((r) => server.close(r));
    await new Promise((r) => bad.close(r));
})().catch((e) => {
    console.error("CHILD ERROR", e && e.message);
    process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
        cwd: path.join(__dirname, "..", ".."),
        env: { ...process.env, OPENAI_LOG: "debug" },
        encoding: "utf8",
        timeout: 8000,
    });

    const combined = `${result.stdout || ""}${result.stderr || ""}`;
    assert.equal(result.status, 0, `child exited ${result.status}: ${combined}`);
    const keyHits = combined.split("FALCONMARKKEY").length - 1;
    const orgHits = combined.split("FALCONMARKORG").length - 1;
    assert.equal(keyHits, 0, "apiKey marker must never appear in stdout/stderr");
    assert.equal(orgHits, 0, "org marker must never appear in stdout/stderr");

    fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
});

test("(4) non-2xx statuses surface as error.status with no retry (maxRetries:0)", TEST_OPTS, async () => {
    for (const statusCode of [401, 429, 500]) {
        let hitCount = 0;
        const server = http.createServer((req, res) => {
            hitCount += 1;
            res.statusCode = statusCode;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: { message: "upstream error" } }));
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const client = new OpenAI({
            apiKey: "test-key-123",
            baseURL: baseUrl,
            organization: null,
            project: null,
            maxRetries: 0,
            timeout: 3000,
            fetch: makeGuardedFetch(baseUrl, port),
            logLevel: "off",
        });
        await assert.rejects(
            client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "x" }] }),
            (err) => {
                assert.equal(err.status, statusCode);
                return true;
            }
        );
        assert.equal(hitCount, 1, `expected exactly one request for status ${statusCode}, maxRetries:0`);
        await closeAll(server);
    }
});

test("(5) constructing the client without an apiKey (and OPENAI_API_KEY unset) throws before any request", TEST_OPTS, async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    let hits = 0;
    const server = http.createServer((req, res) => {
        hits += 1;
        res.end("{}");
    });
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    try {
        assert.throws(() => {
            // eslint-disable-next-line no-new
            new OpenAI({
                baseURL: baseUrl,
                organization: null,
                project: null,
                maxRetries: 0,
                timeout: 3000,
                fetch: makeGuardedFetch(baseUrl, port),
                logLevel: "off",
            });
        });
    } finally {
        if (saved === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = saved;
    }
    assert.equal(hits, 0, "a missing apiKey must fail before any network request is attempted");
    await closeAll(server);
});
