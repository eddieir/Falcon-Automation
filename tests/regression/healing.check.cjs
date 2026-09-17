const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, silent, temp } = require("./helpers.cjs");
const Retry = load("src/core/AIHealer/AdaptiveRetry.js", {
  "../../../utils/Logger": silent,
});
for (const [message, expected] of [
  ["timeout exceeded", "TIMEOUT"],
  ["timed out", "TIMEOUT"],
  ["stale element", "STALE_ELEMENT"],
  ["detached", "STALE_ELEMENT"],
  ["element is not attached", "STALE_ELEMENT"],
  ["element handle is disposed", "STALE_ELEMENT"],
  ["net::ERR_RESET", "NETWORK"],
  ["ECONNRESET", "NETWORK"],
  ["ECONNREFUSED", "NETWORK"],
  ["navigation failed", "NETWORK"],
  ["fetch failed", "NETWORK"],
  ["assertion failed", "HARD"],
]) {
  test(`retry classifies ${message}`, () =>
    assert.equal(Retry.classify(new Error(message)), expected));
}
test("retry honors TimeoutError name and missing message", () => {
  assert.equal(Retry.classify({ name: "TimeoutError" }), "TIMEOUT");
  assert.equal(Retry.classify({}), "HARD");
});
test("retry returns success and retries transient failures exactly to its limit", async () => {
  const retry = new Retry({ maxAttempts: 3, baseDelayMs: 0 });
  let calls = 0;
  assert.equal(
    await retry.execute(() => {
      if (++calls < 3) throw Error("network");
      return 42;
    }),
    42,
  );
  assert.equal(calls, 3);
  calls = 0;
  const failure = Error("timeout");
  await assert.rejects(
    retry.execute(() => {
      calls++;
      throw failure;
    }),
    (e) => e === failure,
  );
  assert.equal(calls, 3);
});
test("hard errors stop immediately", async () => {
  let calls = 0;
  await assert.rejects(
    new Retry().execute(() => {
      calls++;
      throw Error("invalid selector");
    }),
    /invalid selector/,
  );
  assert.equal(calls, 1);
});
for (const [kind, multiplier] of [
  ["TIMEOUT", 2],
  ["STALE_ELEMENT", 1.5],
  ["NETWORK", 0.75],
  ["OTHER", 1],
]) {
  test(`backoff bounds and cap for ${kind}`, () => {
    const retry = new Retry({ baseDelayMs: 100, maxDelayMs: 500 });
    for (let i = 0; i < 100; i++) {
      const delay = retry._calcDelay(2, kind);
      assert.ok(delay >= 160 * multiplier && delay <= 240 * multiplier);
      assert.equal(retry._calcDelay(20, kind), 500);
    }
  });
}
function storeAt(t, contents) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = load("src/core/AIHealer/LocatorStore.js");
  store.storePath = path.join(dir, "nested/store.json");
  if (contents !== undefined) {
    fs.mkdirSync(path.dirname(store.storePath));
    fs.writeFileSync(store.storePath, contents);
  }
  store.data = store._loadSync();
  return store;
}
test("locator cache persists deduplicated bounded alternatives and reloads", async (t) => {
  const store = storeAt(t);
  for (let i = 0; i < 8; i++) store.addLocator("#old", `#new${i}`);
  store.addLocator("#old", "#new7");
  await store._queue;
  assert.deepEqual(store.getAlternatives("#old"), [
    "#new3",
    "#new4",
    "#new5",
    "#new6",
    "#new7",
  ]);
  assert.deepEqual(store._loadSync(), store.data);
  assert.deepEqual(store.getAlternatives("missing"), []);
});
test("locator cache migrates legacy data", (t) => {
  const store = storeAt(t, JSON.stringify({ "#old": ["#new"] }));
  assert.deepEqual(store.getAlternatives("#old"), ["#new"]);
  assert.equal(typeof store.data["#old"].lastUsed, "number");
});
test("locator cache recovers from corrupt JSON", (t) =>
  assert.deepEqual(storeAt(t, "{").data, {}));
