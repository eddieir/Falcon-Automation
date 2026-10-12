/**
 * tests/regression/p17-provider-contract.check.cjs — parameterized Phase 17
 * adapter contract (ADR-0017 section 4, AC09). `runAdapterContract(name,
 * makeProvider)` is run here for OpenAIProvider; a later Azure/compatible
 * provider adds one more call with the same body.
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/p17-provider-contract.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const dns = require("node:dns");
const path = require("node:path");

const OpenAIProvider = require(path.join("..", "..", "src", "core", "llm", "providers", "OpenAIProvider.js"));
const AzureOpenAIProvider = require(path.join("..", "..", "src", "core", "llm", "providers", "AzureOpenAIProvider.js"));
const OpenAICompatibleProvider = require(path.join("..", "..", "src", "core", "llm", "providers", "OpenAICompatibleProvider.js"));
const LlmProviderRegistry = require(path.join("..", "..", "src", "core", "llm", "LlmProviderRegistry.js"));

const TEST_OPTS = { timeout: 8000 };
const SECRET_KEY = "FALCONMARKKEY-contract";

function listen(server) {
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function closeAll(...servers) {
    return Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
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
        apiKey: SECRET_KEY,
        ...overrides,
    };
}

function chatPayload(content = "hello") {
    return {
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o-mini",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    };
}

function transportDeps() {
    return { lookup: dns.lookup, httpRequest: http.request, httpsRequest: require("node:https").request };
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

/**
 * @param {string} name - provider label, used only in test titles.
 * @param {function(config, deps): Object} makeProvider - builds the provider
 *   instance under test from a config and deps seam.
 */
function runAdapterContract(name, makeProvider) {
    test(`(${name}) request shape: model/messages/max_tokens/temperature, Bearer auth`, TEST_OPTS, async () => {
        let seenHeaders = null;
        let seenBody = null;
        const server = http.createServer((req, res) => {
            let raw = "";
            req.on("data", (c) => (raw += c));
            req.on("end", () => {
                seenHeaders = req.headers;
                seenBody = JSON.parse(raw);
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify(chatPayload("42")));
            });
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(baseConfig(), makeDeps(baseUrl, port));

        const result = await provider.complete({ prompt: "pick", maxOutputTokens: 80, temperature: 0 });

        assert.equal(result.ok, true);
        assert.equal(result.text, "42");
        assert.equal(seenBody.model, "gpt-4o-mini");
        assert.deepEqual(seenBody.messages, [{ role: "user", content: "pick" }]);
        assert.equal(seenBody.max_tokens, 80);
        assert.equal(seenBody.temperature, 0);
        assert.equal(seenHeaders.authorization, `Bearer ${SECRET_KEY}`);

        await closeAll(server);
    });

    test(`(${name}) 200 parse: text unchanged for a numeric-looking reply (healer owns parsing)`, TEST_OPTS, async () => {
        const server = http.createServer((req, res) => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(chatPayload("3")));
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(baseConfig(), makeDeps(baseUrl, port));
        const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, true);
        assert.equal(result.text, "3");
        assert.equal(typeof result.text, "string");
        await closeAll(server);
    });

    test(`(${name}) AC09 fixture: 401 -> AUTH_FAILED, never retried`, TEST_OPTS, async () => {
        let hits = 0;
        const server = http.createServer((req, res) => {
            hits += 1;
            res.statusCode = 401;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: { message: `bad key ${SECRET_KEY}` } }));
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(baseConfig(), makeDeps(baseUrl, port));
        const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "AUTH_FAILED");
        assert.equal(result.attempts, 1);
        assert.equal(hits, 1);
        assert.equal(JSON.stringify(result).includes(SECRET_KEY), false);
        await closeAll(server);
    });

    test(`(${name}) AC09 fixture: 429 -> RATE_LIMITED`, TEST_OPTS, async () => {
        const server = http.createServer((req, res) => {
            res.statusCode = 429;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: { message: "rate limited" } }));
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(baseConfig({ maxAttempts: 1 }), makeDeps(baseUrl, port));
        const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "RATE_LIMITED");
        await closeAll(server);
    });

    test(`(${name}) AC09 fixture: timeout -> TIMEOUT`, TEST_OPTS, async () => {
        const server = http.createServer((req) => {
            req.on("data", () => {});
            // never responds
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(baseConfig({ timeoutMs: 300, maxAttempts: 1 }), makeDeps(baseUrl, port));
        const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "TIMEOUT");
        await closeAll(server);
    });

    test(`(${name}) AC09 fixture: connection reset -> NETWORK_ERROR`, TEST_OPTS, async () => {
        const server = http.createServer((req, res) => {
            req.destroy();
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(baseConfig({ maxAttempts: 1 }), makeDeps(baseUrl, port));
        const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "NETWORK_ERROR");
        await closeAll(server);
    });

    test(`(${name}) AC09 fixture: malformed JSON body -> MALFORMED_RESPONSE`, TEST_OPTS, async () => {
        const server = http.createServer((req, res) => {
            res.setHeader("content-type", "application/json");
            res.end("{not json");
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(baseConfig({ maxAttempts: 1 }), makeDeps(baseUrl, port));
        const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "MALFORMED_RESPONSE");
        await closeAll(server);
    });

    test(`(${name}) AC09 fixture: missing choices -> MALFORMED_RESPONSE`, TEST_OPTS, async () => {
        const server = http.createServer((req, res) => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ id: "x", object: "chat.completion", model: "gpt-4o-mini", choices: [] }));
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(baseConfig({ maxAttempts: 1 }), makeDeps(baseUrl, port));
        const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "MALFORMED_RESPONSE");
        await closeAll(server);
    });

    test(`(${name}) AC09 fixture: oversized response -> OVERSIZED`, TEST_OPTS, async () => {
        const server = http.createServer((req, res) => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(chatPayload("x".repeat(5000))));
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(
            baseConfig({ maxAttempts: 1, maxResponseBytes: 4096 }),
            makeDeps(baseUrl, port),
        );
        const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "OVERSIZED");
        await closeAll(server);
    });

    test(`(${name}) AC09 fixture: unsupported provider id rejected by the registry`, TEST_OPTS, () => {
        assert.throws(() => LlmProviderRegistry.resolve({ provider: "not-a-real-provider" }), /no provider wired in/);
    });

    test(`(${name}) secret never leaks into the result on a 4xx with a planted body marker`, TEST_OPTS, async () => {
        const server = http.createServer((req, res) => {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: { message: `bad request marker ${SECRET_KEY}` } }));
        });
        const port = await listen(server);
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const provider = makeProvider(baseConfig({ maxAttempts: 1 }), makeDeps(baseUrl, port));
        const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "BAD_REQUEST");
        assert.equal(JSON.stringify(result).includes(SECRET_KEY), false);
        await closeAll(server);
    });
}

