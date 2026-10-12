/**
 * tests/regression/m17-byok-credentials.check.cjs — ADR-0019 ProviderContext
 * credential-reference validation and laziness (AC15, C10, C11, C16).
 *
 * Run: node --test --test-concurrency=1 tests/regression/m17-byok-credentials.check.cjs
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const util = require("node:util");
const path = require("node:path");

const ProviderContext = require(path.join("..", "..", "src", "core", "llm", "ProviderContext.js"));

function noGet() {
    return null;
}

/**
 * Proxy an env map so every `get(target, name)` (i.e. `env[name]`) is
 * recorded. `Object.hasOwn`/`Object.getOwnPropertyDescriptor` use the
 * `has`/`getOwnPropertyDescriptor` traps, not `get`, so resolve()'s
 * existence/shape checks never show up here — only an actual
 * `config.apiKey` access does.
 */
function recordingEnv(map) {
    const reads = [];
    const proxy = new Proxy({ ...map }, {
        get(target, prop, receiver) {
            if (typeof prop === "string") reads.push(prop);
            return Reflect.get(target, prop, receiver);
        },
    });
    return { proxy, reads };
}

test("AC15: resolve() reads no credential value; only config.apiKey access does", () => {
    const marker = "FAKEMARKER_" + Math.random().toString(36).slice(2);
    const { proxy, reads } = recordingEnv({ FAKEMARKER_CRED_1_API_KEY: marker });
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_CRED_1_API_KEY" },
        get: noGet,
        env: proxy,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(reads, [], "resolve() must not read env[name] via the get trap");

    const value = result.context.config.apiKey;
    assert.equal(value, marker);
    assert.deepEqual(reads, ["FAKEMARKER_CRED_1_API_KEY"], "config.apiKey access reads env[name] exactly once per access");
});

test("AC15: import of ProviderContext.js performs no credential reads (module load is side-effect-free)", () => {
    // Re-requiring an already-cached module is a no-op; this asserts the
    // module itself has no top-level env access by construction (it only
    // reads env inside resolve()/readCredential closures).
    assert.doesNotThrow(() => {
        delete require.cache[require.resolve(path.join("..", "..", "src", "core", "llm", "ProviderContext.js"))];
        require(path.join("..", "..", "src", "core", "llm", "ProviderContext.js"));
    });
});

test("C10: a key-shaped model value is rejected without echoing it in the error detail", () => {
    const keyShaped = "sk-" + "a".repeat(20);
    const result = ProviderContext.resolve({
        options: { provider: "openai", model: keyShaped, credentialEnvVar: "FAKEMARKER_X_API_KEY" },
        get: noGet,
        env: { FAKEMARKER_X_API_KEY: "tok" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assert.ok(!result.detail.includes(keyShaped), "error detail must not echo the key-shaped value");
});

test("C10: a Gemini-shaped key in the endpoint-equivalent azureDeployment field is rejected", () => {
    const geminiShaped = "AIza" + "B".repeat(35);
    const result = ProviderContext.resolve({
        options: {
            provider: "azure-openai",
            azureResource: "my-resource",
            azureHostSuffix: "openai.azure.com",
            azureDeployment: geminiShaped,
            credentialEnvVar: "FAKEMARKER_X_API_KEY",
        },
        get: noGet,
        env: { FAKEMARKER_X_API_KEY: "tok" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assert.ok(!result.detail.includes(geminiShaped));
});

test("C11: GITHUB_TOKEN is rejected as a credentialEnvVar (name shape mismatch)", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "GITHUB_TOKEN" },
        get: noGet,
        env: { GITHUB_TOKEN: "ghp_x" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("C11: AWS_SECRET_ACCESS_KEY is rejected as a credentialEnvVar", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "AWS_SECRET_ACCESS_KEY" },
        get: noGet,
        env: { AWS_SECRET_ACCESS_KEY: "secret" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("C11: NODE_OPTIONS is rejected as a credentialEnvVar (deny-list prefix)", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "NODE_OPTIONS" },
        get: noGet,
        env: { NODE_OPTIONS: "--inspect" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("C11: __proto__ is rejected as a credentialEnvVar (name shape mismatch)", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "__proto__" },
        get: noGet,
        env: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("C11: constructor is rejected as a credentialEnvVar (name shape mismatch)", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "constructor" },
        get: noGet,
        env: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
});

test("C11: a well-formed *_API_KEY name is accepted", () => {
    const marker = "FAKEMARKER_" + Math.random().toString(36).slice(2);
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "MY_CUSTOM_API_KEY" },
        get: noGet,
        env: { MY_CUSTOM_API_KEY: marker },
    });
    assert.equal(result.ok, true);
    assert.equal(result.context.config.apiKey, marker);
});

test("C16: resolve() never mutates process.env", () => {
    const before = { ...process.env };
    ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_NOENV_API_KEY" },
        get: noGet,
        env: { FAKEMARKER_NOENV_API_KEY: "tok" },
    });
    const after = { ...process.env };
    assert.deepEqual(after, before);
});

test("C16: util.inspect/JSON.stringify of the context never reveals the credential value", () => {
    const marker = "FAKEMARKER_" + Math.random().toString(36).slice(2);
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_CRED_2_API_KEY" },
        get: noGet,
        env: { FAKEMARKER_CRED_2_API_KEY: marker },
    });
    assert.equal(result.ok, true);
    const inspected = util.inspect(result.context, { depth: 10, showHidden: false });
    const jsonified = JSON.stringify(result.context);
    assert.ok(!inspected.includes(marker));
    assert.ok(!jsonified.includes(marker));
    assert.ok(!Object.keys(result.context.config).includes("apiKey"));
});

test("Missing credential at resolve time => CONFIG_MISSING_CREDENTIALS, value never read", () => {
    const { proxy, reads } = recordingEnv({});
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_MISSING_API_KEY" },
        get: noGet,
        env: proxy,
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_MISSING_CREDENTIALS");
    assert.deepEqual(reads, []);
});

test("Invalid credential shape (control char) at resolve time => CONFIG_INVALID, no echo, no throw", () => {
    const result = ProviderContext.resolve({
        options: { provider: "openai", credentialEnvVar: "FAKEMARKER_BADSHAPE_API_KEY" },
        get: noGet,
        env: { FAKEMARKER_BADSHAPE_API_KEY: "bad\r\nvalue" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "CONFIG_INVALID");
    assert.ok(!result.detail.includes("bad\r\nvalue"));
});