test("locator cache evicts least recently used entry at 500 keys", async (t) => {
  const store = storeAt(t);
  for (let i = 0; i < 500; i++)
    store.data[`#${i}`] = { alternatives: ["#x"], lastUsed: i };
  store.addLocator("#new", "#replacement");
  await store._queue;
  assert.equal(Object.keys(store.data).length, 500);
  assert.equal(store.data["#0"], undefined);
});
test("locator cache tolerates write errors", async (t) => {
  const store = storeAt(t);
  fs.writeFileSync(path.dirname(store.storePath), "blocked");
  store.addLocator("#old", "#new");
  await store._queue;
  assert.deepEqual(store.getAlternatives("#old"), ["#new"]);
});
function healer(page, alternatives = []) {
  const events = [],
    saved = [];
  const Healer = load("src/core/AIHealer/AIHealer.js", {
    "../../../utils/Logger": silent,
    "./LocatorStore": {
      getAlternatives: () => alternatives,
      addLocator: (...args) => saved.push(args),
    },
    "./HealingReport": { log: (e) => events.push(e) },
    "./AdaptiveRetry": Retry,
  });
  const instance = new Healer(page);
  instance._retry = new Retry({ baseDelayMs: 0 });
  return { instance, events, saved };
}
test("direct healing succeeds without inference or persistence", async () => {
  let clicked;
  const { instance, events, saved } = healer({
    waitForSelector: async () => {},
    click: async (s) => {
      clicked = s;
    },
  });
  instance.getAlternativeSelector = () => assert.fail("unexpected inference");
  await instance.healAndClick("#original");
  assert.equal(clicked, "#original");
  assert.equal(events.length, 0);
  assert.equal(saved.length, 0);
});
test("stored alternatives are attempted in order and logged", async () => {
  const clicked = [];
  const { instance, events } = healer(
    {
      waitForSelector: async () => {
        throw Error("invalid selector");
      },
      click: async (s) => {
        clicked.push(s);
        if (s === "#bad") throw Error("missing");
      },
    },
    ["#bad", "#good"],
  );
  instance.getAlternativeSelector = () => assert.fail("unexpected inference");
  await instance.healAndClick("#old", "Save");
  assert.deepEqual(clicked, ["#bad", "#good"]);
  assert.equal(events[0].tier, "LocatorStore");
  assert.equal(events[0].resolved, "#good");
});
test("inferred locator is clicked then persisted and audited", async () => {
  const clicked = [];
  const { instance, events, saved } = healer({
    click: async (s) => clicked.push(s),
  });
  instance.getAlternativeSelector = async () => "#new";
  await instance.healSelector("#old", "Save");
  assert.deepEqual(clicked, ["#new"]);
  assert.deepEqual(saved, [["#old", "#new"]]);
  assert.equal(events[0].resolved, "#new");
});
for (const suggestion of [null, "#bad"]) {
  test(`failed inference ${suggestion} rejects and never poisons cache`, async () => {
    const { instance, events, saved } = healer({
      click: async () => {
        throw Error("not clickable");
      },
    });
    instance.getAlternativeSelector = async () => suggestion;
    await assert.rejects(instance.healSelector("#old", "Save"));
    assert.equal(saved.length, 0);
    assert.equal(events[0].resolved, null);
  });
}
for (const [content, expected] of [
  [" #new ", "#new"],
  ["null", null],
  ["", null],
  [undefined, null],
]) {
  test(`inference response normalization: ${String(content)}`, async () => {
    const { instance } = healer({ evaluate: async () => '<button id="new">' });
    instance._getOpenAIClient = async () => ({
      chat: {
        completions: {
          create: async (request) => {
            assert.ok(request.messages[0].content.includes("#old"));
            assert.equal(request.temperature, 0);
            return { choices: [{ message: { content } }] };
          },
        },
      },
    });
    assert.equal(await instance.getAlternativeSelector("#old"), expected);
  });
}
test("provider error becomes unresolved selector", async () => {
  const { instance } = healer({});
  instance._getOpenAIClient = async () => {
    throw Error("unavailable");
  };
  assert.equal(await instance.getAlternativeSelector("#old"), null);
});
test("missing provider credentials fail with an actionable message", async (t) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });
  const { instance } = healer({});
  await assert.rejects(instance._getOpenAIClient(), /not set/);
});
test("cached provider client is reused", async () => {
  const { instance } = healer({});
  const client = {};
  instance._openai = client;
  assert.equal(await instance._getOpenAIClient(), client);
});
test("healing audit writes every queued event and forwards lifecycle events", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const emitted = [];
  const Report = load("src/core/AIHealer/HealingReport.js", {
    "../Middleware": { emit: (...e) => emitted.push(e) },
  });
  Report._instance.filePath = path.join(dir, "audit/events.json");
  for (let i = 0; i < 20; i++)
    Report.log({ original: `#${i}`, resolved: "#new", tier: "LocatorStore" });
  await Report._instance._queue;
  const events = JSON.parse(fs.readFileSync(Report._instance.filePath));
  assert.equal(events.length, 20);
  assert.equal(emitted.length, 20);
  assert.equal(events[19].original, "#19");
});