runAdapterContract("OpenAIProvider", (config, deps) => new OpenAIProvider(config, deps));

// Dev-02b: the shared fixtures reuse `config.model`/`seenBody.model ===
// "gpt-4o-mini"` as the wire-level model assertion — for Azure the wire
// value is the *deployment name*, so azureDeployment is set from the same
// fixture field and azureResource/azureHostSuffix are fixed, valid values.
runAdapterContract(
    "AzureOpenAIProvider",
    (config, deps) =>
        new AzureOpenAIProvider(
            { ...config, azureDeployment: config.model, azureResource: "res", azureHostSuffix: "openai.azure.com" },
            deps,
        ),
);

// Dev-02b: openai-compatible only runs opted in; the harness' injected
// loopback deps.baseUrl stands in for the operator-configured endpoint.
runAdapterContract(
    "OpenAICompatibleProvider",
    (config, deps) =>
        new OpenAICompatibleProvider(
            { ...config, allowCustomEndpoint: true, allowHttpLoopback: true, endpoint: deps.baseUrl },
            deps,
        ),
);

test("(AzureOpenAIProvider) AC03/AC20: path is /openai/v1/chat/completions, body.model is the deployment, Bearer auth, no api-version", TEST_OPTS, async () => {
    let seenUrl = null;
    let seenHeaders = null;
    let seenBody = null;
    const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
            seenUrl = req.url;
            seenHeaders = req.headers;
            seenBody = JSON.parse(raw);
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(chatPayload("azure-ok")));
        });
    });
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/openai/v1`;
    const provider = new AzureOpenAIProvider(
        baseConfig({ azureDeployment: "my-deployment", azureResource: "res", azureHostSuffix: "openai.azure.com" }),
        makeDeps(baseUrl, port),
    );

    const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });

    assert.equal(result.ok, true);
    const [pathOnly, query] = seenUrl.split("?");
    assert.equal(pathOnly, "/openai/v1/chat/completions");
    assert.equal(query, undefined);
    assert.equal(seenBody.model, "my-deployment");
    assert.equal(seenHeaders.authorization, `Bearer ${SECRET_KEY}`);
    assert.equal(seenHeaders["api-key"], undefined);
    await closeAll(server);
});

module.exports = { runAdapterContract };
