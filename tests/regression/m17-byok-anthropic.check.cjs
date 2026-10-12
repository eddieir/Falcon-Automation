/**
 * tests/regression/m17-byok-anthropic.check.cjs — WP3 AnthropicProvider
 * contract tests (ADR-0019 WP3). Deterministic local mocks only: the real
 * guardedFetch fixed-host transport is exercised via injected
 * dns.lookup/https.request spies (same convention as
 * m17-byok-transport.check.cjs) — no real network, no sleeps for
 * concurrency.
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/m17-byok-anthropic.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const AnthropicProvider = require("../../src/core/llm/providers/AnthropicProvider");

const GOOD_KEY = "FAKEMARKER_anthropic_key_abc123";

function baseConfig(overrides = {}) {
    return {
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        apiKey: GOOD_KEY,
        maxOutputTokens: 256,
        runBudget: 10,
        concurrency: 2,
        maxAttempts: 3,
        timeoutMs: 3000,
        maxResponseBytes: 65536,
        ...overrides,
    };
}

function makeSpyRequest(respond, { captureBody } = {}) {
    const req = new EventEmitter();
    let body = "";
    req.write = (chunk) => {
        body += chunk;
    };
    req.destroy = () => {};
    req.end = () => {
        if (captureBody) captureBody(body);
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

function noSleep(_ms) {
    return Promise.resolve();
}

function makeHttpsSpy({ statusCode = 200, headers, body = "{}", onRequest } = {}) {
    const calls = [];
    const httpsRequestSpy = (options, callback) => {
        let capturedBody = null;
        const req = makeSpyRequest(okResponder(callback, { statusCode, headers, body }), {
            captureBody: (b) => {
                capturedBody = b;
            },
        });
        const record = { options, get body() { return capturedBody; } };
        calls.push(record);
        if (onRequest) onRequest(record);
        return req;
    };
    return { httpsRequestSpy, calls };
}

function makeDeps({ statusCode, headers, body, onRequest, budget, semaphore } = {}) {
    const { httpsRequestSpy, calls } = makeHttpsSpy({ statusCode, headers, body, onRequest });
    return {
        deps: {
            sleep: noSleep,
            budget,
            semaphore,
            transportDeps: {
                lookup: (_h, _o, cb) => cb(null, [{ address: "203.0.113.9", family: 4 }]),
                httpsRequest: httpsRequestSpy,
            },
        },
        calls,
    };
}

const TEST_OPTS = { timeout: 8000 };

test("success: exact request shape, text extracted, usage mapped", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({
        body: JSON.stringify({
            content: [{ type: "text", text: "hello from claude" }],
            usage: { input_tokens: 11, output_tokens: 3 },
        }),
    });
    const provider = new AnthropicProvider(baseConfig(), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 256, temperature: 0 });

    assert.equal(result.ok, true);
    assert.equal(result.text, "hello from claude");
    assert.equal(result.provider, "anthropic");
    assert.equal(result.modelLabel, "claude-3-5-sonnet");
    assert.deepEqual(result.usage, { promptTokens: 11, completionTokens: 3 });
    assert.equal(result.attempts, 1);

    assert.equal(calls.length, 1);
    const { options, body } = calls[0];
    assert.equal(options.method, "POST");
    assert.equal(options.path, "/v1/messages");
    assert.equal(options.hostname, "api.anthropic.com");

    // AC16 data minimisation: exact header name set, no extras.
    const headerNames = Object.keys(options.headers).sort();
    assert.deepEqual(headerNames, ["accept-encoding", "anthropic-version", "content-type", "host", "x-api-key"]);
    assert.equal(options.headers["x-api-key"], GOOD_KEY);
    assert.equal(options.headers["anthropic-version"], "2023-06-01");
    assert.equal(options.headers["content-type"], "application/json");

    // exact body key set.
    const parsedBody = JSON.parse(body);
    assert.deepEqual(Object.keys(parsedBody).sort(), ["max_tokens", "messages", "model"]);
    assert.equal(parsedBody.model, "claude-3-5-sonnet");
    assert.equal(parsedBody.max_tokens, 256);
    assert.deepEqual(parsedBody.messages, [{ role: "user", content: "hi" }]);
});

test("AC04/AC09: an arbitrary valid model id is sent verbatim", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({ body: JSON.stringify({ content: [{ type: "text", text: "ok" }] }) });
    const provider = new AnthropicProvider(baseConfig({ model: "claude-future-9" }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, true);
    const parsedBody = JSON.parse(calls[0].body);
    assert.equal(parsedBody.model, "claude-future-9");
});

test("401/403 => AUTH_FAILED, 1 attempt", TEST_OPTS, async () => {
    for (const statusCode of [401, 403]) {
        const { deps, calls } = makeDeps({ statusCode, body: JSON.stringify({ error: { message: "nope" } }) });
        const provider = new AnthropicProvider(baseConfig(), deps);
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "AUTH_FAILED");
        assert.equal(result.attempts, 1);
        assert.equal(result.retryable, false);
        assert.equal(calls.length, 1);
    }
});

test("N10: 400 BAD_REQUEST never retried (exactly 1 attempt)", TEST_OPTS, async () => {
    const MARKER = "FAKEMARKER_errbody_9x1";
    const { deps, calls } = makeDeps({ statusCode: 400, body: JSON.stringify({ error: { message: `bad ${MARKER}` } }) });
    const provider = new AnthropicProvider(baseConfig({ maxAttempts: 3 }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "BAD_REQUEST");
    assert.equal(result.attempts, 1);
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(result).includes(MARKER), false);
});

test("404/413/422 => BAD_REQUEST, never retried", TEST_OPTS, async () => {
    for (const statusCode of [404, 413, 422]) {
        const { deps, calls } = makeDeps({ statusCode, body: "{}" });
        const provider = new AnthropicProvider(baseConfig({ maxAttempts: 3 }), deps);
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.errorCode, "BAD_REQUEST");
        assert.equal(calls.length, 1);
    }
});

test("429 RATE_LIMITED retried up to maxAttempts, then surfaced", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({ statusCode: 429, headers: { "content-type": "application/json", "retry-after": "0" } });
    const provider = new AnthropicProvider(baseConfig({ maxAttempts: 3 }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "RATE_LIMITED");
    assert.equal(result.attempts, 3);
    assert.equal(calls.length, 3);
    assert.equal(result.retryable, true);
});

test("504 => TIMEOUT; 500/529 => PROVIDER_ERROR", TEST_OPTS, async () => {
    for (const [statusCode, expected] of [[504, "TIMEOUT"], [500, "PROVIDER_ERROR"], [529, "PROVIDER_ERROR"]]) {
        const { deps } = makeDeps({ statusCode, body: "{}" });
        const provider = new AnthropicProvider(baseConfig({ maxAttempts: 1 }), deps);
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.errorCode, expected);
    }
});

test("N10: max_tokens stop_reason with only a thinking block (no text) => MALFORMED_RESPONSE", TEST_OPTS, async () => {
    const { deps } = makeDeps({
        body: JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "..." }] }),
    });
    const provider = new AnthropicProvider(baseConfig(), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "MALFORMED_RESPONSE");
});

test("invalid JSON body => MALFORMED_RESPONSE", TEST_OPTS, async () => {
    const { deps } = makeDeps({ body: "{not json" });
    const provider = new AnthropicProvider(baseConfig(), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "MALFORMED_RESPONSE");
});

test("oversized response => OVERSIZED, zero retries (not retryable)", TEST_OPTS, async () => {
    const { deps } = makeDeps({ body: "x".repeat(200000) });
    const provider = new AnthropicProvider(baseConfig({ maxResponseBytes: 1024, maxAttempts: 3 }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "OVERSIZED");
    assert.equal(result.attempts, 1);
});

test("timeout => TIMEOUT via guardedFetch transport", TEST_OPTS, async () => {
    const httpsRequestSpy = () => {
        const req = new EventEmitter();
        req.write = () => {};
        req.destroy = () => {};
        req.end = () => {};
        return req;
    };
    const provider = new AnthropicProvider(baseConfig({ timeoutMs: 50, maxAttempts: 1 }), {
        sleep: noSleep,
        transportDeps: {
            lookup: (_h, _o, cb) => cb(null, [{ address: "203.0.113.9", family: 4 }]),
            httpsRequest: httpsRequestSpy,
        },
    });
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "TIMEOUT");
});

test("redirect 30x is rejected, surfaced as REDIRECT_REJECTED (not retried)", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({
        statusCode: 302,
        headers: { location: "https://evil.example.com/steal" },
        body: "redirecting",
    });
    const provider = new AnthropicProvider(baseConfig({ maxAttempts: 3 }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "REDIRECT_REJECTED");
    assert.equal(calls.length, 1);
});

test("error body marker and api key marker never appear in the result or thrown messages", TEST_OPTS, async () => {
    const BODY_MARKER = "FAKEMARKER_body_leak_7z";
    const KEY_MARKER = "FAKEMARKER_key_leak_9q";
    const { deps } = makeDeps({ statusCode: 400, body: JSON.stringify({ error: { message: BODY_MARKER } }) });
    const provider = new AnthropicProvider(baseConfig({ apiKey: KEY_MARKER }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(BODY_MARKER), false);
    assert.equal(serialized.includes(KEY_MARKER), false);
});

test("apiKey is read lazily: a getter is untouched before complete(), read at most once per attempt", TEST_OPTS, async () => {
    let reads = 0;
    const config = baseConfig({ maxAttempts: 2 });
    Object.defineProperty(config, "apiKey", {
        get() {
            reads += 1;
            return GOOD_KEY;
        },
        enumerable: true,
    });
    const { deps } = makeDeps({ statusCode: 429, headers: { "content-type": "application/json", "retry-after": "0" } });
    const provider = new AnthropicProvider(config, deps);
    assert.equal(reads, 0, "constructing the provider must not read apiKey");
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.attempts, 2);
    assert.ok(reads >= 1 && reads <= 2, `expected 1 read per attempt (max 2), got ${reads}`);
});

test("invalid credential shape (CR/LF) => CONFIG_INVALID, zero connections", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({});
    const provider = new AnthropicProvider(baseConfig({ apiKey: "bad\r\nvalue" }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assert.equal(calls.length, 0);
});

test("BUDGET_EXHAUSTED: canSend() false and a zero-budget complete() make zero requests", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({});
    const provider = new AnthropicProvider(baseConfig({ runBudget: 0 }), deps);
    assert.deepEqual(provider.canSend(), { ok: false, errorCode: "BUDGET_EXHAUSTED" });
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "BUDGET_EXHAUSTED");
    assert.equal(calls.length, 0);
});
