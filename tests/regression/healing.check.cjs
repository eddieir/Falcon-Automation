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
  await store._queue;
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
    saved = [],
    pending = [];
  const Healer = load("src/core/AIHealer/AIHealer.js", {
    "../../../utils/Logger": silent,
    "./LocatorStore": {
      getAlternatives: () => alternatives,
      addLocator: (...args) => saved.push(args),
    },
    "./HealingReport": { log: (e) => events.push(e) },
    "./HealingTrust": { recordPending: (e) => pending.push(e) },
    "./AdaptiveRetry": Retry,
  });
  const instance = new Healer(page);
  instance._retry = new Retry({ baseDelayMs: 0 });
  return { instance, events, saved, pending };
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
test("Phase 8: inferred locator is clicked and sent for review, not auto-persisted", async () => {
  const clicked = [];
  const { instance, events, saved, pending } = healer({
    click: async (s) => clicked.push(s),
  });
  instance.getAlternativeSelector = async () => "#new";
  await instance.healSelector("#old", "Save");
  assert.deepEqual(clicked, ["#new"]);
  // Not written to LocatorStore — an unreviewed Tier 3 guess is not trusted
  // for reuse just because it worked once.
  assert.equal(saved.length, 0);
  assert.deepEqual(pending, [{ original: "#old", suggested: "#new", description: "Save" }]);
  assert.equal(events[0].resolved, "#new");
  assert.equal(events[0].trust, "pending");
});
test("Phase 8: healAndClick's default description ('Element') flows through to the pending entry", async () => {
  const { instance, pending } = healer({
    waitForSelector: async () => {
      throw Error("gone");
    },
    click: async () => {},
  });
  instance.getAlternativeSelector = async () => "#new";
  await instance.healAndClick("#old"); // no description argument
  assert.equal(pending[0].description, "Element");
});
test("Phase 8: Tier 3 successes for different selectors in the same run are tracked as separate pending entries", async () => {
  const { instance, pending } = healer({
    click: async () => {},
  });
  const suggestions = { "#a": "#a-fix", "#b": "#b-fix", "#c": "#c-fix" };
  instance.getAlternativeSelector = async (original) => suggestions[original];
  await instance.healSelector("#a", "A");
  await instance.healSelector("#b", "B");
  await instance.healSelector("#c", "C");
  assert.deepEqual(
    pending.map((p) => [p.original, p.suggested]),
    [["#a", "#a-fix"], ["#b", "#b-fix"], ["#c", "#c-fix"]],
  );
});
for (const suggestion of [null, "#bad"]) {
  test(`failed inference ${suggestion} rejects and never poisons cache or pending review`, async () => {
    const { instance, events, saved, pending } = healer({
      click: async () => {
        throw Error("not clickable");
      },
    });
    instance.getAlternativeSelector = async () => suggestion;
    await assert.rejects(instance.healSelector("#old", "Save"));
    assert.equal(saved.length, 0);
    assert.equal(pending.length, 0);
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

test("locator cache ignores malformed entries in otherwise valid JSON", async (t) => {
  const store = storeAt(
    t,
    JSON.stringify({
      "#null": null,
      "#bad": { alternatives: 42 },
      "#good": ["#new"],
    }),
  );
  assert.deepEqual(store.getAlternatives("#null"), []);
  assert.deepEqual(store.getAlternatives("#bad"), []);
  store.addLocator("#null", "#repaired");
  await store._queue;
  assert.deepEqual(store.getAlternatives("#null"), ["#repaired"]);
});
test("locator cache supports selectors matching object prototype keys", async (t) => {
  const store = storeAt(t);
  for (const key of ["constructor", "__proto__", "toString"])
    store.addLocator(key, "#replacement");
  await store._queue;
  for (const key of ["constructor", "__proto__", "toString"])
    assert.deepEqual(store.getAlternatives(key), ["#replacement"]);
});
test("locator reads refresh recency for eviction and cannot mutate stored alternatives", async (t) => {
  const store = storeAt(t);
  store.data["#active"] = { alternatives: ["#new"], lastUsed: 1 };
  const alternatives = store.getAlternatives("#active");
  alternatives.push("#unverified");
  assert.ok(store.data["#active"].lastUsed > 1);
  assert.deepEqual(store.getAlternatives("#active"), ["#new"]);
  await store._queue;
});

// ── Phase 8: HealingTrust (approval gate for Tier 3 fixes) ──

function trustAt(t) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const added = [];
  const emitted = [];
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: (...args) => added.push(args) },
    "../Middleware": { emit: (...args) => emitted.push(args) },
  });
  Trust.pendingPath = path.join(dir, "healing_pending.json");
  Trust.decisionsPath = path.join(dir, "healing_decisions.json");
  Trust._reload();
  return { trust: Trust, added, emitted };
}

