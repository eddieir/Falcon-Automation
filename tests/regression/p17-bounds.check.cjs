/**
 * tests/regression/p17-bounds.check.cjs — Phase 17 retry/budget/concurrency
 * bound checks (ADR-0017 section 7, AC21/AC24).
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/p17-bounds.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const dns = require("node:dns");
const path = require("node:path");

const OpenAIProvider = require(path.join("..", "..", "src", "core", "llm", "providers", "OpenAIProvider.js"));
const RetryPolicy = require(path.join("..", "..", "src", "core", "llm", "RetryPolicy.js"));
const LlmBudget = require(path.join("..", "..", "src", "core", "llm", "LlmBudget.js"));
const Semaphore = require(path.join("..", "..", "src", "core", "llm", "Semaphore.js"));

const TEST_OPTS = { timeout: 8000 };

function listen(server) {
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function closeAll(...servers) {
    return Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
}

function chatPayload(content = "ok") {
    return {
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o-mini",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
}

function transportDeps() {
    return { lookup: dns.lookup, httpRequest: http.request, httpsRequest: require("node:https").request };
}

function baseConfig(overrides = {}) {
    return {
        provider: "openai",
        model: "gpt-4o-mini",
        timeoutMs: 1500,
        maxAttempts: 2,
        runBudget: 50,
        maxResponseBytes: 65536,
        concurrency: 2,
        apiKey: "test-key",
        ...overrides,
    };
}

function makeDeps(baseUrl, port, extra = {}) {
    return {
        baseUrl,
        policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [port] },
        transportDeps: transportDeps(),
        sleep: async () => {},
        ...extra,
    };
}

// --- RetryPolicy unit-level checks -----------------------------------------

test("RetryPolicy: retries RATE_LIMITED up to maxAttempts, backoff 500 then capped at 2000", TEST_OPTS, async () => {
    const delays = [];
    const sleep = async (ms) => {
        delays.push(ms);
    };
    let calls = 0;
    const outcome = await RetryPolicy.run(
        async () => {
            calls += 1;
            return { ok: false, errorCode: "RATE_LIMITED" };
        },
        { maxAttempts: 3, sleep },
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.errorCode, "RATE_LIMITED");
    assert.equal(calls, 3);
    assert.deepEqual(delays, [500, 1000]);
});

test("RetryPolicy: never retries AUTH_FAILED or BAD_REQUEST", TEST_OPTS, async () => {
    for (const code of ["AUTH_FAILED", "BAD_REQUEST", "CONFIG_INVALID"]) {
        let calls = 0;
        const outcome = await RetryPolicy.run(
            async () => {
                calls += 1;
                return { ok: false, errorCode: code };
            },
            { maxAttempts: 3, sleep: async () => {} },
        );
        assert.equal(calls, 1, `${code} must not be retried`);
        assert.equal(outcome.errorCode, code);
    }
});

test("RetryPolicy: Retry-After is clamped to 2000ms", TEST_OPTS, async () => {
    const delays = [];
    const outcome = await RetryPolicy.run(
        async () => ({ ok: false, errorCode: "RATE_LIMITED", retryAfterMs: 9000 }),
        { maxAttempts: 2, sleep: async (ms) => delays.push(ms) },
    );
    assert.equal(outcome.errorCode, "RATE_LIMITED");
    assert.deepEqual(delays, [2000]);
});

test("RetryPolicy + LlmBudget: budget counts attempts, returns BUDGET_EXHAUSTED with no further calls", TEST_OPTS, async () => {
    const budget = new LlmBudget(1);
    let calls = 0;
    const outcome = await RetryPolicy.run(
        async () => {
            calls += 1;
            return { ok: false, errorCode: "RATE_LIMITED" };
        },
        { maxAttempts: 3, sleep: async () => {}, budget },
    );
    assert.equal(calls, 1, "only the one budgeted attempt should have called attemptFn");
    assert.equal(outcome.errorCode, "BUDGET_EXHAUSTED");
    assert.equal(budget.remaining(), 0);
});

// --- Semaphore ---------------------------------------------------------------

test("Semaphore: size 1 serialises concurrent run() calls", TEST_OPTS, async () => {
    const sem = new Semaphore(1);
    let active = 0;
    let maxActive = 0;
    const task = async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
    };
    await Promise.all([sem.run(task), sem.run(task), sem.run(task)]);
    assert.equal(maxActive, 1);
});

// --- End-to-end: OpenAIProvider under continuous failure / concurrency -----

test("AC24: continuous 429 -> attempts == maxAttempts(2), mock sees exactly 2 requests, 400 never retried", TEST_OPTS, async () => {
    let hits429 = 0;
    const server429 = http.createServer((req, res) => {
        hits429 += 1;
        res.statusCode = 429;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "rate limited" } }));
    });
    const port429 = await listen(server429);
    const baseUrl429 = `http://127.0.0.1:${port429}/v1`;
    const provider429 = new OpenAIProvider(baseConfig({ maxAttempts: 2 }), makeDeps(baseUrl429, port429));
    const result429 = await provider429.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result429.ok, false);
    assert.equal(result429.errorCode, "RATE_LIMITED");
    assert.equal(result429.attempts, 2);
    assert.equal(hits429, 2);
    await closeAll(server429);

    let hits400 = 0;
    const server400 = http.createServer((req, res) => {
        hits400 += 1;
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "bad request" } }));
    });
    const port400 = await listen(server400);
    const baseUrl400 = `http://127.0.0.1:${port400}/v1`;
    const provider400 = new OpenAIProvider(baseConfig({ maxAttempts: 2 }), makeDeps(baseUrl400, port400));
    const result400 = await provider400.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result400.errorCode, "BAD_REQUEST");
    assert.equal(result400.attempts, 1);
    assert.equal(hits400, 1, "400 must never be retried");
    await closeAll(server400);
});

test("AC24: continuous 500 -> attempts == maxAttempts(2), budget exhaustion stops further requests", TEST_OPTS, async () => {
    let hits = 0;
    const server = http.createServer((req, res) => {
        hits += 1;
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "upstream" } }));
    });
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const budget = new LlmBudget(1);
    const provider = new OpenAIProvider(baseConfig({ maxAttempts: 2 }), makeDeps(baseUrl, port, { budget }));
    const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "BUDGET_EXHAUSTED");
    assert.equal(hits, 1, "the mock must see no extra request once the budget is exhausted");
    await closeAll(server);
});

test("AC21: two concurrent complete() calls each get their own result, mock sees exactly 2 requests", TEST_OPTS, async () => {
    let hits = 0;
    const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
            hits += 1;
            const body = JSON.parse(raw);
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(chatPayload(body.messages[0].content)));
        });
    });
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const provider = new OpenAIProvider(baseConfig({ concurrency: 2 }), makeDeps(baseUrl, port));

    const [a, b] = await Promise.all([
        provider.complete({ prompt: "alpha", maxOutputTokens: 10, temperature: 0 }),
        provider.complete({ prompt: "beta", maxOutputTokens: 10, temperature: 0 }),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.text, "alpha");
    assert.equal(b.text, "beta");
    assert.equal(hits, 2);
    await closeAll(server);
});

test("AC21: concurrency cap of 1 serialises two complete() calls on one provider instance", TEST_OPTS, async () => {
    let active = 0;
    let maxActive = 0;
    const server = http.createServer((req, res) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        setTimeout(() => {
            active -= 1;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(chatPayload("ok")));
        }, 30);
    });
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const provider = new OpenAIProvider(baseConfig({ concurrency: 1 }), makeDeps(baseUrl, port));

    await Promise.all([
        provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 }),
        provider.complete({ prompt: "y", maxOutputTokens: 10, temperature: 0 }),
    ]);
    assert.equal(maxActive, 1, "concurrency:1 must serialise requests through the semaphore");
    await closeAll(server);
});
