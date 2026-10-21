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
