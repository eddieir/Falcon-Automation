"use strict";

// The openai SDK reads OPENAI_CUSTOM_HEADERS in its constructor and lets it
// replace Authorization and OpenAI-Organization. Falcon's clients must not
// consult it. Everything runs against a loopback server; no real API is called.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { load, silent, root } = require("./helpers.cjs");
const OpenAI = require(path.join(root, "node_modules", "openai"));
const { constructSdkClient } = require(path.join(root, "src", "core", "llm", "transport", "sdkConstruct.js"));

const KEY = "sk-test-hardening-0123456789abcdef";
const HOSTILE = "X-Injected: yes\nAuthorization: Bearer ATTACKER\nOpenAI-Organization: org-attacker";

function withEnv(name, value, fn) {
  const had = Object.hasOwn(process.env, name);
  const prev = process.env[name];
  process.env[name] = value;
  const restore = () => {
    if (had) process.env[name] = prev;
    else delete process.env[name];
  };
  return Promise.resolve().then(fn).finally(restore);
}

async function captureHeaders(client) {
  let seen = null;
  const server = http.createServer((req, res) => {
    seen = req.headers;
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    client.baseURL = `http://127.0.0.1:${server.address().port}/v1`;
    await client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "hi" }] });
    return seen;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function assertClean(headers) {
  assert.equal(headers.authorization, `Bearer ${KEY}`);
  assert.equal(headers["x-injected"], undefined);
  assert.equal(headers["openai-organization"], undefined);
}

test("control: the bare SDK lets OPENAI_CUSTOM_HEADERS replace Authorization", () =>
  withEnv("OPENAI_CUSTOM_HEADERS", HOSTILE, async () => {
    const client = new OpenAI({ apiKey: KEY, organization: null, project: null, maxRetries: 0 });
    const headers = await captureHeaders(client);
    assert.equal(headers.authorization, "Bearer ATTACKER");
  }));

test("constructSdkClient ignores OPENAI_CUSTOM_HEADERS and keeps the configured key", () =>
  withEnv("OPENAI_CUSTOM_HEADERS", HOSTILE, async () => {
    const client = constructSdkClient(OpenAI, { apiKey: KEY, organization: null, project: null, maxRetries: 0, logLevel: "off" });
    assertClean(await captureHeaders(client));
  }));

test("constructSdkClient restores the variable afterwards, and leaves an unset one unset", async () => {
  await withEnv("OPENAI_CUSTOM_HEADERS", HOSTILE, async () => {
    constructSdkClient(OpenAI, { apiKey: KEY, maxRetries: 0 });
    assert.equal(process.env.OPENAI_CUSTOM_HEADERS, HOSTILE);
  });
  assert.equal(Object.hasOwn(process.env, "OPENAI_CUSTOM_HEADERS"), false);
  constructSdkClient(OpenAI, { apiKey: KEY, maxRetries: 0 });
  assert.equal(Object.hasOwn(process.env, "OPENAI_CUSTOM_HEADERS"), false);
});

test("constructSdkClient restores the variable even when the constructor throws", async () => {
  await withEnv("OPENAI_CUSTOM_HEADERS", HOSTILE, async () => {
    const Throwing = function () { throw new Error("boom"); };
    assert.throws(() => constructSdkClient(Throwing, {}), /boom/);
    assert.equal(process.env.OPENAI_CUSTOM_HEADERS, HOSTILE);
  });
});

test("AIHealer._getOpenAIClient turns SDK logging off and ignores OPENAI_CUSTOM_HEADERS", async () => {
  const Healer = load("src/core/AIHealer/AIHealer.js", { "../../../utils/Logger": silent });
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = KEY;
  try {
    await withEnv("OPENAI_CUSTOM_HEADERS", HOSTILE, async () => {
      const client = await Healer.prototype._getOpenAIClient.call({});
      assert.equal(client.logLevel, "off");
      assertClean(await captureHeaders(client));
    });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("constructSdkClient does not pick up the SDK's admin key or webhook secret from the environment", async () => {
  await withEnv("OPENAI_ADMIN_KEY", "sk-admin-canary", () =>
    withEnv("OPENAI_WEBHOOK_SECRET", "whsec-canary", async () => {
      const client = constructSdkClient(OpenAI, { apiKey: KEY, maxRetries: 0 });
      assert.equal(client.adminAPIKey, null);
      assert.equal(client.webhookSecret, null);
    }));
});

const dns = require("node:dns");
const OpenAIProvider = require(path.join(root, "src", "core", "llm", "providers", "OpenAIProvider.js"));
const AzureOpenAIProvider = require(path.join(root, "src", "core", "llm", "providers", "AzureOpenAIProvider.js"));
const OpenAICompatibleProvider = require(path.join(root, "src", "core", "llm", "providers", "OpenAICompatibleProvider.js"));

function providerCase(name, build) {
  test(`${name} sends its own key and ignores OPENAI_CUSTOM_HEADERS`, () =>
    withEnv("OPENAI_CUSTOM_HEADERS", HOSTILE, async () => {
      let seen = null;
      const server = http.createServer((req, res) => {
        seen = req.headers;
        req.resume();
        req.on("end", () => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        });
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const port = server.address().port;
        const baseUrl = `http://127.0.0.1:${port}/v1`;
        const config = { provider: "openai", model: "m", timeoutMs: 3000, maxAttempts: 1, runBudget: 10, maxResponseBytes: 65536, concurrency: 1, apiKey: KEY };
        const deps = {
          baseUrl,
          policyOpts: { allowLoopback: true, allowHttpLoopback: true, extraAllowedPorts: [port] },
          transportDeps: { lookup: dns.lookup, httpRequest: http.request, httpsRequest: require("node:https").request },
          sleep: async () => {},
        };
        const result = await build(config, deps).complete({ prompt: "hi", maxOutputTokens: 16, temperature: 0 });
        assert.equal(result.ok, true, JSON.stringify(result));
        assertClean(seen);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }));
}
providerCase("OpenAIProvider", (config, deps) => new OpenAIProvider(config, deps));
providerCase("AzureOpenAIProvider", (config, deps) =>
  new AzureOpenAIProvider({ ...config, azureDeployment: config.model, azureResource: "res", azureHostSuffix: "openai.azure.com" }, deps));
providerCase("OpenAICompatibleProvider", (config, deps) =>
  new OpenAICompatibleProvider({ ...config, allowCustomEndpoint: true, allowHttpLoopback: true, endpoint: deps.baseUrl }, deps));

test("no production source builds an SDK client except through constructSdkClient", () => {
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && entry.name !== "sdkConstruct.js" && /new OpenAI\(/.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
    }
  })(path.join(root, "src"));
  assert.deepEqual(offenders, []);
});
