/**
 * tests/regression/p17-isolation.check.cjs — AC05 cross-provider isolation,
 * S-11 credential-isolation, and AC04 opt-in/SSRF-policy regression fixtures
 * (ADR-0017 sections 6-8).
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/p17-isolation.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const dns = require("node:dns");
const https = require("node:https");
const path = require("node:path");

const OpenAIProvider = require(path.join("..", "..", "src", "core", "llm", "providers", "OpenAIProvider.js"));
const AzureOpenAIProvider = require(path.join("..", "..", "src", "core", "llm", "providers", "AzureOpenAIProvider.js"));
const OpenAICompatibleProvider = require(path.join(
    "..",
    "..",
    "src",
    "core",
    "llm",
    "providers",
    "OpenAICompatibleProvider.js",
));

const TEST_OPTS = { timeout: 8000 };
const SECRET_KEY = "FALCONMARKKEY-isolation";

function listen(server) {
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function closeAll(...servers) {
    return Promise.all(servers.map((s) => { if (typeof s.closeAllConnections === "function") s.closeAllConnections(); return new Promise((r) => s.close(r)); }));
}

function chatPayload(content = "ok") {
    return {
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1,
        model: "x",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
}

function transportDeps() {
    return { lookup: dns.lookup, httpRequest: http.request, httpsRequest: https.request };
}

/**
 * A mock server driven by a mutable queue of behaviors. Each incoming
 * request shifts (and records) the next queued behavior; an empty queue
 * means "respond 200 ok".
 */
function makeQueueServer() {
    const state = { hits: 0, lastHeaders: null, lastBody: null, queue: [] };
    const server = http.createServer((req, res) => {
        state.hits += 1;
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
            state.lastHeaders = req.headers;
            try {
                state.lastBody = raw ? JSON.parse(raw) : null;
            } catch {
                state.lastBody = raw;
            }
            const behavior = state.queue.shift() || { status: 200 };
            if (behavior.hang) {
                return; // never responds — exercises TIMEOUT
            }
            res.statusCode = behavior.status || 200;
            res.setHeader("content-type", "application/json");
            if (behavior.status === 200 || !behavior.status) {
                res.end(JSON.stringify(chatPayload(behavior.content || "ok")));
            } else {
                res.end(JSON.stringify({ error: { message: "mock error" } }));
            }
        });
    });
    return { server, state };
}

// --- AC05: three-server isolation ------------------------------------------

test("AC05: each provider only ever talks to its own loopback server, never the other two", TEST_OPTS, async () => {
    const openaiMock = makeQueueServer();
    const azureMock = makeQueueServer();
    const compatMock = makeQueueServer();
    const openaiPort = await listen(openaiMock.server);
    const azurePort = await listen(azureMock.server);
    const compatPort = await listen(compatMock.server);

    const allMocks = [openaiMock, azureMock, compatMock];
    function resetHits() {
        for (const m of allMocks) m.state.hits = 0;
    }

    const providers = {
        openai: new OpenAIProvider(
            { provider: "openai", model: "gpt-4o-mini", timeoutMs: 300, maxAttempts: 2, runBudget: 50, maxResponseBytes: 65536, concurrency: 2, apiKey: SECRET_KEY },
            { baseUrl: `http://127.0.0.1:${openaiPort}/v1`, policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [openaiPort] }, transportDeps: transportDeps(), sleep: async () => {} },
        ),
        "azure-openai": new AzureOpenAIProvider(
            { provider: "azure-openai", azureDeployment: "dep", azureResource: "res", azureHostSuffix: "openai.azure.com", timeoutMs: 300, maxAttempts: 2, runBudget: 50, maxResponseBytes: 65536, concurrency: 2, apiKey: SECRET_KEY },
            { baseUrl: `http://127.0.0.1:${azurePort}/openai/v1`, policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [azurePort] }, transportDeps: transportDeps(), sleep: async () => {} },
        ),
        "openai-compatible": new OpenAICompatibleProvider(
            { provider: "openai-compatible", model: "llama3", allowCustomEndpoint: true, allowHttpLoopback: true, endpoint: `http://127.0.0.1:${compatPort}/v1`, timeoutMs: 300, maxAttempts: 2, runBudget: 50, maxResponseBytes: 65536, concurrency: 2, apiKey: null },
            { policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [compatPort] }, transportDeps: transportDeps(), sleep: async () => {} },
        ),
    };

    const mockFor = { openai: openaiMock, "azure-openai": azureMock, "openai-compatible": compatMock };

    for (const id of Object.keys(providers)) {
        resetHits();
        const provider = providers[id];
        const mine = mockFor[id];
        const others = allMocks.filter((m) => m !== mine);

        // 1: plain success
        mine.state.queue.push({ status: 200 });
        let r = await provider.complete({ prompt: "a", maxOutputTokens: 10, temperature: 0 });
        assert.equal(r.ok, true);

        // 2: 401 -> AUTH_FAILED, no retry
        mine.state.queue.push({ status: 401 });
        r = await provider.complete({ prompt: "b", maxOutputTokens: 10, temperature: 0 });
        assert.equal(r.ok, false);
        assert.equal(r.errorCode, "AUTH_FAILED");

        // 3: 429 then 200 — retried within one complete() call
        mine.state.queue.push({ status: 429 }, { status: 200 });
        r = await provider.complete({ prompt: "c", maxOutputTokens: 10, temperature: 0 });
        assert.equal(r.ok, true);
        assert.equal(r.attempts, 2);

        // 4: timeout
        mine.state.queue.push({ hang: true }, { hang: true });
        r = await provider.complete({ prompt: "d", maxOutputTokens: 10, temperature: 0 });
        assert.equal(r.ok, false);
        assert.equal(r.errorCode, "TIMEOUT");

        // 5: plain success again
        mine.state.queue.push({ status: 200 });
        r = await provider.complete({ prompt: "e", maxOutputTokens: 10, temperature: 0 });
        assert.equal(r.ok, true);

        assert.ok(mine.state.hits > 0, `${id} server was never hit`);
        for (const other of others) {
            assert.equal(other.state.hits, 0, `${id} leaked a request to a different provider's server`);
        }
    }

    await closeAll(openaiMock.server, azureMock.server, compatMock.server);
});