test("healing trust records a pending fix and lists it, without touching LocatorStore", (t) => {
  const { trust, added, emitted } = trustAt(t);
  const entry = trust.recordPending({ original: "#old", suggested: "#new", description: "Save" });
  assert.equal(entry.occurrences, 1);
  assert.deepEqual(trust.list(), [entry]);
  assert.equal(added.length, 0);
  assert.deepEqual(emitted, [["healingPending", entry]]);
});

test("healing trust bumps occurrences and lastSeen on repeat sightings, keeping firstSeen", (t) => {
  const { trust } = trustAt(t);
  const first = trust.recordPending({ original: "#old", suggested: "#new" });
  const second = trust.recordPending({ original: "#old", suggested: "#new" });
  assert.equal(second.occurrences, 2);
  assert.equal(second.firstSeen, first.firstSeen);
  assert.equal(trust.list().length, 1);
});

test("healing trust approve writes to LocatorStore, clears pending, and records the decision", async (t) => {
  const { trust, added, emitted } = trustAt(t);
  trust.recordPending({ original: "#old", suggested: "#new", description: "Save" });
  const decision = trust.approve("#old", { approvedBy: "test" });
  await trust._queue;
  assert.deepEqual(added, [["#old", "#new"]]);
  assert.deepEqual(trust.list(), []);
  assert.equal(decision.decision, "approved");
  assert.equal(decision.decidedBy, "test");
  assert.deepEqual(trust.decisions, [decision]);
  assert.ok(emitted.some(([name]) => name === "healingApproved"));
});

test("healing trust reject discards the fix without ever touching LocatorStore", async (t) => {
  const { trust, added } = trustAt(t);
  trust.recordPending({ original: "#old", suggested: "#new" });
  const decision = trust.reject("#old", { rejectedBy: "test" });
  await trust._queue;
  assert.equal(added.length, 0);
  assert.deepEqual(trust.list(), []);
  assert.equal(decision.decision, "rejected");
  assert.deepEqual(trust.decisions, [decision]);
});

test("healing trust approve/reject of an unknown selector is a no-op that returns null", (t) => {
  const { trust, added } = trustAt(t);
  assert.equal(trust.approve("#missing"), null);
  assert.equal(trust.reject("#missing"), null);
  assert.equal(added.length, 0);
});

test("healing trust decisions persist across a reload", async (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#old", suggested: "#new" });
  trust.approve("#old");
  await trust._queue;

  const reloaded = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  reloaded.pendingPath = trust.pendingPath;
  reloaded.decisionsPath = trust.decisionsPath;
  reloaded._reload();
  assert.deepEqual(reloaded.list(), []);
  assert.equal(reloaded.decisions.length, 1);
  assert.equal(reloaded.decisions[0].decision, "approved");
});

test("healing trust recovers from corrupt pending/decisions files instead of crashing", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  Trust.pendingPath = path.join(dir, "pending.json");
  Trust.decisionsPath = path.join(dir, "decisions.json");
  fs.writeFileSync(Trust.pendingPath, "{not json");
  fs.writeFileSync(Trust.decisionsPath, "[not json");
  Trust._reload();
  assert.deepEqual(Trust.list(), []);
  assert.deepEqual(Trust.decisions, []);
});

