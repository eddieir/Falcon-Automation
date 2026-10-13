/**
 * tests/regression/m17-byok-dashboard-ledger.check.cjs
 *
 * Closes the dashboard/ledger coverage gap noted as a `limitation` on
 * M17-BYOK-AC03 and M17-BYOK-AC22 in docs/maintenance-byok-acceptance-
 * criteria.json: neither AC had a test that actually ran concurrent BYOK
 * provider executions alongside the Phase 17 production-cycle ledger
 * (EventLog/EventValidator/Redact) and dashboard HTTP server (Server.js).
 *
 * (AC03) Runs two concurrent mock provider executions (openai + anthropic,
 * same harness shape as m17-byok-concurrency.check.cjs, each with its own
 * planted marker key) and records real dispatch/provider-metadata ledger
 * events for both. Asserts zero cross-marker leakage across: the ledger
 * file on disk, every dashboard HTTP response (`/` and `/api/state`), and
 * captured logs/console/stdout/stderr/errors.
 *
 * (AC22) Asserts the dashboard serves the real dispatch packets and only
 * safe provider/profile metadata (provider id, model label, credential
 * ENV VAR NAME — never the credential value) for byok dispatches, and that
 * attempting to append an event containing a key-shaped value or an
 * apiKey-named field is rejected by the real EventValidator/Redact.scan
 * path (EventLog.appendEvent), never silently persisted.
 *
 * No network. No paid calls. Ephemeral port 0. Temp dirs under
 * os.tmpdir() via fs.mkdtemp, removed in `finally`.
 *
 * Run: node --test --test-concurrency=1 --test-timeout=15000 \
 *   tests/regression/m17-byok-dashboard-ledger.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const util = require("node:util");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { EventEmitter } = require("node:events");

const ProviderContext = require("../../src/core/llm/ProviderContext");
const Registry = require("../../src/core/llm/LlmProviderRegistry");

const EventLog = require("../../src/production-cycle/EventLog");
const Server = require("../../src/production-cycle/Server");
const Redact = require("../../src/production-cycle/Redact");

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

function makeBarrier(n) {
  const d = makeDeferred();
  let count = 0;
  return async function wait() {
    count += 1;
    if (count >= n) d.resolve();
    await d.promise;
  };
}

/** Capture console.*, process.stdout/stderr.write for the marker sweep. */
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

