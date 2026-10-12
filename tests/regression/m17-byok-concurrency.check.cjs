/**
 * tests/regression/m17-byok-concurrency.check.cjs — QA independent test
 * (M17-BYOK AC03/AC02/AC09/AC10/AC12/N01).
 *
 * Runs TWO Tier 3 provider.complete() calls in a single process through
 * the REAL LlmProviderRegistry + ProviderContext + OpenAIProvider +
 * AnthropicProvider stack. OpenAI's SDK is swapped at the documented
 * `importOpenAI` seam; Anthropic's wire is injected at the documented
 * `transportDeps` seam. No real network, no sleeps for synchronisation
 * (a shared deferred barrier gates both mocks on the "in flight" edge).
 *
 * Run: node --test --test-concurrency=1 --test-timeout=15000 \
 *   tests/regression/m17-byok-concurrency.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const util = require("node:util");
const { EventEmitter } = require("node:events");

const ProviderContext = require("../../src/core/llm/ProviderContext");
const Registry = require("../../src/core/llm/LlmProviderRegistry");
const LlmTelemetry = require("../../src/core/llm/LlmTelemetry");

/** FAKE marker generator — CodeQL-safe (crypto.randomBytes, not Math.random). */
function fakeMarker(label) {
    return `FAKEMARKER_${label}_${crypto.randomBytes(12).toString("hex")}`;
}

const noSleep = () => Promise.resolve();

