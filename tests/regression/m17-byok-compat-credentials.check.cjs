/**
 * tests/regression/m17-byok-compat-credentials.check.cjs — Dev-16: an
 * invocation-scoped (options/profile-selected) provider=openai-compatible
 * must NEVER receive a credential intended for another provider. There is
 * no Phase 17 (FALCON_LLM_API_KEY/OPENAI_API_KEY) fallback on that path; an
 * explicit credentialEnvVar is required, or resolution fails with
 * CONFIG_MISSING_CREDENTIALS before any client is built and before any
 * network I/O. The Phase 17 env-only compat path (no flags/profile,
 * FALCON_LLM_PROVIDER=openai-compatible + FALCON_LLM_API_KEY) is documented
 * deprecated but still resolves, byte-identical to before.
 *
 * Uses a local mock HTTP server (no real network, no uncontrolled
 * third-party sites) to prove zero requests / which marker (if any)
 * actually reaches the wire.
 *
 * Run: node --test --test-concurrency=1 tests/regression/m17-byok-compat-credentials.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");

const ProviderContext = require("../../src/core/llm/ProviderContext");
const ProfileStore = require("../../src/core/llm/ProfileStore");
const Registry = require("../../src/core/llm/LlmProviderRegistry");

function noGet() {
    return null;
}

function makeGet(map) {
    return (key) => (Object.hasOwn(map, key) ? map[key] : null);
}

/** Minimal local HTTP server that records every request's Authorization header. */
async function startMockServer() {
    const hits = [];
    const server = http.createServer((req, res) => {
        hits.push({ authorization: req.headers.authorization || null, url: req.url });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    return {
        hits,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        async close() {
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

async function attemptCompletion(context, deps) {
    const provider = Registry.resolve(context, deps);
    return provider.complete({ prompt: "hello", maxOutputTokens: 8, temperature: 0 });
}

// --- NEGATIVE: options-selected openai-compatible, no credentialEnvVar -----

test("NEGATIVE (options): openai-compatible with planted FALCON_LLM_API_KEY marker and no credentialEnvVar fails CONFIG_MISSING_CREDENTIALS, mock server never hit", async () => {
    const mock = await startMockServer();
    try {
        const markerFalconKey = "FAKEMARKER_FALCONKEY_" + crypto.randomBytes(8).toString("hex");
        const result = ProviderContext.resolve({
            options: {
                provider: "openai-compatible",
                allowCustomEndpoint: true,
                endpoint: "https://compat.example.test/v1",
            },
            get: makeGet({ FALCON_LLM_API_KEY: markerFalconKey }),
            env: { FALCON_LLM_API_KEY: markerFalconKey },
        });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_MISSING_CREDENTIALS");
        assert.equal(JSON.stringify(result).includes(markerFalconKey), false);
        assert.equal(mock.hits.length, 0, "zero requests must reach the mock endpoint");
    } finally {
        await mock.close();
    }
});

test("NEGATIVE (options): openai-compatible with planted OPENAI_API_KEY marker and no credentialEnvVar fails CONFIG_MISSING_CREDENTIALS, mock server never hit", async () => {
    const mock = await startMockServer();
    try {
        const markerOpenAiKey = "FAKEMARKER_OPENAIKEY_" + crypto.randomBytes(8).toString("hex");
        const result = ProviderContext.resolve({
            options: { provider: "openai-compatible", allowCustomEndpoint: true, endpoint: `https://example.test/v1` },
            get: makeGet({ OPENAI_API_KEY: markerOpenAiKey }),
            env: { OPENAI_API_KEY: markerOpenAiKey },
        });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_MISSING_CREDENTIALS");
        assert.equal(JSON.stringify(result).includes(markerOpenAiKey), false);
        assert.equal(mock.hits.length, 0);
    } finally {
        await mock.close();
    }
});

// --- NEGATIVE: profile-selected openai-compatible, no credentialEnvVar -----

test("NEGATIVE (profile): openai-compatible profile with planted FALCON_LLM_API_KEY marker and no credentialEnvVar fails CONFIG_MISSING_CREDENTIALS, mock server never hit", async () => {
    const mock = await startMockServer();
    try {
        const markerFalconKey = "FAKEMARKER_PROFFALCON_" + crypto.randomBytes(8).toString("hex");
        const result = ProviderContext.resolve({
            profile: { provider: "openai-compatible", allowCustomEndpoint: true, endpoint: `https://example.test/v1` },
            get: makeGet({ FALCON_LLM_API_KEY: markerFalconKey }),
            env: { FALCON_LLM_API_KEY: markerFalconKey },
        });
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_MISSING_CREDENTIALS");
        assert.equal(JSON.stringify(result).includes(markerFalconKey), false);
        assert.equal(mock.hits.length, 0);
    } finally {
        await mock.close();
    }
});

test("ProfileStore.set rejects an openai-compatible profile missing credentialEnvVar with CONFIG_MISSING_CREDENTIALS, fixed value-free detail", async () => {
    const os = require("node:os");
    const path = require("node:path");
    const fs = require("node:fs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-byok-compat-"));
    try {
        const result = await ProfileStore.set(
            "compat-no-cred",
            { provider: "openai-compatible", allowCustomEndpoint: true, endpoint: "https://example.test/v1" },
            { env: {}, cwd: dir },
        );
        assert.equal(result.ok, false);
        assert.equal(result.errorCode, "CONFIG_MISSING_CREDENTIALS");
        assert.equal(typeof result.detail, "string");
        assert.equal(fs.existsSync(path.join(dir, "compat-no-cred.json")), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// --- POSITIVE: explicit credentialEnvVar naming a different variable -------

test("POSITIVE: credentialEnvVar naming marker B reaches only the compatible endpoint, carrying marker B and never the FALCON_LLM_API_KEY marker", async () => {
    const markerFalconKey = "FAKEMARKER_UNUSED_FALCON_" + crypto.randomBytes(8).toString("hex");
    const markerOpenAi = "FAKEMARKER_UNUSED_OPENAI_" + crypto.randomBytes(8).toString("hex");
    const markerB = "FAKEMARKER_B_" + crypto.randomBytes(8).toString("hex");
    const result = ProviderContext.resolve({
        options: {
            provider: "openai-compatible",
            allowCustomEndpoint: true,
            endpoint: "https://compat.example.test/v1",
            credentialEnvVar: "FAKEMARKER_B_API_KEY",
        },
        get: makeGet({ FALCON_LLM_API_KEY: markerFalconKey, OPENAI_API_KEY: markerOpenAi }),
        env: { FALCON_LLM_API_KEY: markerFalconKey, OPENAI_API_KEY: markerOpenAi, FAKEMARKER_B_API_KEY: markerB },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.context.config.apiKey, markerB);

    const calls = [];
    const httpsRequest = (options, callback) => {
        const req = new EventEmitter();
        let body = "";
        req.write = (chunk) => { body += chunk; };
        req.destroy = () => {};
        req.end = () => {
            calls.push({ options, body });
            const res = new EventEmitter();
            res.statusCode = 200;
            res.headers = { "content-type": "application/json" };
            res.destroy = () => {};
            callback(res);
            setImmediate(() => {
                res.emit("data", Buffer.from(JSON.stringify({ choices: [{ message: { content: "ok" } }] })));
                res.emit("end");
            });
        };
        return req;
    };
    const lookup = (_h, _o, cb) => cb(null, [{ address: "203.0.113.9", family: 4 }]);
    const outcome = await attemptCompletion(result.context, { transportDeps: { lookup, httpsRequest } });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.ok(calls.length >= 1, "a request reaches the compatible endpoint");
    for (const call of calls) {
        const wire = JSON.stringify(call.options) + call.body;
        assert.ok(String(call.options.hostname || call.options.host).includes("compat.example.test"), "only the compatible endpoint is contacted");
        assert.ok(wire.includes(markerB), "the request carries marker B");
        assert.equal(wire.includes(markerFalconKey), false, "FALCON_LLM_API_KEY marker never reaches the wire");
        assert.equal(wire.includes(markerOpenAi), false, "OPENAI_API_KEY marker never reaches the wire");
    }
});

// --- Phase 17 env-only path still resolves (documented deprecated) ---------

test("DEPRECATED env-only path: FALCON_LLM_PROVIDER=openai-compatible + FALCON_LLM_API_KEY (no flags/profile) still resolves", () => {
    const markerEnvOnly = "FAKEMARKER_ENVONLY_" + crypto.randomBytes(8).toString("hex");
    const result = ProviderContext.resolve({
        get: makeGet({
            FALCON_LLM_PROVIDER: "openai-compatible",
            FALCON_LLM_ALLOW_CUSTOM_ENDPOINT: "true",
            FALCON_LLM_ENDPOINT: "https://example.test/v1",
            FALCON_LLM_API_KEY: markerEnvOnly,
        }),
        env: { FALCON_LLM_API_KEY: markerEnvOnly },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.context.config.provider, "openai-compatible");
    assert.equal(result.context.config.apiKey, markerEnvOnly);
    assert.equal(result.context.sources.apiKey, "env");
});