function makeAnthropicTransport({ onInFlight, status = 200, body = "{}" }) {
  const calls = [];
  const httpsRequest = (options, callback) => {
    let bodyBuf = "";
    const req = new EventEmitter();
    req.write = (chunk) => {
      bodyBuf += chunk;
    };
    req.destroy = () => {};
    req.end = () => {
      const record = {
        options,
        get body() {
          return bodyBuf;
        },
      };
      calls.push(record);
      Promise.resolve()
        .then(() => (onInFlight ? onInFlight() : null))
        .then(() => {
          const res = new EventEmitter();
          res.statusCode = status;
          res.headers = { "content-type": "application/json" };
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

function makeOpenAiMock({ onInFlight, response }) {
  const calls = [];
  class FakeOpenAI {
    constructor(opts) {
      this._apiKey = opts.apiKey;
      this.chat = {
        completions: {
          create: async (body) => {
            calls.push({ apiKey: this._apiKey, body });
            if (onInFlight) await onInFlight();
            return response;
          },
        },
      };
    }
  }
  return { calls, importOpenAI: async () => ({ OpenAI: FakeOpenAI }) };
}

async function mkRunDir(prefix) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const runDir = path.join(root, "run1");
  await fsp.mkdir(runDir, { recursive: true });
  return { root, runDir };
}

function request(port, pathAndQuery, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathAndQuery,
        method: options.method || "GET",
        headers: Object.assign({ Host: `127.0.0.1:${port}` }, options.headers),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function startServer(runDir) {
  const instance = Server.create({ runDir, port: 0, host: "127.0.0.1" });
  const bound = await instance.listen();
  return { instance, port: bound.port };
}

// Credential ENV VAR NAMES (not values) are secret-source info and must
// never appear in a ledger summary or any dashboard response. This is a
// simple, linear, anchored detector: any `_API_KEY`-suffixed SCREAMING_SNAKE
// identifier, which covers ANTHROPIC_API_KEY, GEMINI_API_KEY, and custom
// names such as FALCON_QA_DASH_A_API_KEY alike.
const ENV_VAR_NAME_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_API_KEY\b/;

function containsEnvVarName(text) {
  return typeof text === "string" && ENV_VAR_NAME_RE.test(text);
}

function baseDraft(overrides) {
  return Object.assign(
    {
      runId: "run1",
      type: "dispatch_created",
      phase: "P3",
      taskId: "Dev-13",
      packetId: null,
      fromRole: "coordinator",
      toRole: "developer",
      requestedLabel: null,
      resolvedModelId: null,
      observedModelId: null,
      targetRevision: "UNKNOWN",
      status: "PENDING",
      verdict: null,
      summary: "dispatch event",
      evidenceRefs: [],
      openRisks: [],
      dispatchIndex: null,
      dispatchTotal: null,
      retryCount: null,
      attempt: null,
      invalidates: [],
    },
    overrides
  );
}

test(
  "AC03/AC22: concurrent openai+anthropic dispatches leave zero cross-markers in the ledger file or any dashboard response",
  { timeout: 15000 },
  async () => {
    Registry._resetMemoForTests();
    ProviderContext._resetForTests();

    const KEY_A = fakeMarker("openai_A");
    const KEY_B = fakeMarker("anthropic_B");
    const MODEL_A = "gpt-dash-test";
    const MODEL_B = "claude-dash-test";
    const CRED_VAR_A = "FALCON_QA_DASH_A_API_KEY";
    const CRED_VAR_B = "ANTHROPIC_API_KEY";

    const envA = { [CRED_VAR_A]: KEY_A };
    const envB = { ANTHROPIC_API_KEY: KEY_B };

    const ctxA = ProviderContext.resolve({
      options: { provider: "openai", model: MODEL_A, credentialEnvVar: CRED_VAR_A },
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

    const providerA = Registry.resolve(ctxA.context, { importOpenAI: openai.importOpenAI, sleep: noSleep });
    const providerB = Registry.resolve(ctxB.context, { sleep: noSleep, transportDeps: anthropic.deps });

    const { root, runDir } = await mkRunDir("m17-byok-dash-ledger-");

    try {
      // Record real dispatch/provider-metadata ledger events for BOTH
      // concurrently-dispatched contexts. Approved policy: ledger/dashboard
      // may show provider id, model id, and a safe profile label ONLY.
      // Secret-source info — both credential VALUES and credential
      // ENV VAR NAMES (e.g. ANTHROPIC_API_KEY, GEMINI_API_KEY, custom
      // *_API_KEY names) — must never appear in a ledger summary or any
      // dashboard response; ProviderContext keeps _credentialEnvVarName
      // non-enumerable for exactly this reason.
      const appendA = EventLog.appendEvent(
        runDir,
        baseDraft({
          taskId: "Dev-13",
          summary: "dispatch provider=openai model=" + MODEL_A + " profile=openai-dispatch",
          requestedLabel: "openai-dispatch",
          resolvedModelId: MODEL_A,
        })
      );
      const appendB = EventLog.appendEvent(
        runDir,
        baseDraft({
          taskId: "Dev-13",
          summary: "dispatch provider=anthropic model=" + MODEL_B + " profile=anthropic-dispatch",
          requestedLabel: "anthropic-dispatch",
          resolvedModelId: MODEL_B,
        })
      );

      const captured = await captureAllOutput(async () =>
        Promise.all([
          providerA.complete({ prompt: "pA", maxOutputTokens: 10, temperature: 0 }),
          providerB.complete({ prompt: "pB", maxOutputTokens: 10, temperature: 0 }),
          appendA,
          appendB,
        ])
      );
      const [rA, rB, appendResultA, appendResultB] = captured.value;

      assert.equal(rA.ok, true, JSON.stringify(rA));
      assert.equal(rB.ok, true, JSON.stringify(rB));
      assert.equal(appendResultA.ok, true, "dispatch-A ledger append must succeed: " + JSON.stringify(appendResultA));
      assert.equal(appendResultB.ok, true, "dispatch-B ledger append must succeed: " + JSON.stringify(appendResultB));

      // --- Ledger file contents: zero cross-markers, and zero markers or
      // credential ENV VAR NAMES at all (keys AND their env-var names must
      // never be persisted anywhere, per AC01/AC12/AC19). ---
      const ledgerPath = path.join(runDir, "events.jsonl");
      const ledgerRaw = await fsp.readFile(ledgerPath, "utf8");
      assert.ok(!ledgerRaw.includes(KEY_A), "ledger file must never contain KEY_A");
      assert.ok(!ledgerRaw.includes(KEY_B), "ledger file must never contain KEY_B");
      assert.ok(!ledgerRaw.includes(CRED_VAR_A), "ledger file must never contain the credential env-var name A");
      assert.ok(!ledgerRaw.includes(CRED_VAR_B), "ledger file must never contain the credential env-var name B");
      assert.equal(containsEnvVarName(ledgerRaw), false, "ledger file must never contain any *_API_KEY env-var name");
      // Safe metadata IS expected to be present (AC22: real dispatch
      // packets + safe provider id/model label/profile label are served).
      assert.ok(ledgerRaw.includes(MODEL_A), "ledger must retain safe model label A");
      assert.ok(ledgerRaw.includes(MODEL_B), "ledger must retain safe model label B");
      assert.ok(ledgerRaw.includes("provider=openai"), "ledger must retain safe provider id A");
      assert.ok(ledgerRaw.includes("provider=anthropic"), "ledger must retain safe provider id B");

      // --- Dashboard HTTP responses: zero markers in state/events/UI. ---
      const { instance, port } = await startServer(runDir);
      try {
        const rState = await request(port, "/api/state");
        assert.equal(rState.status, 200);
        const stateData = JSON.parse(rState.body);
        assert.ok(Array.isArray(stateData.events));
        assert.equal(stateData.events.length, 2);

        const rUi = await request(port, "/");
        assert.equal(rUi.status, 200);

        for (const [label, body] of [
          ["/api/state", rState.body],
          ["/ (UI)", rUi.body],
        ]) {
          assert.ok(!body.includes(KEY_A), `${label} leaked KEY_A`);
          assert.ok(!body.includes(KEY_B), `${label} leaked KEY_B`);
          assert.ok(!body.includes(CRED_VAR_A), `${label} leaked credential env-var name A`);
          assert.ok(!body.includes(CRED_VAR_B), `${label} leaked credential env-var name B`);
          assert.equal(containsEnvVarName(body), false, `${label} leaked some *_API_KEY env-var name`);
        }
        assert.ok(!JSON.stringify(rState.headers).includes(KEY_A), "state headers leaked KEY_A");
        assert.ok(!JSON.stringify(rState.headers).includes(KEY_B), "state headers leaked KEY_B");
        assert.ok(!JSON.stringify(rState.headers).includes(CRED_VAR_A), "state headers leaked credential env-var name A");
        assert.ok(!JSON.stringify(rState.headers).includes(CRED_VAR_B), "state headers leaked credential env-var name B");

        // AC22: dashboard serves the real dispatch packets + safe metadata
        // (provider id, model label, profile label) for byok dispatches —
        // never fabricated, and never the credential source (value or
        // env-var name).
        assert.ok(rState.body.includes(MODEL_A), "/api/state must surface the real model label A");
        assert.ok(rState.body.includes(MODEL_B), "/api/state must surface the real model label B");
        assert.ok(rState.body.includes("provider=openai"), "/api/state must surface the real provider id A");
        assert.ok(rState.body.includes("provider=anthropic"), "/api/state must surface the real provider id B");
        assert.ok(rState.body.includes("openai-dispatch"), "/api/state must surface the safe profile label A");
        assert.ok(rState.body.includes("anthropic-dispatch"), "/api/state must surface the safe profile label B");
        assert.ok(rState.body.includes("Dev-13"), "/api/state must surface the real taskId, not a fabricated one");

        // Positive control: prove the env-var-name absence check is not a
        // vacuous no-op by running it against a synthetic string that does
        // contain a credential env-var name, and against the real values.
        assert.equal(containsEnvVarName("cred_env=" + CRED_VAR_A), true, "detector must flag a planted env-var name");
        assert.equal(containsEnvVarName("cred_env=" + CRED_VAR_B), true, "detector must flag ANTHROPIC_API_KEY");
        assert.equal(containsEnvVarName("GEMINI_API_KEY"), true, "detector must flag GEMINI_API_KEY");
        assert.equal(containsEnvVarName("no secrets here"), false, "detector must not false-positive on plain text");
      } finally {
        await instance.close();
      }

      // --- Logs/console/stdout/stderr/errors captured during the
      // concurrent dispatch: zero cross-markers, zero markers at all. ---
      const outputJoined = captured.chunks.join("\n");
      assert.ok(!outputJoined.includes(KEY_A), "captured output leaked KEY_A");
      assert.ok(!outputJoined.includes(KEY_B), "captured output leaked KEY_B");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }
);

test("AC22: appendEvent rejects a key-shaped value in a free-text field via the real Redact.scan path", { timeout: 8000 }, async () => {
  const { root, runDir } = await mkRunDir("m17-byok-dash-ledger-redact-");
  try {
    const marker = fakeMarker("redact_summary");
    const keyShaped = "sk-" + "a".repeat(20);

    // Sanity: Redact itself really flags this shape (don't invent behavior).
    assert.equal(Redact.scanField(keyShaped).ok, false);

    const result = await EventLog.appendEvent(
      runDir,
      baseDraft({ summary: "leaked key attempt " + keyShaped + " " + marker })
    );
    assert.equal(result.ok, false, "a key-shaped summary must be rejected, not persisted");
    assert.equal(result.errorCode, Redact.CODE);

    const ledgerPath = path.join(runDir, "events.jsonl");
    const exists = fs.existsSync(ledgerPath);
    if (exists) {
      const raw = await fsp.readFile(ledgerPath, "utf8");
      assert.ok(!raw.includes(keyShaped), "rejected key-shaped value must never reach the ledger file");
      assert.ok(!raw.includes(marker), "rejected marker must never reach the ledger file");
      assert.equal(raw.trim().length, 0, "nothing should have been written at all");
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("AC22/AC12: appendEvent rejects an apiKey-named top-level field via the real EventValidator path", { timeout: 8000 }, async () => {
  const { root, runDir } = await mkRunDir("m17-byok-dash-ledger-apikey-");
  try {
    const marker = fakeMarker("apikey_field");
    const draft = baseDraft({});
    draft.apiKey = marker;

    const result = await EventLog.appendEvent(runDir, draft);
    assert.equal(result.ok, false, "an apiKey-named field must be rejected, not persisted");
    assert.equal(result.errorCode, "SCHEMA_INVALID");
    assert.ok(
      Array.isArray(result.details) && result.details.some((e) => e.field === "apiKey"),
      "validator must flag the apiKey field by name: " + JSON.stringify(result.details)
    );

    const ledgerPath = path.join(runDir, "events.jsonl");
    assert.ok(!fs.existsSync(ledgerPath), "a rejected first-ever event must never create the ledger file");

    // Confirm the dashboard, pointed at this run dir, never saw it either.
    const { instance, port } = await startServer(runDir);
    try {
      const r = await request(port, "/api/state");
      assert.equal(r.status, 200);
      assert.ok(!r.body.includes(marker), "/api/state must never surface a rejected apiKey-field marker");
      const data = JSON.parse(r.body);
      assert.equal(data.run.present, false);
      assert.deepEqual(data.events, []);
    } finally {
      await instance.close();
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