test("healing trust recovers when pending/decisions files hold the wrong JSON shape", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  Trust.pendingPath = path.join(dir, "pending.json");
  Trust.decisionsPath = path.join(dir, "decisions.json");
  // pending.json must be an object keyed by selector, decisions.json an
  // array — swap them and confirm each falls back cleanly instead of
  // adopting the wrong shape (which would make list()/decisions.push blow up).
  fs.writeFileSync(Trust.pendingPath, JSON.stringify([1, 2, 3]));
  fs.writeFileSync(Trust.decisionsPath, JSON.stringify({ not: "an array" }));
  Trust._reload();
  assert.deepEqual(Trust.list(), []);
  assert.deepEqual(Trust.decisions, []);
  // Both must still be genuinely usable after falling back, not just present.
  assert.doesNotThrow(() => Trust.recordPending({ original: "#x", suggested: "#y" }));
  assert.doesNotThrow(() => Trust.approve("#x"));
});

test("healing trust survives null and non-object JSON at the top level", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  Trust.pendingPath = path.join(dir, "pending.json");
  Trust.decisionsPath = path.join(dir, "decisions.json");
  fs.writeFileSync(Trust.pendingPath, "null");
  fs.writeFileSync(Trust.decisionsPath, "42");
  Trust._reload();
  assert.deepEqual(Trust.list(), []);
  assert.deepEqual(Trust.decisions, []);
});

test("healing trust: repeat recordPending overwrites suggested/description with the latest inference", (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#old", suggested: "#first-guess", description: "first" });
  const second = trust.recordPending({ original: "#old", suggested: "#second-guess", description: "second" });
  assert.equal(second.suggested, "#second-guess");
  assert.equal(second.description, "second");
  assert.equal(trust.list().length, 1);
  assert.equal(trust.list()[0].suggested, "#second-guess");
});

test("healing trust: description defaults to an empty string when omitted", (t) => {
  const { trust } = trustAt(t);
  const entry = trust.recordPending({ original: "#old", suggested: "#new" });
  assert.equal(entry.description, "");
});

test("healing trust: approve/reject default decidedBy to \"dashboard\" when not specified", async (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#a", suggested: "#a2" });
  const approved = trust.approve("#a");
  trust.recordPending({ original: "#b", suggested: "#b2" });
  const rejected = trust.reject("#b");
  await trust._queue;
  assert.equal(approved.decidedBy, "dashboard");
  assert.equal(rejected.decidedBy, "dashboard");
});

test("healing trust: approving twice is a no-op the second time and does not double-write LocatorStore", async (t) => {
  const { trust, added } = trustAt(t);
  trust.recordPending({ original: "#old", suggested: "#new" });
  const first = trust.approve("#old");
  const second = trust.approve("#old");
  await trust._queue;
  assert.equal(first.decision, "approved");
  assert.equal(second, null);
  assert.equal(added.length, 1);
  assert.equal(trust.decisions.length, 1);
});

test("healing trust: rejecting after approving (and vice versa) is a no-op — the entry is already gone", async (t) => {
  const { trust, added } = trustAt(t);
  trust.recordPending({ original: "#a", suggested: "#a2" });
  trust.approve("#a");
  assert.equal(trust.reject("#a"), null);

  trust.recordPending({ original: "#b", suggested: "#b2" });
  trust.reject("#b");
  assert.equal(trust.approve("#b"), null);
  await trust._queue;
  assert.deepEqual(added, [["#a", "#a2"]]); // #b was never approved
});

test("healing trust: approve/reject of an empty string original is a no-op, not a crash", (t) => {
  const { trust, added } = trustAt(t);
  assert.equal(trust.approve(""), null);
  assert.equal(trust.reject(""), null);
  assert.equal(added.length, 0);
});

test("healing trust: recordPending with an empty-string original is tracked like any other selector", (t) => {
  const { trust } = trustAt(t);
  const entry = trust.recordPending({ original: "", suggested: "#fallback" });
  assert.equal(trust.list().length, 1);
  assert.equal(trust.approve("").decision, "approved");
  void entry;
});

test("healing trust: decisions ledger preserves insertion order across multiple selectors", async (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#1", suggested: "#1x" });
  trust.recordPending({ original: "#2", suggested: "#2x" });
  trust.recordPending({ original: "#3", suggested: "#3x" });
  trust.approve("#2");
  trust.reject("#1");
  trust.approve("#3");
  await trust._queue;
  assert.deepEqual(
    trust.decisions.map((d) => [d.original, d.decision]),
    [["#2", "approved"], ["#1", "rejected"], ["#3", "approved"]],
  );
});