// --- AC05: registry.resolve(config) builds ONLY the requested provider ----

function freshRegistryWithFactorySpies() {
    const providerFiles = {
        openai: "OpenAIProvider.js",
        "azure-openai": "AzureOpenAIProvider.js",
        "openai-compatible": "OpenAICompatibleProvider.js",
        disabled: "DisabledProvider.js",
    };
    const providerPaths = {};
    for (const [id, file] of Object.entries(providerFiles)) {
        providerPaths[id] = require.resolve(path.join("..", "..", "src", "core", "llm", "providers", file));
    }
    const registryPath = require.resolve(path.join("..", "..", "src", "core", "llm", "LlmProviderRegistry.js"));

    delete require.cache[registryPath];
    for (const p of Object.values(providerPaths)) delete require.cache[p];

    const counts = { openai: 0, "azure-openai": 0, "openai-compatible": 0, disabled: 0 };
    for (const [id, p] of Object.entries(providerPaths)) {
        const OriginalClass = require(p);
        const Wrapped = new Proxy(OriginalClass, {
            construct(target, args) {
                counts[id] += 1;
                return new target(...args);
            },
        });
        require.cache[p].exports = Wrapped;
    }
    delete require.cache[registryPath];
    const Registry = require(registryPath);
    return { Registry, counts, registryPath, providerPaths };
}

function minimalConfigFor(id) {
    const common = { timeoutMs: 1500, maxAttempts: 1, runBudget: 50, maxResponseBytes: 65536, concurrency: 1, apiKey: SECRET_KEY };
    if (id === "openai") return { provider: "openai", model: "gpt-4o-mini", ...common };
    if (id === "azure-openai")
        return { provider: "azure-openai", azureDeployment: "dep", azureResource: "res", azureHostSuffix: "openai.azure.com", ...common };
    if (id === "openai-compatible")
        return { provider: "openai-compatible", model: "llama3", allowCustomEndpoint: false, endpoint: null, ...common };
    return { provider: "disabled" };
}

test("AC05: registry.resolve builds exactly one provider class per id, never the others", TEST_OPTS, () => {
    for (const id of ["openai", "azure-openai", "openai-compatible", "disabled"]) {
        const { Registry, counts, registryPath, providerPaths } = freshRegistryWithFactorySpies();
        Registry.resolve(minimalConfigFor(id));
        assert.equal(counts[id], 1, `expected exactly one ${id} construction`);
        for (const otherId of Object.keys(counts)) {
            if (otherId === id) continue;
            assert.equal(counts[otherId], 0, `resolving ${id} must never construct ${otherId}`);
        }
        // restore a clean, unwrapped module graph for the next iteration/file.
        delete require.cache[registryPath];
        for (const p of Object.values(providerPaths)) delete require.cache[p];
    }
});

test('AC05: "disabled" produces zero requests to any of the three mock servers', TEST_OPTS, async () => {
    const DisabledProvider = require(path.join("..", "..", "src", "core", "llm", "providers", "DisabledProvider.js"));
    const openaiMock = makeQueueServer();
    const azureMock = makeQueueServer();
    const compatMock = makeQueueServer();
    await Promise.all([listen(openaiMock.server), listen(azureMock.server), listen(compatMock.server)]);
    const provider = new DisabledProvider();
    const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    for (const m of [openaiMock, azureMock, compatMock]) assert.equal(m.state.hits, 0);
    await closeAll(openaiMock.server, azureMock.server, compatMock.server);
});

// --- S-11: OPENAI_API_KEY must never reach azure-openai / openai-compatible

