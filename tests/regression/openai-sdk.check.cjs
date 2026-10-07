"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { load, silent } = require("./helpers.cjs");

// Drives the real `openai` SDK (no stubs) against a local HTTP server selected
// through the SDK's OPENAI_BASE_URL override, so client construction, the
// request shape and response parsing are exercised without any OpenAI traffic.

async function mockProvider(t, respond) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      respond(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const saved = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL };
  process.env.OPENAI_API_KEY = "test-key-not-real";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  t.after(() => {
    for (const [name, value] of [["OPENAI_API_KEY", saved.key], ["OPENAI_BASE_URL", saved.base]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return requests;
}

const completion = (content) => ({
  id: "chatcmpl-test", object: "chat.completion", created: 1, model: "gpt-4o-mini",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

function reply(status, payload) {
  return (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
}

test("AIAnalyser builds the real SDK client and sends the expected chat request", async (t) => {
  const requests = await mockProvider(t, reply(200, completion("  #login-button  ")));
  const Analyser = load("src/core/AIHealer/AIAnalyser.js", { "../../../utils/Logger": silent });
  Analyser._openai = null;
  assert.equal(await Analyser.getAlternativeLocator("locator timed out"), "#login-button");
  assert.equal(requests.length, 1);
  const [r] = requests;
  assert.equal(r.method, "POST");
  assert.equal(r.url, "/v1/chat/completions");
  assert.equal(r.headers.authorization, "Bearer test-key-not-real");
  assert.equal(r.body.model, "gpt-4o-mini");
  assert.equal(r.body.max_tokens, 80);
  assert.equal(r.body.temperature, 0);
  assert.equal(r.body.messages[0].role, "system");
  assert.match(r.body.messages[1].content, /locator timed out/);
});

test("AIHealer builds the real SDK client, caches it and returns parsed choices", async (t) => {
  const requests = await mockProvider(t, reply(200, completion("3")));
  const Healer = load("src/core/AIHealer/AIHealer.js", { "../../../utils/Logger": silent });
  const healer = new Healer({});
  const client = await healer._getOpenAIClient();
  assert.equal(await healer._getOpenAIClient(), client);
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini", messages: [{ role: "user", content: "pick" }], max_tokens: 80, temperature: 0,
  });
  assert.equal(response.choices[0].message.content, "3");
  assert.equal(requests[0].body.messages[0].content, "pick");
});

test("provider 401 surfaces as error.status and the analyser degrades to null", async (t) => {
  const requests = await mockProvider(t, reply(401, { error: { message: "bad key", type: "invalid_request_error" } }));
  const Analyser = load("src/core/AIHealer/AIAnalyser.js", { "../../../utils/Logger": silent });
  Analyser._openai = null;
  assert.equal(await Analyser.getAlternativeLocator("x"), null);
  assert.equal(requests.length, 1, "401 must not be retried");
  const client = await Analyser._client();
  await assert.rejects(
    client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "x" }] }),
    (error) => error.status === 401,
  );
});

test("a missing API key still fails before the SDK is loaded", async (t) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });
  const Analyser = load("src/core/AIHealer/AIAnalyser.js", { "../../../utils/Logger": silent });
  Analyser._openai = null;
  await assert.rejects(Analyser._client(), /OPENAI_API_KEY is not set/);
  assert.equal(await Analyser.getAlternativeLocator("x"), null);
});