function makeDeferred() {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

/** N-party rendezvous: await returns only after N callers have reached. */
function makeBarrier(n) {
    const d = makeDeferred();
    let count = 0;
    return async function wait() {
        count += 1;
        if (count >= n) d.resolve();
        await d.promise;
    };
}

/** Capture console.*, process.stdout.write, process.stderr.write for marker sweep. */
function captureAllOutput(fn) {
    const chunks = [];
    const push = (prefix) => (...args) => {
        chunks.push(prefix + ":" + args.map((a) => (typeof a === "string" ? a : util.inspect(a))).join(" "));
    };
    const origConsole = {};
    for (const m of ["log", "info", "warn", "error", "debug"]) {
        origConsole[m] = console[m];
        console[m] = push("console." + m);
    }
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (c) => {
        chunks.push("stdout:" + (typeof c === "string" ? c : c.toString()));
        return true;
    };
    process.stderr.write = (c) => {
        chunks.push("stderr:" + (typeof c === "string" ? c : c.toString()));
        return true;
    };
    return (async () => {
        try {
            const value = await fn();
            return { value, chunks };
        } finally {
            for (const m of Object.keys(origConsole)) console[m] = origConsole[m];
            process.stdout.write = origOut;
            process.stderr.write = origErr;
        }
    })();
}

/** Build an Anthropic transport mock (lookup + httpsRequest spies). */
function makeAnthropicTransport({ onInFlight, status = 200, body = "{}", headers }) {
    const calls = [];
    const httpsRequest = (options, callback) => {
        let bodyBuf = "";
        const req = new EventEmitter();
        req.write = (chunk) => {
            bodyBuf += chunk;
        };
        req.destroy = () => {};
        req.end = () => {
            const record = { options, get body() { return bodyBuf; } };
            calls.push(record);
            Promise.resolve()
                .then(() => (onInFlight ? onInFlight() : null))
                .then(() => {
                    const res = new EventEmitter();
                    res.statusCode = status;
                    res.headers = headers || { "content-type": "application/json" };
                    res.destroy = () => {};
                    callback(res);
                    setImmediate(() => {
                        res.emit("data", Buffer.from(body));
                        res.emit("end");
                    });
                });
        };
        return req;
    };
    const lookup = (_h, _o, cb) => cb(null, [{ address: "203.0.113.9", family: 4 }]);
    return { calls, deps: { lookup, httpsRequest } };
}

/** Build a fake `openai` SDK module injectable via `importOpenAI`. */
function makeOpenAiMock({ onInFlight, response, throwOnCall }) {
    const calls = [];
    class FakeOpenAI {
        constructor(opts) {
            this._apiKey = opts.apiKey;
            this.chat = {
                completions: {
                    create: async (body) => {
                        calls.push({ apiKey: this._apiKey, body });
                        if (onInFlight) await onInFlight();
                        if (throwOnCall) {
                            const err = new Error("provider error");
                            err.status = throwOnCall.status;
                            if (throwOnCall.headers) err.headers = throwOnCall.headers;
                            throw err;
                        }
                        return response;
                    },
                },
            };
        }
    }
    return { calls, importOpenAI: async () => ({ OpenAI: FakeOpenAI }) };
}

test("AC03/AC02/AC09/AC12/N01: concurrent openai+anthropic executions isolate keys, models, and markers", { timeout: 15000 }, async () => {
    Registry._resetMemoForTests();
    ProviderContext._resetForTests();

    const KEY_A = fakeMarker("openai_A");
    const KEY_B = fakeMarker("anthropic_B");
    const MODEL_A = "gpt-future-test";
    const MODEL_B = "claude-future-test";

    const envA = { FALCON_QA_A_API_KEY: KEY_A };
    const envB = { ANTHROPIC_API_KEY: KEY_B };

    const ctxA = ProviderContext.resolve({
        options: { provider: "openai", model: MODEL_A, credentialEnvVar: "FALCON_QA_A_API_KEY" },
        env: envA,
    });
    const ctxB = ProviderContext.resolve({
        options: { provider: "anthropic", model: MODEL_B },
        env: envB,
    });
    assert.equal(ctxA.ok, true, "ctxA: " + JSON.stringify(ctxA));
    assert.equal(ctxB.ok, true, "ctxB: " + JSON.stringify(ctxB));

    const wait = makeBarrier(2);
    const openai = makeOpenAiMock({
        onInFlight: wait,
        response: { choices: [{ message: { content: "7" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    });
    const anthropic = makeAnthropicTransport({
        onInFlight: wait,
        body: JSON.stringify({ content: [{ type: "text", text: "ok B" }], usage: { input_tokens: 1, output_tokens: 1 } }),
    });

    const envBefore = JSON.stringify(process.env);

    const providerA = Registry.resolve(ctxA.context, { importOpenAI: openai.importOpenAI, sleep: noSleep });
    const providerB = Registry.resolve(ctxB.context, { sleep: noSleep, transportDeps: anthropic.deps });

    const captured = await captureAllOutput(async () =>
        Promise.all([
            providerA.complete({ prompt: "pA", maxOutputTokens: 10, temperature: 0 }),
            providerB.complete({ prompt: "pB", maxOutputTokens: 10, temperature: 0 }),
        ]),
    );
    const [rA, rB] = captured.value;

    const envAfter = JSON.stringify(process.env);
    assert.equal(envAfter, envBefore, "process.env must not be mutated by provider work");

    // Each mock saw exactly 1 request.
    const oaCalls = openai.calls;
    assert.equal(oaCalls.length, 1, "openai mock saw exactly 1 request");
    assert.equal(anthropic.calls.length, 1, "anthropic mock saw exactly 1 request");

    // Shape, model, key per mock.
    assert.equal(rA.ok, true, JSON.stringify(rA));
    assert.equal(rA.provider, "openai");
    assert.equal(rA.modelLabel, MODEL_A);
    assert.equal(oaCalls[0].apiKey, KEY_A);
    assert.equal(oaCalls[0].body.model, MODEL_A);

    assert.equal(rB.ok, true, JSON.stringify(rB));
    assert.equal(rB.provider, "anthropic");
    assert.equal(rB.modelLabel, MODEL_B);
    const anthRec = anthropic.calls[0];
    assert.equal(anthRec.options.hostname, "api.anthropic.com");
    assert.equal(anthRec.options.path, "/v1/messages");
    assert.equal(anthRec.options.headers["x-api-key"], KEY_B);
    const anthBody = JSON.parse(anthRec.body);
    assert.equal(anthBody.model, MODEL_B);

    // Cross-leak sweep: markers A/B must not appear in each other's mock,
    // the two results, telemetry serialisations, util.inspect of contexts,
    // JSON of contexts, captured stdout/stderr/console output.
    const anthSerialized = util.inspect(anthRec.options) + "||" + anthRec.body;
    assert.equal(anthSerialized.includes(KEY_A), false, "anthropic request leaked KEY_A");
    assert.equal(anthSerialized.includes(MODEL_A), false, "anthropic request leaked MODEL_A");
    const oaSerialized = JSON.stringify(oaCalls[0]);
    assert.equal(oaSerialized.includes(KEY_B), false, "openai request leaked KEY_B");
    assert.equal(oaSerialized.includes(MODEL_B), false, "openai request leaked MODEL_B");

    let telA = "";
    let telB = "";
    try { telA = JSON.stringify(LlmTelemetry.serialize ? LlmTelemetry.serialize(rA) : rA); } catch { telA = ""; }
    try { telB = JSON.stringify(LlmTelemetry.serialize ? LlmTelemetry.serialize(rB) : rB); } catch { telB = ""; }

    const sweepTargets = [
        JSON.stringify(rA),
        JSON.stringify(rB),
        util.inspect(ctxA.context),
        util.inspect(ctxB.context),
        JSON.stringify(ctxA.context),
        JSON.stringify(ctxB.context),
        telA,
        telB,
        captured.chunks.join("\n"),
    ];
    for (const [i, s] of sweepTargets.entries()) {
        assert.equal(s.includes(KEY_A), false, `KEY_A leaked at sweep target #${i}`);
        assert.equal(s.includes(KEY_B), false, `KEY_B leaked at sweep target #${i}`);
    }
});

test("AC02/N01: two openai contexts with different keys/models never share cache or carry each other's secrets", { timeout: 10000 }, async () => {
    Registry._resetMemoForTests();
    ProviderContext._resetForTests();

    const KEY1 = fakeMarker("K1");
    const KEY2 = fakeMarker("K2");
    const env = { FALCON_QA_ONE_API_KEY: KEY1, FALCON_QA_TWO_API_KEY: KEY2 };

    const c1 = ProviderContext.resolve({
        options: { provider: "openai", model: "gpt-m1", credentialEnvVar: "FALCON_QA_ONE_API_KEY" },
        env,
    });
    const c2 = ProviderContext.resolve({
        options: { provider: "openai", model: "gpt-m2", credentialEnvVar: "FALCON_QA_TWO_API_KEY" },
        env,
    });
    assert.equal(c1.ok, true, JSON.stringify(c1));
    assert.equal(c2.ok, true, JSON.stringify(c2));

    const calls1 = [];
    const calls2 = [];
    const importFor = (calls) => async () => ({
        OpenAI: class {
            constructor(opts) {
                this._k = opts.apiKey;
                this.chat = {
                    completions: {
                        create: async (body) => {
                            calls.push({ apiKey: this._k, body });
                            return { choices: [{ message: { content: "9" } }] };
                        },
                    },
                };
            }
        },
    });

    const p1 = Registry.resolve(c1.context, { importOpenAI: importFor(calls1), sleep: noSleep });
    const p2 = Registry.resolve(c2.context, { importOpenAI: importFor(calls2), sleep: noSleep });
    assert.notEqual(p1, p2, "distinct contexts must get distinct provider instances");

    await Promise.all([
        p1.complete({ prompt: "p", maxOutputTokens: 5, temperature: 0 }),
        p2.complete({ prompt: "p", maxOutputTokens: 5, temperature: 0 }),
    ]);

    assert.equal(calls1.length, 1);
    assert.equal(calls2.length, 1);
    assert.equal(calls1[0].apiKey, KEY1);
    assert.equal(calls1[0].body.model, "gpt-m1");
    assert.equal(calls2[0].apiKey, KEY2);
    assert.equal(calls2[0].body.model, "gpt-m2");
    assert.equal(JSON.stringify(calls1).includes(KEY2), false);
    assert.equal(JSON.stringify(calls2).includes(KEY1), false);
});

test("AC10/AC12: provider A 401 => AUTH_FAILED and provider B's endpoint is never probed, no fallback", { timeout: 10000 }, async () => {
    Registry._resetMemoForTests();
    ProviderContext._resetForTests();

    const KEY_A = fakeMarker("A401");
    const KEY_B = fakeMarker("Bidle");
    const envA = { FALCON_QA_A_API_KEY: KEY_A };
    const envB = { ANTHROPIC_API_KEY: KEY_B };

    const ctxA = ProviderContext.resolve({
        options: { provider: "openai", model: "gpt-x", credentialEnvVar: "FALCON_QA_A_API_KEY" },
        env: envA,
    });
    const ctxB = ProviderContext.resolve({
        options: { provider: "anthropic", model: "claude-x" },
        env: envB,
    });
    assert.equal(ctxA.ok, true);
    assert.equal(ctxB.ok, true);

    const openai = makeOpenAiMock({ throwOnCall: { status: 401 } });
    const anthropic = makeAnthropicTransport({ body: "{}" });

    const pA = Registry.resolve(ctxA.context, { importOpenAI: openai.importOpenAI, sleep: noSleep });
    const pB = Registry.resolve(ctxB.context, { sleep: noSleep, transportDeps: anthropic.deps });

    const rA = await pA.complete({ prompt: "p", maxOutputTokens: 5, temperature: 0 });
    assert.equal(rA.ok, false);
    assert.equal(rA.errorCode, "AUTH_FAILED");
    assert.equal(openai.calls.length, 1, "401 is never retried");
    assert.equal(anthropic.calls.length, 0, "provider B's endpoint is never touched on A's failure");

    // Marker sweep on the failure result and provider B (still idle).
    const serialized = JSON.stringify(rA) + "||" + util.inspect(pB);
    assert.equal(serialized.includes(KEY_A), false, "KEY_A leaked in failure path");
    assert.equal(serialized.includes(KEY_B), false, "KEY_B leaked in failure path");
});