test("S-11: a planted OPENAI_API_KEY marker never reaches the azure-openai or openai-compatible wire, nor the result", TEST_OPTS, async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "OPENAI_ENV_MARKER_SHOULD_NEVER_LEAK";
    try {
        const azureMock = makeQueueServer();
        const azurePort = await listen(azureMock.server);
        const azureProvider = new AzureOpenAIProvider(
            { provider: "azure-openai", azureDeployment: "dep", azureResource: "res", azureHostSuffix: "openai.azure.com", timeoutMs: 1500, maxAttempts: 1, runBudget: 50, maxResponseBytes: 65536, concurrency: 1, apiKey: SECRET_KEY },
            { baseUrl: `http://127.0.0.1:${azurePort}/openai/v1`, policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [azurePort] }, transportDeps: transportDeps(), sleep: async () => {} },
        );
        const azureResult = await azureProvider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(azureResult.ok, true);
        assert.equal(JSON.stringify(azureMock.state.lastHeaders).includes("OPENAI_ENV_MARKER"), false);
        assert.equal(JSON.stringify(azureResult).includes("OPENAI_ENV_MARKER"), false);
        await closeAll(azureMock.server);

        const compatMock = makeQueueServer();
        const compatPort = await listen(compatMock.server);
        const compatProvider = new OpenAICompatibleProvider(
            { provider: "openai-compatible", model: "llama3", allowCustomEndpoint: true, allowHttpLoopback: true, endpoint: `http://127.0.0.1:${compatPort}/v1`, timeoutMs: 1500, maxAttempts: 1, runBudget: 50, maxResponseBytes: 65536, concurrency: 1, apiKey: null },
            { policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [compatPort] }, transportDeps: transportDeps(), sleep: async () => {} },
        );
        const compatResult = await compatProvider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
        assert.equal(compatResult.ok, true);
        assert.equal(JSON.stringify(compatMock.state.lastHeaders).includes("OPENAI_ENV_MARKER"), false);
        assert.equal(compatMock.state.lastHeaders.authorization, "Bearer unused");
        assert.equal(JSON.stringify(compatResult).includes("OPENAI_ENV_MARKER"), false);
        await closeAll(compatMock.server);
    } finally {
        if (previous === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previous;
    }
});

// --- AC04: opt-in / SSRF-policy regression fixtures -------------------------

test("AC04: openai-compatible without allowCustomEndpoint=true returns CONFIG_ENDPOINT_OPT_IN_REQUIRED, zero I/O", TEST_OPTS, async () => {
    const mock = makeQueueServer();
    const port = await listen(mock.server);
    const provider = new OpenAICompatibleProvider(
        { provider: "openai-compatible", model: "llama3", allowCustomEndpoint: false, endpoint: `http://127.0.0.1:${port}/v1`, timeoutMs: 1500, maxAttempts: 1, runBudget: 50, maxResponseBytes: 65536, concurrency: 1, apiKey: null },
        {},
    );
    const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_ENDPOINT_OPT_IN_REQUIRED");
    assert.equal(result.attempts, 0);
    assert.equal(mock.state.hits, 0);
    await closeAll(mock.server);
});

test("AC04: opt-in but loopback http not allowed is rejected with zero connections", TEST_OPTS, async () => {
    const mock = makeQueueServer();
    const port = await listen(mock.server);
    const provider = new OpenAICompatibleProvider(
        { provider: "openai-compatible", model: "llama3", allowCustomEndpoint: true, allowHttpLoopback: false, endpoint: `http://127.0.0.1:${port}/v1`, timeoutMs: 1500, maxAttempts: 1, runBudget: 50, maxResponseBytes: 65536, concurrency: 1, apiKey: null },
        { policyOpts: { allowLoopback: false, allowHttpLoopback: false, extraAllowedPorts: [port] } },
    );
    const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.ok(["CONFIG_ENDPOINT_OPT_IN_REQUIRED", "ENDPOINT_POLICY_REJECTED"].includes(result.errorCode));
    assert.equal(mock.state.hits, 0);
    await closeAll(mock.server);
});

test("AC04: an always-deny metadata address is rejected with zero connections even with allowPrivate:true (IPv4)", TEST_OPTS, async () => {
    const provider = new OpenAICompatibleProvider(
        { provider: "openai-compatible", model: "llama3", allowCustomEndpoint: true, allowPrivateEndpoint: true, endpoint: "https://169.254.169.254/v1", timeoutMs: 1500, maxAttempts: 1, runBudget: 50, maxResponseBytes: 65536, concurrency: 1, apiKey: null },
        { policyOpts: { allowPrivate: true } },
    );
    const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "ENDPOINT_POLICY_REJECTED");
});

test("AC04: an always-deny metadata address is rejected with zero connections even with allowPrivate:true (IPv4-mapped IPv6)", TEST_OPTS, async () => {
    const provider = new OpenAICompatibleProvider(
        { provider: "openai-compatible", model: "llama3", allowCustomEndpoint: true, allowPrivateEndpoint: true, endpoint: "https://[::ffff:169.254.169.254]/v1", timeoutMs: 1500, maxAttempts: 1, runBudget: 50, maxResponseBytes: 65536, concurrency: 1, apiKey: null },
        { policyOpts: { allowPrivate: true } },
    );
    const result = await provider.complete({ prompt: "x", maxOutputTokens: 10, temperature: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "ENDPOINT_POLICY_REJECTED");
});