test("healing trust: distinct selectors are tracked independently and don't interfere", (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#a", suggested: "#a2" });
  trust.recordPending({ original: "#b", suggested: "#b2" });
  trust.approve("#a");
  const remaining = trust.list();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].original, "#b");
});

// The exact class of bug LocatorStore already guards against (see "locator
// cache supports selectors matching object prototype keys" above):
// HealingTrust's `pending` map is a plain object, and a selector literally
// named "__proto__" through a bare bracket assignment repoints the
// object's own prototype instead of creating a property — silently
// swallowing the entry (list() would return [] for it, forever). CSS
// selectors are arbitrary strings, so this is a real, reachable input.
test("healing trust: selectors matching Object.prototype keys are tracked safely, not silently dropped", async (t) => {
  const { trust, added } = trustAt(t);
  for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    trust.recordPending({ original: key, suggested: `#fix-${key}` });
  }
  assert.equal(trust.list().length, 5);
  assert.deepEqual(
    trust.list().map((e) => e.original).sort(),
    ["__proto__", "constructor", "hasOwnProperty", "toString", "valueOf"].sort(),
  );

  const decision = trust.approve("__proto__");
  await trust._queue;
  assert.equal(decision.decision, "approved");
  assert.deepEqual(added, [["__proto__", "#fix-__proto__"]]);
  assert.equal(trust.list().length, 4);

  // The object itself must still behave like a normal object afterward —
  // no other selector's tracking was corrupted by the __proto__ write.
  assert.equal(Object.getPrototypeOf(trust.pending), Object.prototype);
  assert.equal(trust.reject("constructor").decision, "rejected");
  assert.equal(trust.list().length, 3);
});

test("healing trust: recordPending for __proto__ persists and reloads correctly from disk", async (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "__proto__", suggested: "#fix" });
  await trust._queue;
  const onDisk = JSON.parse(fs.readFileSync(trust.pendingPath, "utf8"));
  assert.ok(Object.hasOwn(onDisk, "__proto__"));
  assert.equal(onDisk.__proto__.suggested, "#fix");

  trust._reload();
  assert.equal(trust.list().length, 1);
  assert.equal(trust.list()[0].original, "__proto__");
});

test("healing trust tolerates write errors without losing in-memory state", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  // Point the "file" path at a directory so every write attempt fails.
  fs.mkdirSync(path.join(dir, "pending.json"));
  Trust.pendingPath = path.join(dir, "pending.json");
  Trust.decisionsPath = path.join(dir, "decisions.json");
  Trust._reload();
  assert.doesNotThrow(() => Trust.recordPending({ original: "#old", suggested: "#new" }));
  await Trust._queue;
  assert.equal(Trust.list().length, 1);
});

test("healing trust: concurrent recordPending calls for the same selector all land without a lost update", async (t) => {
  const { trust } = trustAt(t);
  // Fires several updates before any of the async saves have flushed —
  // proves the serialized _queue doesn't drop or interleave writes.
  for (let i = 0; i < 10; i++) {
    trust.recordPending({ original: "#flaky", suggested: `#fix-${i}` });
  }
  await trust._queue;
  const onDisk = JSON.parse(fs.readFileSync(trust.pendingPath, "utf8"));
  assert.equal(onDisk["#flaky"].occurrences, 10);
  assert.equal(onDisk["#flaky"].suggested, "#fix-9");
});

test("healing trust: concurrent approve calls for different selectors are all persisted", async (t) => {
  const { trust, added } = trustAt(t);
  for (let i = 0; i < 20; i++) {
    trust.recordPending({ original: `#s${i}`, suggested: `#f${i}` });
  }
  for (let i = 0; i < 20; i++) {
    trust.approve(`#s${i}`);
  }
  await trust._queue;
  assert.equal(added.length, 20);
  assert.equal(trust.list().length, 0);
  const onDisk = JSON.parse(fs.readFileSync(trust.decisionsPath, "utf8"));
  assert.equal(onDisk.length, 20);
  assert.ok(onDisk.every((d) => d.decision === "approved"));
});

// ── Phase 8: HealingReport.summary() (reviewable trend) ──

