/**
 * tests/regression/m17-byok-gemini.check.cjs — WP3 GeminiProvider contract
 * tests (ADR-0019 WP3, coordinator condition C1). Deterministic local
 * mocks only: the real guardedFetch fixed-host transport is exercised via
 * injected dns.lookup/https.request spies — no real network, no sleeps for
 * concurrency.
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/m17-byok-gemini.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const GeminiProvider = require("../../src/core/llm/providers/GeminiProvider");

const GOOD_KEY = "FAKEMARKER_gemini_key_abc123";

function baseConfig(overrides = {}) {
    return {
        provider: "gemini",
        model: "gemini-1.5-flash",
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

function makeHttpsSpy({ statusCode = 200, headers, body = "{}" } = {}) {
    const calls = [];
    const httpsRequestSpy = (options, callback) => {
        let capturedBody = null;
        const req = makeSpyRequest(okResponder(callback, { statusCode, headers, body }), {
            captureBody: (b) => {
                capturedBody = b;
            },
        });
        calls.push({ options, get body() { return capturedBody; } });
        return req;
    };
    return { httpsRequestSpy, calls };
}

function makeDeps({ statusCode, headers, body } = {}) {
    const { httpsRequestSpy, calls } = makeHttpsSpy({ statusCode, headers, body });
    return {
        deps: {
            sleep: noSleep,
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
            candidates: [{ content: { parts: [{ text: "hello from gemini" }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 },
        }),
    });
    const provider = new GeminiProvider(baseConfig(), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 256, temperature: 0 });

    assert.equal(result.ok, true);
    assert.equal(result.text, "hello from gemini");
    assert.equal(result.provider, "gemini");
    assert.equal(result.modelLabel, "gemini-1.5-flash");
    assert.deepEqual(result.usage, { promptTokens: 7, completionTokens: 2 });

    assert.equal(calls.length, 1);
    const { options, body } = calls[0];
    assert.equal(options.method, "POST");
    assert.equal(options.path, "/v1beta/models/gemini-1.5-flash:generateContent");
    assert.equal(options.hostname, "generativelanguage.googleapis.com");

    const headerNames = Object.keys(options.headers).sort();
    assert.deepEqual(headerNames, ["accept-encoding", "content-type", "host", "x-goog-api-key"]);
    assert.equal(options.headers["x-goog-api-key"], GOOD_KEY);
    assert.ok(!("key" in options.headers));

    const parsedBody = JSON.parse(body);
    assert.deepEqual(Object.keys(parsedBody).sort(), ["contents", "generationConfig"]);
    assert.deepEqual(parsedBody.contents, [{ role: "user", parts: [{ text: "hi" }] }]);
    assert.deepEqual(parsedBody.generationConfig, { maxOutputTokens: 256, temperature: 0 });
});

test("AC06/AC09: an arbitrary valid model id is sent verbatim in the path", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    });
    const provider = new GeminiProvider(baseConfig({ model: "gemini-future-9.9" }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, true);
    assert.equal(calls[0].options.path, "/v1beta/models/gemini-future-9.9:generateContent");
});

test("C1: path-traversal / malicious model ids => CONFIG_INVALID with zero requests", TEST_OPTS, async () => {
    for (const model of ["../x", "a/b", "models/x", "a:b", "%2e%2e"]) {
        const { deps, calls } = makeDeps({});
        const provider = new GeminiProvider(baseConfig({ model }), deps);
        assert.deepEqual(provider.canSend(), { ok: false, errorCode: "CONFIG_INVALID" });
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.errorCode, "CONFIG_INVALID");
        assert.equal(result.attempts, 0);
        assert.equal(calls.length, 0, `expected zero requests for model ${model}`);
    }
});

test("N11: promptFeedback.blockReason => CONTENT_BLOCKED, never an empty success", TEST_OPTS, async () => {
    const { deps } = makeDeps({
        body: JSON.stringify({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }),
    });
    const provider = new GeminiProvider(baseConfig(), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONTENT_BLOCKED");
});

test("N11: blocked finishReason variants => CONTENT_BLOCKED even when text is present", TEST_OPTS, async () => {
    for (const finishReason of ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "RECITATION", "IMAGE_SAFETY"]) {
        const { deps } = makeDeps({
            body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "partial" }] }, finishReason }] }),
        });
        const provider = new GeminiProvider(baseConfig(), deps);
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false, `finishReason ${finishReason} must not be a success`);
        assert.equal(result.errorCode, "CONTENT_BLOCKED");
    }
});

test("no text in candidate => MALFORMED_RESPONSE", TEST_OPTS, async () => {
    const { deps } = makeDeps({ body: JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }) });
    const provider = new GeminiProvider(baseConfig(), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "MALFORMED_RESPONSE");
});

test("401/403 => AUTH_FAILED; 400/404/413/422 => BAD_REQUEST not retried; 429 retried bounded; 504 TIMEOUT; 5xx PROVIDER_ERROR", TEST_OPTS, async () => {
    for (const statusCode of [401, 403]) {
        const { deps, calls } = makeDeps({ statusCode });
        const provider = new GeminiProvider(baseConfig(), deps);
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.errorCode, "AUTH_FAILED");
        assert.equal(calls.length, 1);
    }
    for (const statusCode of [400, 404, 413, 422]) {
        const { deps, calls } = makeDeps({ statusCode });
        const provider = new GeminiProvider(baseConfig({ maxAttempts: 3 }), deps);
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.errorCode, "BAD_REQUEST");
        assert.equal(calls.length, 1);
    }
    {
        const { deps, calls } = makeDeps({ statusCode: 429, headers: { "content-type": "application/json", "retry-after": "0" } });
        const provider = new GeminiProvider(baseConfig({ maxAttempts: 3 }), deps);
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.errorCode, "RATE_LIMITED");
        assert.equal(calls.length, 3);
    }
    {
        const { deps } = makeDeps({ statusCode: 504 });
        const provider = new GeminiProvider(baseConfig(), deps);
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.errorCode, "TIMEOUT");
    }
    for (const statusCode of [500, 503]) {
        const { deps } = makeDeps({ statusCode });
        const provider = new GeminiProvider(baseConfig(), deps);
        const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.errorCode, "PROVIDER_ERROR");
    }
});

test("invalid JSON body => MALFORMED_RESPONSE", TEST_OPTS, async () => {
    const { deps } = makeDeps({ body: "not json{" });
    const provider = new GeminiProvider(baseConfig(), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "MALFORMED_RESPONSE");
});

test("oversized response => OVERSIZED", TEST_OPTS, async () => {
    const { deps } = makeDeps({ body: "x".repeat(200000) });
    const provider = new GeminiProvider(baseConfig({ maxResponseBytes: 1024 }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "OVERSIZED");
});

test("timeout => TIMEOUT via guardedFetch transport", TEST_OPTS, async () => {
    const httpsRequestSpy = () => {
        const req = new EventEmitter();
        req.write = () => {};
        req.destroy = () => {};
        req.end = () => {};
        return req;
    };
    const provider = new GeminiProvider(baseConfig({ timeoutMs: 50, maxAttempts: 1 }), {
        sleep: noSleep,
        transportDeps: {
            lookup: (_h, _o, cb) => cb(null, [{ address: "203.0.113.9", family: 4 }]),
            httpsRequest: httpsRequestSpy,
        },
    });
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "TIMEOUT");
});

test("redirect 30x rejected", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({ statusCode: 302, headers: { location: "https://evil.example.com/steal" } });
    const provider = new GeminiProvider(baseConfig({ maxAttempts: 3 }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "REDIRECT_REJECTED");
    assert.equal(calls.length, 1);
});

test("error body marker and api key marker never appear in the result", TEST_OPTS, async () => {
    const BODY_MARKER = "FAKEMARKER_body_leak_gm1";
    const KEY_MARKER = "FAKEMARKER_key_leak_gm2";
    const { deps } = makeDeps({ statusCode: 400, body: JSON.stringify({ error: { message: BODY_MARKER } }) });
    const provider = new GeminiProvider(baseConfig({ apiKey: KEY_MARKER }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(BODY_MARKER), false);
    assert.equal(serialized.includes(KEY_MARKER), false);
});

test("apiKey read lazily: untouched before complete(), bounded per attempt", TEST_OPTS, async () => {
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
    const provider = new GeminiProvider(config, deps);
    assert.equal(reads, 0);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.attempts, 2);
    assert.ok(reads >= 1 && reads <= 2);
});

test("invalid credential shape (CR/LF) => CONFIG_INVALID, zero connections", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({});
    const provider = new GeminiProvider(baseConfig({ apiKey: "bad\r\nvalue" }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assert.equal(calls.length, 0);
});

test("BUDGET_EXHAUSTED: zero-budget complete() makes zero requests", TEST_OPTS, async () => {
    const { deps, calls } = makeDeps({});
    const provider = new GeminiProvider(baseConfig({ runBudget: 0 }), deps);
    const result = await provider.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.errorCode, "BUDGET_EXHAUSTED");
    assert.equal(calls.length, 0);
});

test("AC10: a provider failure never triggers the other provider or another endpoint", TEST_OPTS, async () => {
    const AnthropicProvider = require("../../src/core/llm/providers/AnthropicProvider");
    const { deps: geminiDeps, calls: geminiCalls } = makeDeps({ statusCode: 500 });
    const { httpsRequestSpy: anthropicSpy, calls: anthropicCalls } = makeHttpsSpy({ statusCode: 200, body: "{}" });

    const gemini = new GeminiProvider(baseConfig({ maxAttempts: 1 }), geminiDeps);
    const anthropic = new AnthropicProvider(
        { provider: "anthropic", model: "claude-3-5-sonnet", apiKey: "k", maxOutputTokens: 10, runBudget: 10, concurrency: 2, maxAttempts: 1, timeoutMs: 3000, maxResponseBytes: 65536 },
        {
            sleep: noSleep,
            transportDeps: {
                lookup: (_h, _o, cb) => cb(null, [{ address: "203.0.113.9", family: 4 }]),
                httpsRequest: anthropicSpy,
            },
        },
    );

    const result = await gemini.complete({ prompt: "hi", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.equal(geminiCalls.length, 1);
    assert.equal(anthropicCalls.length, 0, "the sibling provider must receive zero requests on this provider's failure");
});