test("healing report summary aggregates occurrences and tiers per selector", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Report = load("src/core/AIHealer/HealingReport.js", {
    "../Middleware": { emit: () => {} },
  });
  Report._instance.filePath = path.join(dir, "audit/events.json");
  Report._instance.logs = [];
  Report.log({ original: "#a", resolved: "#a2", tier: "LocatorStore" });
  Report.log({ original: "#a", resolved: "#a3", tier: "LLM", trust: "pending" });
  Report.log({ original: "#b", resolved: null, tier: "LLM", error: "boom" });
  await Report._instance._queue;

  const summary = Report.summary();
  assert.equal(summary.length, 2);
  const a = summary.find((row) => row.original === "#a");
  assert.equal(a.occurrences, 2);
  assert.deepEqual(a.tiers, { LocatorStore: 1, LLM: 1 });
  assert.equal(a.lastTier, "LLM");
  assert.equal(a.lastResolved, "#a3");
  const b = summary.find((row) => row.original === "#b");
  assert.equal(b.occurrences, 1);
  assert.equal(b.lastResolved, null);
});

test("healing report summary is an empty array when nothing has ever been logged", () => {
  const Report = load("src/core/AIHealer/HealingReport.js", {
    "../Middleware": { emit: () => {} },
  });
  assert.deepEqual(Report.summary(), []);
});

test("healing report summary sorts by occurrences descending, most-recurring selector first", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Report = load("src/core/AIHealer/HealingReport.js", {
    "../Middleware": { emit: () => {} },
  });
  Report._instance.filePath = path.join(dir, "audit/events.json");
  Report.log({ original: "#rare", resolved: "#x", tier: "LocatorStore" });
  Report.log({ original: "#frequent", resolved: "#y", tier: "LocatorStore" });
  Report.log({ original: "#frequent", resolved: "#y", tier: "LocatorStore" });
  Report.log({ original: "#frequent", resolved: "#y", tier: "LocatorStore" });
  await Report._instance._queue;

  const summary = Report.summary();
  assert.equal(summary[0].original, "#frequent");
  assert.equal(summary[0].occurrences, 3);
  assert.equal(summary[1].original, "#rare");
  assert.equal(summary[1].occurrences, 1);
});

test("healing report summary tracks a selector that later resolved via Tier 3 after failing entirely", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Report = load("src/core/AIHealer/HealingReport.js", {
    "../Middleware": { emit: () => {} },
  });
  Report._instance.filePath = path.join(dir, "audit/events.json");
  Report.log({ original: "#flaky", resolved: null, tier: "LLM", error: "ambiguous" });
  Report.log({ original: "#flaky", resolved: "#fixed", tier: "LLM", trust: "pending" });
  await Report._instance._queue;

  const [row] = Report.summary();
  assert.equal(row.occurrences, 2);
  assert.deepEqual(row.tiers, { LLM: 2 });
  assert.equal(row.lastResolved, "#fixed");
});

test("healing report summary handles a large volume of interleaved selectors without losing or misattributing events", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Report = load("src/core/AIHealer/HealingReport.js", {
    "../Middleware": { emit: () => {} },
  });
  Report._instance.filePath = path.join(dir, "audit/events.json");
  const SELECTOR_COUNT = 25;
  const EVENTS_PER_SELECTOR = 12;
  for (let round = 0; round < EVENTS_PER_SELECTOR; round++) {
    for (let i = 0; i < SELECTOR_COUNT; i++) {
      Report.log({ original: `#sel-${i}`, resolved: `#fix-${i}-${round}`, tier: round % 2 === 0 ? "LocatorStore" : "LLM" });
    }
  }
  await Report._instance._queue;

  const summary = Report.summary();
  assert.equal(summary.length, SELECTOR_COUNT);
  assert.ok(summary.every((row) => row.occurrences === EVENTS_PER_SELECTOR));
  assert.ok(summary.every((row) => row.tiers.LocatorStore === EVENTS_PER_SELECTOR / 2));
  assert.ok(summary.every((row) => row.tiers.LLM === EVENTS_PER_SELECTOR / 2));
  const sel0 = summary.find((row) => row.original === "#sel-0");
  assert.equal(sel0.lastResolved, `#fix-0-${EVENTS_PER_SELECTOR - 1}`);
});
