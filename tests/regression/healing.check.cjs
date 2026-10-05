const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, silent, temp, root } = require("./helpers.cjs");
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
// Phase 14 (AC-07): LocatorStore's corrupt-file recovery used to be
// completely silent (`catch { /* Corrupt store — start fresh */ }`) — this
// test previously asserted only `.data` came back as `{}`, which passed
// *because* recovery was silent. That is no longer sufficient: recovery
// must now also be visible (a Logger.warning naming the path and failure)
// and the corrupt bytes must be preserved as a sidecar for inspection, per
// AtomicJsonStore's existing readJsonSync contract that LocatorStore now
// shares. This is a required, intended behaviour change (silent -> visible
// recovery) — the assertion is strictly stronger than before, not weakened.
test("locator cache recovers from corrupt JSON, logging a warning and preserving a sidecar", (t) => {
  const RealLogger = require(path.join(root, "utils", "Logger.js"));
  const realWarning = RealLogger.warning;
  const warnings = [];
  RealLogger.warning = (m) => warnings.push(m);
  t.after(() => { RealLogger.warning = realWarning; });

  const store = storeAt(t, "{");
  assert.deepEqual(store.data, {}, "functional recovery to {} still happens");

  assert.ok(
    warnings.some((w) => w.includes(store.storePath) && w.toLowerCase().includes("invalid json")),
    "a warning naming the store path and the failure kind must fire",
  );
  // Never log the parser's own message or the file contents — V8's
  // JSON.parse error quotes a snippet of the offending input.
  assert.ok(!warnings.some((w) => w.includes("{") && !w.includes("locator_store") && !w.includes(path.basename(store.storePath))),
    "the corrupt file's raw content must never appear in the warning");

  const dir = path.dirname(store.storePath);
  const sidecars = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
  assert.equal(sidecars.length, 1, "exactly one corrupt sidecar must be preserved");
  assert.equal(fs.readFileSync(path.join(dir, sidecars[0]), "utf8"), "{", "the sidecar preserves the original corrupt bytes");
});
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
function healer(page, alternatives = [], reviewed = []) {
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
    "./HealingTrust": { recordPending: (e) => pending.push(e), recordTier3Invocation: () => {} },
    "./AdaptiveRetry": Retry,
  });
  const salt = "healing-regression-salt";
  const Signature = require(path.join(root, "src/core/locator/ElementSignature.js"));
  const facts = { tagName: "input", role: "textbox", accessibleName: "Field", ownText: "", attributes: { "data-testid": "reviewed-field", type: "text" }, structuralPath: ["form"], boundingBoxBucket: "top-left:small", state: { hidden: false, disabled: false, readonly: false } };
  const signature = Signature.capture(facts, { salt });
  const memory = {
    salt, getTrusted: () => reviewed.length ? { signature } : null,
    getApprovedAlternatives: identity => identity.action === "type" ? reviewed.map(selector => ({ selector, signature })) : [],
    recordEvidence() { assert.fail("healing must not manufacture ground-truth evidence"); },
    recordPendingCandidate() {},
  };
  const instance = new Healer(page, { locatorMemory: memory, elementFactsCollector: {
    collect: async () => reviewed.length ? [{ ...facts, selector: reviewed[0] }] : [],
    collectOne: async () => reviewed.length ? facts : null,
  } });
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
test("legacy selector-only alternatives cannot authorize automatic replay", async () => {
  const clicked = [];
  const { instance, events } = healer({
    waitForSelector: async () => { throw Error("invalid selector"); },
    click: async selector => clicked.push(selector),
  }, ["#bad", "#good"]);
  instance.getAlternativeSelector = async () => null;
  await assert.rejects(instance.healAndClick("#old", "Save"), { code: "TARGET_UNAVAILABLE" });
  assert.deepEqual(clicked, []);
  assert.ok(events.every(event => event.tier !== "LocatorStore"));
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
  assert.deepEqual(pending, [{ original: "#old", suggested: "#new", description: "Save", scoped: false }]);
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
test("Phase 11: no inference at all rejects with a message that says healing was attempted, not a bare selector miss", async () => {
  const { instance } = healer({ click: async () => {} });
  instance.getAlternativeSelector = async () => null;
  await assert.rejects(instance.healSelector("#old-field", "Field"), /after healing/);
});
test("Phase 11: a healed attempt that also fails rejects with the healed selector and underlying reason, not a bare Playwright timeout string", async () => {
  const { instance } = healer({
    fill: async () => {
      throw Error("Timeout 2000ms exceeded waiting for selector");
    },
  });
  instance.getAlternativeSelector = async () => "#new-field";
  const rejection = await instance.healAndType("#old-field", "value", "Field").catch((e) => e);
  assert.match(rejection.message, /after healing/);
  assert.match(rejection.message, /#new-field/);
  // The original error is not discarded: its text is still present (so
  // AdaptiveRetry.classify() — which matches on substrings like "timeout" —
  // still classifies it correctly) and available via `cause` for anyone
  // inspecting the error object directly.
  assert.match(rejection.message, /Timeout 2000ms exceeded/);
  assert.equal(rejection.cause?.message, "Timeout 2000ms exceeded waiting for selector");
});

// ── Phase 11: healing for every action, not just click ──

test("Phase 11: healAndType succeeds directly via fill, no inference", async () => {
  let filled;
  const { instance, events } = healer({
    waitForSelector: async () => {},
    fill: async (s, v) => {
      filled = [s, v];
    },
  });
  instance.getAlternativeSelector = () => assert.fail("unexpected inference");
  await instance.healAndType("#field", "hello", "Field");
  assert.deepEqual(filled, ["#field", "hello"]);
  assert.equal(events.length, 0);
});
test("Phase 11: healAndSelect succeeds directly via selectOption, no inference", async () => {
  let selected;
  const { instance, events } = healer({
    waitForSelector: async () => {},
    selectOption: async (s, v) => {
      selected = [s, v];
    },
  });
  instance.getAlternativeSelector = () => assert.fail("unexpected inference");
  await instance.healAndSelect("#choice", "it", "Country");
  assert.deepEqual(selected, ["#choice", "it"]);
  assert.equal(events.length, 0);
});
test("Phase 11: scoped approved type alternative performs the actual fill", async () => {
  const filled = [];
  const { instance, events } = healer(
    {
      waitForSelector: async () => {
        throw Error("gone");
      },
      url: () => "https://example.com/form",
      fill: async (s, v) => {
        filled.push([s, v]);
      },
    },
    [], ["#new-field"],
  );
  await instance.healAndType("#old-field", "value", "Field");
  assert.deepEqual(filled, [["#new-field", "value"]]);
  assert.equal(events.at(-1).tier, "LocatorMemory");
  assert.equal(events[0].action, "type");
});
test("Phase 11: Tier 3 inferred locator for select performs the actual selectOption, and goes to trust review, not LocatorStore", async () => {
  const selected = [];
  const { instance, events, saved, pending } = healer({
    selectOption: async (s, v) => selected.push([s, v]),
  });
  instance.getAlternativeSelector = async () => "#new-choice";
  await instance.healAndSelect("#old-choice", "it", "Country");
  assert.deepEqual(selected, [["#new-choice", "it"]]);
  // Same trust gate as click: an unreviewed Tier 3 guess is never written
  // straight to LocatorStore, whichever action it healed.
  assert.equal(saved.length, 0);
  assert.deepEqual(pending, [
    { original: "#old-choice", suggested: "#new-choice", description: "Country", scoped: false },
  ]);
  assert.equal(events[0].tier, "LLM");
  assert.equal(events[0].trust, "pending");
  assert.equal(events[0].action, "select");
});
test("Phase 11: scoped approved type alternatives require live uniqueness", async () => {
  const filled = [];
  const { instance } = healer(
    {
      waitForSelector: async () => {
        throw Error("gone");
      },
      url: () => "https://example.com/form",
      fill: async (s, v) => filled.push([s, v]),
      locator: (sel) => ({ count: async () => (sel === "#ambiguous" ? 2 : 1) }),
    },
    [], ["#ambiguous", "#unique"],
  );
  await instance.healAndType("#old", "value", "Field");
  assert.deepEqual(filled, [["#unique", "value"]]);
});
test("Phase 11: healAndClick keeps its existing two-argument signature and still records action:'click'", async () => {
  const { instance, events } = healer({
    click: async () => {},
  });
  instance.getAlternativeSelector = async () => "#new";
  await instance.healAndClick("#old", "Save");
  assert.equal(events[0].action, "click");
});
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
test("Phase 11: an entry logged with an action persists it to disk and the emitted event", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const emitted = [];
  const Report = load("src/core/AIHealer/HealingReport.js", {
    "../Middleware": { emit: (...e) => emitted.push(e) },
  });
  Report._instance.filePath = path.join(dir, "audit/events.json");
  Report.log({ original: "#old", resolved: "#new", tier: "LocatorStore", action: "type" });
  await Report._instance._queue;
  const events = JSON.parse(fs.readFileSync(Report._instance.filePath));
  assert.equal(events[0].action, "type");
  assert.equal(emitted[0][1].action, "type");
});
test("Phase 11: an entry logged without an action keeps today's exact shape — no action key at all", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Report = load("src/core/AIHealer/HealingReport.js", {
    "../Middleware": { emit: () => {} },
  });
  Report._instance.filePath = path.join(dir, "audit/events.json");
  Report.log({ original: "#old", resolved: "#new", tier: "LocatorStore" });
  await Report._instance._queue;
  const events = JSON.parse(fs.readFileSync(Report._instance.filePath));
  assert.deepEqual(Object.keys(events[0]).sort(), ["description", "original", "resolved", "tier", "timestamp"]);
  assert.equal("action" in events[0], false);
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
  const warnings = [];
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: (...args) => added.push(args) },
    "../Middleware": { emit: (...args) => emitted.push(args) },
    "../../../utils/Logger": { info() {}, error() {}, async flush() {}, warning: (m) => warnings.push(m) },
  });
  Trust.pendingPath = path.join(dir, "healing_pending.json");
  Trust.decisionsPath = path.join(dir, "healing_decisions.json");
  Trust._reload();
  return { trust: Trust, added, emitted, warnings };
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

test("healing trust: a later sighting without a description keeps the one the reviewer already has", (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#old", suggested: "#new", description: "Save order" });
  const second = trust.recordPending({ original: "#old", suggested: "#newer" });
  assert.equal(second.description, "Save order");
  assert.equal(trust.list()[0].description, "Save order");
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

// ── Phase 13: decisions can't rot ──

test("healing trust: unreviewedStale boundary — exactly at threshold is NOT stale, one ms past is stale", (t) => {
  const { trust } = trustAt(t);
  const now = Date.parse("2024-06-01T00:00:00.000Z");
  const thresholdDays = 14;
  const exactMs = now - thresholdDays * 86400000;
  const pastMs = exactMs - 1;
  trust.recordPending({ original: "#exact", suggested: "#x" });
  trust.pending["#exact"].firstSeen = new Date(exactMs).toISOString();
  trust.recordPending({ original: "#past", suggested: "#y" });
  trust.pending["#past"].firstSeen = new Date(pastMs).toISOString();

  const result = trust.unreviewedStale({ thresholdDays, now });
  assert.deepEqual(result.notStale.map((e) => e.original), ["#exact"]);
  assert.deepEqual(result.stale.map((e) => e.original), ["#past"]);
});

test("healing trust: unreviewedStale treats a missing/unparseable firstSeen as notStale, never crashing", (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#missing", suggested: "#y" });
  delete trust.pending["#missing"].firstSeen;
  trust.recordPending({ original: "#garbage", suggested: "#z" });
  trust.pending["#garbage"].firstSeen = "not-a-date";

  const result = trust.unreviewedStale({ thresholdDays: 1, now: Date.now() });
  assert.deepEqual(result.stale, []);
  assert.equal(result.notStale.length, 2);
});

test("healing trust: previouslyRejected identity requires an exact (original, suggested) pair match — no normalisation", async (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#old", suggested: "#new" });
  trust.reject("#old");
  await trust._queue;

  const exact = trust.recordPending({ original: "#old", suggested: "#new" });
  assert.equal(exact.previouslyRejected.count, 1);

  const differentSuggested = trust.recordPending({ original: "#old", suggested: "#new2" });
  assert.equal(differentSuggested.previouslyRejected.count, 0);

  const caseMismatch = trust.recordPending({ original: "#OLD", suggested: "#new" });
  assert.equal(caseMismatch.previouslyRejected.count, 0);

  const whitespaceMismatch = trust.recordPending({ original: "#old ", suggested: "#new" });
  assert.equal(whitespaceMismatch.previouslyRejected.count, 0);
});

test("healing trust: previouslyRejected.lastRejectedAt/By come from the LAST ledger row in array order, never sorted by decidedAt", (t) => {
  const { trust } = trustAt(t);
  trust.decisions = [
    { original: "#old", suggested: "#new", decision: "rejected", decidedAt: "2024-06-01T00:00:00.000Z", decidedBy: "alice" },
    { original: "#old", suggested: "#new", decision: "rejected", decidedAt: "2020-01-01T00:00:00.000Z", decidedBy: "bob" },
  ];
  trust._buildRejectionIndex();
  const entry = trust.recordPending({ original: "#old", suggested: "#new" });
  assert.equal(entry.previouslyRejected.count, 2);
  // If a sort-by-date were introduced, this would read "alice"/2024 instead —
  // the array's second (later-appended) row must win regardless of its date.
  assert.equal(entry.previouslyRejected.lastRejectedAt, "2020-01-01T00:00:00.000Z");
  assert.equal(entry.previouslyRejected.lastRejectedBy, "bob");
});

test("healing trust: malformed decision rows are skipped without throwing or corrupting other pairs' rejection counts", (t) => {
  const { trust } = trustAt(t);
  trust.decisions = [
    null,
    "not an object",
    { original: 123, suggested: "#new", decision: "rejected", decidedAt: "2024-01-01T00:00:00.000Z" },
    { original: "#old", suggested: "#new", decision: "pending", decidedAt: "2024-01-01T00:00:00.000Z" },
    { original: "#old", suggested: "#new", decision: "rejected", decidedAt: "not-a-date" },
    // Valid but missing decidedBy — must still count, contributing lastRejectedBy: null.
    { original: "#old", suggested: "#new", decision: "rejected", decidedAt: "2024-01-01T00:00:00.000Z" },
    { original: "#other", suggested: "#fix", decision: "rejected", decidedAt: "2024-02-01T00:00:00.000Z", decidedBy: "carol" },
  ];
  assert.doesNotThrow(() => trust._buildRejectionIndex());

  const oldEntry = trust.recordPending({ original: "#old", suggested: "#new" });
  assert.equal(oldEntry.previouslyRejected.count, 1);
  assert.equal(oldEntry.previouslyRejected.lastRejectedBy, null);

  const otherEntry = trust.recordPending({ original: "#other", suggested: "#fix" });
  assert.equal(otherEntry.previouslyRejected.count, 1);
  assert.equal(otherEntry.previouslyRejected.lastRejectedBy, "carol");
});

test("healing trust: tier3Invocations is 1 for a brand-new pending entry after exactly one recordTier3Invocation, and persists across reload", async (t) => {
  const { trust } = trustAt(t);
  trust.recordTier3Invocation("#sel");
  const entry = trust.recordPending({ original: "#sel", suggested: "#fix" });
  assert.equal(entry.tier3Invocations, 1);
  await trust._queue;
  trust._reload();
  assert.equal(trust.list()[0].tier3Invocations, 1);
});

test("healing trust: occurrences and tier3Invocations diverge when a selector recurs without a fresh Tier3 invocation", (t) => {
  const { trust } = trustAt(t);
  trust.recordTier3Invocation("#sel");
  const first = trust.recordPending({ original: "#sel", suggested: "#fix" });
  assert.equal(first.occurrences, 1);
  assert.equal(first.tier3Invocations, 1);

  // Second sighting of the same selector without an intervening recordTier3Invocation:
  // occurrences grows, tier3Invocations does not.
  const second = trust.recordPending({ original: "#sel", suggested: "#fix2" });
  assert.equal(second.occurrences, 2);
  assert.equal(second.tier3Invocations, 1);
});

test("healing trust: recordTier3Invocation on an existing pending entry bumps tier3Invocations in place and persists it", async (t) => {
  const { trust } = trustAt(t);
  // recordPending() alone already seeds tier3Invocations at 1 (the request
  // that produced this very entry) — two further recordTier3Invocation
  // calls on the now-existing entry bump it to 3, not 2.
  trust.recordPending({ original: "#sel", suggested: "#fix" });
  trust.recordTier3Invocation("#sel");
  trust.recordTier3Invocation("#sel");
  await trust._queue;
  assert.equal(trust.pending["#sel"].tier3Invocations, 3);
  trust._reload();
  assert.equal(trust.list()[0].tier3Invocations, 3);
});

test("healing trust: recordTier3Invocation for a selector with no pending entry is a no-op — no tally, no entry created, no write queued", async (t) => {
  const { trust } = trustAt(t);
  const before = JSON.stringify(trust.pending);
  trust.recordTier3Invocation("#never-pending");
  await trust._queue;
  assert.equal(JSON.stringify(trust.pending), before, "pending is untouched");
  assert.equal(trust._hasPending("#never-pending"), false);
  // If this selector later does produce a pending entry, it starts fresh at
  // 1 (the request that produced it) — the earlier no-op call left nothing
  // behind to fold in.
  const entry = trust.recordPending({ original: "#never-pending", suggested: "#fix" });
  assert.equal(entry.tier3Invocations, 1);
});

test("healing trust: 10,000-row decisions ledger is capped to HEALING_DECISIONS_MAX_ROWS (500) on load AND the trim is persisted to disk, newest retained, exactly one warning, no rewrite on a second reload", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const decisions = Array.from({ length: 10000 }, (_, i) => ({
    original: `#s${i}`, suggested: `#f${i}`, decision: "rejected",
    decidedAt: new Date(i).toISOString(), decidedBy: "seed",
  }));
  const decisionsPath = path.join(dir, "healing_decisions.json");
  fs.writeFileSync(decisionsPath, JSON.stringify(decisions));
  const warnings = [];
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
    "../../../utils/Logger": { info() {}, error() {}, async flush() {}, warning: (m) => warnings.push(m) },
  });
  Trust.pendingPath = path.join(dir, "healing_pending.json");
  Trust.decisionsPath = decisionsPath;
  Trust._reload();
  assert.equal(Trust.decisions.length, 500, "in-memory array is capped immediately on load");
  assert.equal(Trust.decisions[0].original, "#s9500", "first retained row is original row 9500");
  assert.equal(Trust.decisions[499].original, "#s9999", "last retained row is original row 9999");
  assert.equal(warnings.length, 1);

  // The trim must be PERSISTED, not just held in memory — a read-only or
  // read-mostly install that never calls approve()/reject() again must
  // still end up with a bounded file on disk.
  await Trust._queue;
  const onDisk = JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
  assert.equal(onDisk.length, 500, "the persisted file must also be capped, not left at 10,000");
  assert.equal(onDisk[0].original, "#s9500");
  assert.equal(onDisk[499].original, "#s9999");

  // A second _reload() over the now-capped, already-persisted file must
  // stay at 500 and must NOT emit a second oversized-load warning.
  Trust._reload();
  assert.equal(Trust.decisions.length, 500);
  assert.equal(warnings.length, 1, "reloading an already-capped file must not warn again");
});

test("healing trust: a decisions file containing exactly HEALING_DECISIONS_MAX_ROWS (500) rows is not rewritten on load", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const decisions = Array.from({ length: 500 }, (_, i) => ({
    original: `#s${i}`, suggested: `#f${i}`, decision: "rejected",
    decidedAt: new Date(i).toISOString(), decidedBy: "seed",
  }));
  const decisionsPath = path.join(dir, "healing_decisions.json");
  fs.writeFileSync(decisionsPath, JSON.stringify(decisions));
  const warnings = [];
  let writeCalls = 0;
  const RealAtomicJsonStore = require(path.join(root, "src", "core", "util", "AtomicJsonStore.js"));
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
    "../../../utils/Logger": { info() {}, error() {}, async flush() {}, warning: (m) => warnings.push(m) },
    "../util/AtomicJsonStore": {
      readJsonSync: RealAtomicJsonStore.readJsonSync,
      writeJsonAtomic: (...args) => {
        writeCalls++;
        return RealAtomicJsonStore.writeJsonAtomic(...args);
      },
      WriteFailureTracker: RealAtomicJsonStore.WriteFailureTracker,
    },
  });
  Trust.pendingPath = path.join(dir, "healing_pending.json");
  Trust.decisionsPath = decisionsPath;
  Trust._reload();

  assert.equal(Trust.decisions.length, 500, "load at exactly the cap is unchanged");
  assert.equal(warnings.length, 0, "no oversized-load warning fires when nothing is over cap");
  await Trust._queue;
  assert.equal(writeCalls, 0, "no rewrite is queued when the decisions ledger was not over cap");
});

test("healing trust: a single _reload() with BOTH pending (>200) and decisions (>500) oversized queues two writes to two different paths, and both land correctly capped", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const pendingObj = {};
  for (let i = 0; i < 10000; i++) {
    pendingObj[`#p${i}`] = {
      original: `#p${i}`, suggested: `#pf${i}`, description: "",
      firstSeen: new Date(i).toISOString(), lastSeen: new Date(i).toISOString(), occurrences: 1,
    };
  }
  const pendingPath = path.join(dir, "healing_pending.json");
  fs.writeFileSync(pendingPath, JSON.stringify(pendingObj));

  const decisions = Array.from({ length: 10000 }, (_, i) => ({
    original: `#d${i}`, suggested: `#df${i}`, decision: "rejected",
    decidedAt: new Date(i).toISOString(), decidedBy: "seed",
  }));
  const decisionsPath = path.join(dir, "healing_decisions.json");
  fs.writeFileSync(decisionsPath, JSON.stringify(decisions));

  const warnings = [];
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
    "../../../utils/Logger": { info() {}, error() {}, async flush() {}, warning: (m) => warnings.push(m) },
  });
  Trust.pendingPath = pendingPath;
  Trust.decisionsPath = decisionsPath;
  Trust._reload();

  // Both ledgers capped in memory immediately.
  assert.equal(Object.keys(Trust.pending).length, 200);
  assert.equal(Trust.decisions.length, 500);
  // Two distinct oversized-load warnings, one per ledger.
  assert.equal(warnings.filter((w) => w.includes("PENDING_MAX_ENTRIES")).length, 1);
  assert.equal(warnings.filter((w) => w.includes("HEALING_DECISIONS_MAX_ROWS")).length, 1);

  await Trust._queue;

  const pendingOnDisk = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  assert.equal(Object.keys(pendingOnDisk).length, 200, "pending file is capped on disk");
  assert.ok(Object.hasOwn(pendingOnDisk, "#p9999"), "newest pending entry survives");
  assert.ok(!Object.hasOwn(pendingOnDisk, "#p0"), "oldest pending entry is evicted");

  const decisionsOnDisk = JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
  assert.equal(decisionsOnDisk.length, 500, "decisions file is capped on disk");
  assert.equal(decisionsOnDisk[0].original, "#d9500");
  assert.equal(decisionsOnDisk[499].original, "#d9999");

  // Neither write skipped nor overwrote the other: pendingPath still holds
  // only pending-shaped data (an object keyed by selector) and decisionsPath
  // still holds only decisions-shaped data (an array of decision rows) —
  // if the two writes had landed on the wrong path, one file would contain
  // the other's shape/content instead.
  assert.equal(typeof pendingOnDisk, "object");
  assert.equal(Array.isArray(pendingOnDisk), false);
  assert.ok(Array.isArray(decisionsOnDisk));
});

test("healing trust: pending queue never exceeds PENDING_MAX_ENTRIES (200) after mutation, evicting the oldest lastSeen first, and logs it", (t) => {
  const { trust, warnings } = trustAt(t);
  for (let i = 0; i < 200; i++) {
    const entry = trust.recordPending({ original: `#s${i}`, suggested: `#f${i}` });
    entry.lastSeen = new Date(i).toISOString(); // deterministic recency ordering
    trust.pending[`#s${i}`] = entry;
  }
  assert.equal(Object.keys(trust.pending).length, 200);

  trust.recordPending({ original: "#newest", suggested: "#newest-fix" });
  assert.equal(Object.keys(trust.pending).length, 200, "cap is never exceeded after mutation");
  assert.equal(trust._hasPending("#s0"), false, "oldest lastSeen must be evicted first");
  assert.equal(trust._hasPending("#s1"), true);
  assert.equal(trust._hasPending("#newest"), true);
  const evictionWarning = warnings.find((w) => w.includes("PENDING_MAX_ENTRIES"));
  assert.ok(evictionWarning && evictionWarning.includes("#s0"));
  // A small eviction (here, exactly 1 entry — well under the 10-identity
  // sample) must list it in full and must NOT append a misleading "and N
  // more" when nothing was actually left out.
  assert.ok(!evictionWarning.includes("more"), "must not claim more were evicted than actually were");
});

test("healing trust: an oversized pending file (10,000 entries) is trimmed to PENDING_MAX_ENTRIES on load AND the trim is persisted to disk, newest by lastSeen retained, eviction logged without leaking descriptions", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pendingObj = {};
  for (let i = 0; i < 10000; i++) {
    pendingObj[`#s${i}`] = {
      original: `#s${i}`, suggested: `#f${i}`, description: `SECRETDESC${i}`,
      // Ascending lastSeen: higher i is newer, so the retained window is
      // predictable (#s9800..#s9999) and the evicted window is everything
      // below it.
      firstSeen: new Date(i).toISOString(), lastSeen: new Date(i).toISOString(), occurrences: 1,
    };
  }
  const pendingPath = path.join(dir, "healing_pending.json");
  fs.writeFileSync(pendingPath, JSON.stringify(pendingObj));
  const warnings = [];
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
    "../../../utils/Logger": { info() {}, error() {}, async flush() {}, warning: (m) => warnings.push(m) },
  });
  Trust.pendingPath = pendingPath;
  Trust.decisionsPath = path.join(dir, "healing_decisions.json");
  Trust._reload();

  // The in-memory map is bounded synchronously, before any write completes.
  assert.equal(Object.keys(Trust.pending).length, 200, "in-memory pending is capped immediately on load");
  assert.equal(Trust._hasPending("#s9999"), true, "newest entry must survive");
  assert.equal(Trust._hasPending("#s9800"), true, "the whole newest-200 window must survive");
  assert.equal(Trust._hasPending("#s9799"), false, "just outside the newest-200 window must be evicted");
  assert.equal(Trust._hasPending("#s0"), false, "oldest entry must be evicted");

  // Every eviction is logged, naming a real evicted identity, and the
  // operator-supplied description text must never appear in the log.
  const evictionWarning = warnings.find((w) => w.includes("PENDING_MAX_ENTRIES"));
  assert.ok(evictionWarning && evictionWarning.includes("#s0"));
  assert.ok(!warnings.some((w) => w.includes("SECRETDESC")), "eviction warning must never leak description text");

  // 9,800 entries were evicted (10,000 - 200 kept). The message must stay
  // bounded — at most 10 identities enumerated, plus an explicit statement
  // of how many further entries were evicted — never the old one-line-per-
  // evicted-entry flood (previously measured at 273,491 characters for this
  // exact scenario).
  assert.ok(
    evictionWarning.length < 2000,
    `eviction warning must be bounded, was ${evictionWarning.length} chars`,
  );
  const listedIdentities = evictionWarning.match(/"#s\d+"/g) ?? [];
  assert.equal(listedIdentities.length, 10, "at most 10 identities are enumerated");
  // The 10 listed must be the first 10 in eviction order (oldest lastSeen
  // first, i.e. #s0..#s9) so the message is deterministic across runs.
  for (let i = 0; i < 10; i++) {
    assert.ok(evictionWarning.includes(`"#s${i}"`), `#s${i} must be among the first 10 listed`);
  }
  assert.ok(
    evictionWarning.includes("9790 more"),
    "message must explicitly state how many further entries were evicted beyond the listed 10",
  );
  assert.ok(evictionWarning.includes("9800"), "message still states the correct total evicted count");
  assert.ok(evictionWarning.includes("PENDING_MAX_ENTRIES=200"), "message still names the cap constant and value");
  assert.ok(evictionWarning.includes("occurrences:"), "occurrences count is still shown alongside listed identities");

  // The trim must be PERSISTED, not just held in memory — a read-only or
  // read-mostly install that never calls recordPending() again must still
  // end up with a bounded file on disk.
  await Trust._queue;
  const onDisk = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  assert.equal(Object.keys(onDisk).length, 200, "the persisted file must also be capped, not left at 10,000");
  assert.ok(Object.hasOwn(onDisk, "#s9999"));
  assert.ok(!Object.hasOwn(onDisk, "#s0"));
});

test("healing trust: entries with a missing or unparseable lastSeen are evicted before entries with a valid, more recent lastSeen", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pendingObj = {};
  for (let i = 0; i < 200; i++) {
    pendingObj[`#ok${i}`] = {
      original: `#ok${i}`, suggested: `#fix${i}`, description: "",
      firstSeen: new Date(i).toISOString(), lastSeen: new Date(2024, 0, i + 1).toISOString(), occurrences: 1,
    };
  }
  pendingObj["#missing-lastseen"] = {
    original: "#missing-lastseen", suggested: "#fix", description: "",
    firstSeen: new Date().toISOString(), occurrences: 1, // lastSeen intentionally absent
  };
  pendingObj["#garbage-lastseen"] = {
    original: "#garbage-lastseen", suggested: "#fix", description: "",
    firstSeen: new Date().toISOString(), lastSeen: "not-a-date", occurrences: 1,
  };
  const pendingPath = path.join(dir, "healing_pending.json");
  fs.writeFileSync(pendingPath, JSON.stringify(pendingObj));
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  Trust.pendingPath = pendingPath;
  Trust.decisionsPath = path.join(dir, "healing_decisions.json");
  Trust._reload();

  // 202 entries, cap 200: exactly the two entries with no usable recency
  // must be the ones evicted, never one of the 200 with a valid lastSeen.
  assert.equal(Object.keys(Trust.pending).length, 200);
  assert.equal(Trust._hasPending("#missing-lastseen"), false, "no usable recency must be treated as oldest and evicted first");
  assert.equal(Trust._hasPending("#garbage-lastseen"), false, "an unparseable lastSeen must be treated as oldest and evicted first");
  for (let i = 0; i < 200; i++) {
    assert.equal(Trust._hasPending(`#ok${i}`), true, `#ok${i} has a valid lastSeen and must survive`);
  }
});

test("healing trust: a pending file at or under PENDING_MAX_ENTRIES is left completely untouched on load — no trimming, no eviction warning, no rewrite", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pendingObj = {};
  for (let i = 0; i < 200; i++) {
    pendingObj[`#s${i}`] = {
      original: `#s${i}`, suggested: `#f${i}`, description: "",
      firstSeen: new Date(i).toISOString(), lastSeen: new Date(i).toISOString(), occurrences: 1,
    };
  }
  const pendingPath = path.join(dir, "healing_pending.json");
  fs.writeFileSync(pendingPath, JSON.stringify(pendingObj));
  const warnings = [];
  let writeCalls = 0;
  const RealAtomicJsonStore = require(path.join(root, "src", "core", "util", "AtomicJsonStore.js"));
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
    "../../../utils/Logger": { info() {}, error() {}, async flush() {}, warning: (m) => warnings.push(m) },
    "../util/AtomicJsonStore": {
      readJsonSync: RealAtomicJsonStore.readJsonSync,
      writeJsonAtomic: (...args) => {
        writeCalls++;
        return RealAtomicJsonStore.writeJsonAtomic(...args);
      },
      WriteFailureTracker: RealAtomicJsonStore.WriteFailureTracker,
    },
  });
  Trust.pendingPath = pendingPath;
  Trust.decisionsPath = path.join(dir, "healing_decisions.json");
  Trust._reload();

  assert.equal(Object.keys(Trust.pending).length, 200, "load at exactly the cap is unchanged");
  assert.equal(warnings.length, 0, "no eviction warning fires when nothing is over cap");
  await Trust._queue;
  assert.equal(writeCalls, 0, "no rewrite is queued when nothing was evicted");
});

test("healing trust: prototype-unsafe keys (__proto__, constructor, toString) survive load-time trimming of an oversized pending file without polluting the prototype or vanishing", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pendingObj = {};
  const TOTAL = 10000;
  for (let i = 0; i < TOTAL; i++) {
    Object.defineProperty(pendingObj, `#s${i}`, {
      value: {
        original: `#s${i}`, suggested: `#f${i}`, description: "",
        firstSeen: new Date(i).toISOString(), lastSeen: new Date(i).toISOString(), occurrences: 1,
      },
      enumerable: true, configurable: true, writable: true,
    });
  }
  // Give the three prototype-shadowing keys the newest lastSeen of all, so
  // they land inside the retained window — proving they survive trimming,
  // not merely that they don't crash it. Object.defineProperty (rather than
  // bracket assignment) is required for "__proto__": assigning via `obj[k] =
  // v` on a plain object invokes Object.prototype's __proto__ setter and
  // repoints the prototype instead of creating an own property.
  for (const key of ["__proto__", "constructor", "toString"]) {
    Object.defineProperty(pendingObj, key, {
      value: {
        original: key, suggested: `#fix-${key}`, description: "",
        firstSeen: new Date(TOTAL + 1).toISOString(), lastSeen: new Date(TOTAL + 1).toISOString(), occurrences: 1,
      },
      enumerable: true, configurable: true, writable: true,
    });
  }
  const pendingPath = path.join(dir, "healing_pending.json");
  fs.writeFileSync(pendingPath, JSON.stringify(pendingObj));
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  Trust.pendingPath = pendingPath;
  Trust.decisionsPath = path.join(dir, "healing_decisions.json");
  Trust._reload();

  assert.equal(Object.keys(Trust.pending).length, 200);
  assert.equal(Object.getPrototypeOf(Trust.pending), Object.prototype, "no prototype pollution from the trim");
  for (const key of ["__proto__", "constructor", "toString"]) {
    assert.equal(Trust._hasPending(key), true, `${key} must survive trimming, not silently vanish`);
  }

  await Trust._queue;
  const onDisk = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  assert.equal(Object.keys(onDisk).length, 200);
  assert.ok(Object.hasOwn(onDisk, "__proto__"));
});

test("healing trust: prototype-like selectors survive the full P13 lifecycle, including as a rejection-identity pair", async (t) => {
  const { trust, added } = trustAt(t);
  for (const key of ["__proto__", "constructor", "toString"]) {
    trust.recordTier3Invocation(key);
    const entry = trust.recordPending({ original: key, suggested: `#fix-${key}` });
    assert.equal(entry.tier3Invocations, 1);
  }
  assert.equal(trust.list().length, 3);

  trust.reject("__proto__", { rejectedBy: "reviewer" });
  await trust._queue;
  const again = trust.recordPending({ original: "__proto__", suggested: "#fix-__proto__" });
  assert.equal(again.previouslyRejected.count, 1);
  assert.equal(again.previouslyRejected.lastRejectedBy, "reviewer");

  const approved = trust.approve("constructor");
  await trust._queue;
  assert.equal(approved.decision, "approved");
  assert.deepEqual(added, [["constructor", "#fix-constructor"]]);
  assert.equal(Object.getPrototypeOf(trust.pending), Object.prototype);
});

test("healing trust: a write failure (ENOTDIR — path points inside an existing file) does not poison the queue; a subsequent write still succeeds", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const notADirectory = path.join(dir, "not-a-directory");
  fs.writeFileSync(notADirectory, "i am a file, not a directory");
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  Trust.pendingPath = path.join(dir, "pending.json");
  Trust.decisionsPath = path.join(notADirectory, "healing_decisions.json"); // ENOTDIR: parent is a file
  Trust._reload();

  // AtomicJsonStore.writeJsonAtomic logs the failure itself via the real
  // (process-wide) Logger singleton — spy on it directly rather than through
  // HealingTrust's own injected mock, since HealingTrust doesn't re-export
  // AtomicJsonStore's dependency.
  const RealLogger = require(path.join(root, "utils", "Logger.js"));
  const realWarning = RealLogger.warning;
  const warnings = [];
  RealLogger.warning = (m) => warnings.push(m);
  t.after(() => { RealLogger.warning = realWarning; });

  Trust.recordPending({ original: "#old", suggested: "#new" });
  const decision = Trust.approve("#old"); // queues a decisions write that will fail with ENOTDIR
  await Trust._queue;
  assert.equal(decision.decision, "approved", "the in-memory decision still succeeds even though persistence fails");
  assert.ok(warnings.length > 0, "the failed write must be logged");

  // Repoint at a writable path and confirm the (unpoisoned) queue still works.
  Trust.decisionsPath = path.join(dir, "healing_decisions.json");
  Trust.recordPending({ original: "#next", suggested: "#next-fix" });
  const nextDecision = Trust.approve("#next");
  await Trust._queue;
  assert.equal(nextDecision.decision, "approved");
  const onDisk = JSON.parse(fs.readFileSync(Trust.decisionsPath, "utf8"));
  assert.ok(onDisk.some((d) => d.original === "#next"), "the subsequent write must actually land on disk");
});

// ── P13-20 FIX A: tier3Invocations only counts requests actually issued ──

function healerWithRealTrust(t, page) {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Trust = load("src/core/AIHealer/HealingTrust.js", {
    "./LocatorStore": { addLocator: () => {} },
    "../Middleware": { emit: () => {} },
  });
  Trust.pendingPath = path.join(dir, "healing_pending.json");
  Trust.decisionsPath = path.join(dir, "healing_decisions.json");
  Trust._reload();
  const Healer = load("src/core/AIHealer/AIHealer.js", {
    "../../../utils/Logger": silent,
    "./LocatorStore": { getAlternatives: () => [], addLocator: () => {} },
    "./HealingReport": { log: () => {} },
    "./HealingTrust": Trust,
    "./AdaptiveRetry": Retry,
  });
  const salt = "healing-regression-salt";
  const Signature = require(path.join(root, "src/core/locator/ElementSignature.js"));
  const facts = { tagName: "input", role: "textbox", accessibleName: "Field", ownText: "", attributes: { "data-testid": "reviewed-field", type: "text" }, structuralPath: ["form"], boundingBoxBucket: "top-left:small", state: { hidden: false, disabled: false, readonly: false } };
  const signature = Signature.capture(facts, { salt });
  const memory = {
    salt, getTrusted: () => reviewed.length ? { signature } : null,
    getApprovedAlternatives: identity => identity.action === "type" ? reviewed.map(selector => ({ selector, signature })) : [],
    recordEvidence() { assert.fail("healing must not manufacture ground-truth evidence"); },
    recordPendingCandidate() {},
  };
  const instance = new Healer(page, { locatorMemory: memory, elementFactsCollector: {
    collect: async () => reviewed.length ? [{ ...facts, selector: reviewed[0] }] : [],
    collectOne: async () => reviewed.length ? facts : null,
  } });
  instance._retry = new Retry({ baseDelayMs: 0 });
  return { instance, trust: Trust };
}

test("P13-20 FIX A: a Tier 3 attempt that fails at client init (no OPENAI_API_KEY) does not inflate a later successful heal's tier3Invocations", async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });

  const { instance, trust } = healerWithRealTrust(t, { click: async () => {} });

  // Step 1: Tier 3 fails before any model request is ever issued — no
  // OPENAI_API_KEY means _getOpenAIClient() throws before the DOM snapshot
  // or the invocation boundary are ever reached.
  await assert.rejects(instance.healSelector("#old", "Save"));
  assert.equal(trust.list().length, 0, "no pending entry should exist yet");

  // Step 2: the same original selector heals successfully via a real Tier 3
  // request (client init and DOM snapshot both succeed this time).
  instance._getOpenAIClient = async () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "#new" } }] }) } },
  });
  instance.page.evaluate = async () => "<button>";
  await instance.healSelector("#old", "Save");

  const entries = trust.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tier3Invocations, 1, "the failed client-init attempt must not have counted");
});

test("P13-20 FIX A: a Tier 3 attempt whose DOM snapshot throws does not inflate a later successful heal's tier3Invocations", async (t) => {
  const { instance, trust } = healerWithRealTrust(t, { click: async () => {} });
  instance._getOpenAIClient = async () => ({
    chat: { completions: { create: async () => { throw new Error("should not be reached"); } } },
  });
  instance.page.evaluate = async () => { throw new Error("DOM snapshot boom"); };

  await assert.rejects(instance.healSelector("#old2", "Save"));
  assert.equal(trust.list().length, 0, "no pending entry should exist yet");

  instance.page.evaluate = async () => "<button>";
  instance._getOpenAIClient = async () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "#new2" } }] }) } },
  });
  await instance.healSelector("#old2", "Save");

  const entries = trust.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tier3Invocations, 1, "the failed DOM-snapshot attempt must not have counted");
});

test("P13-20 FIX A: a Tier 3 request that is actually issued still counts even when it throws or the model returns null", async (t) => {
  const { instance, trust } = healerWithRealTrust(t, { click: async () => {} });
  instance.page.evaluate = async () => "<button>";

  // First: a successful heal creates the pending entry, seeded at 1.
  instance._getOpenAIClient = async () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "#new3" } }] }) } },
  });
  await instance.healSelector("#old3", "Save");
  assert.equal(trust.pending["#old3"].tier3Invocations, 1);

  // Second: the request IS issued (client init + DOM snapshot both succeed)
  // but the OpenAI call itself throws — this must still count, because the
  // model was genuinely asked.
  instance._getOpenAIClient = async () => ({
    chat: { completions: { create: async () => { throw new Error("rate limited"); } } },
  });
  await assert.rejects(instance.healSelector("#old3", "Save"));
  assert.equal(trust.pending["#old3"].tier3Invocations, 2, "a request that throws after being issued still counts");

  // Third: the request is issued and resolves, but the model says "null".
  instance._getOpenAIClient = async () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "null" } }] }) } },
  });
  await assert.rejects(instance.healSelector("#old3", "Save"));
  assert.equal(trust.pending["#old3"].tier3Invocations, 3, "a request that resolves to null still counts");
});

test("P13-20 FIX A: a second successful Tier 3 heal for the same selector increments tier3Invocations to 2, distinctly from occurrences, and it persists across a reload", async (t) => {
  const { instance, trust } = healerWithRealTrust(t, { click: async () => {} });
  instance.page.evaluate = async () => "<button>";
  instance._getOpenAIClient = async () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "#new4" } }] }) } },
  });
  await instance.healSelector("#old4", "Save");
  await instance.healSelector("#old4", "Save");
  await trust._queue;
  assert.equal(trust.pending["#old4"].tier3Invocations, 2);
  assert.equal(trust.pending["#old4"].occurrences, 2);

  trust._reload();
  assert.equal(trust.list()[0].tier3Invocations, 2);
  assert.equal(trust.list()[0].occurrences, 2);
});

// ── P13-20 FIX B: previouslyRejected is always derived at read time ──

test("P13-20 FIX B: previouslyRejected does not go stale once the original rejection ages out of the capped decisions ledger", async (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#old", suggested: "#new" });
  trust.reject("#old");
  await trust._queue;

  const entry = trust.recordPending({ original: "#old", suggested: "#new" });
  assert.equal(entry.previouslyRejected.count, 1);
  assert.equal(trust.list()[0].previouslyRejected.count, 1);

  // Push HEALING_DECISIONS_MAX_ROWS (500) later decisions so the original
  // "#old"/"#new" rejection is pushed off the newest-500 ledger entirely.
  for (let i = 0; i < 500; i++) {
    trust._pushDecision({
      original: `#filler${i}`, suggested: `#f${i}`, decision: "rejected",
      decidedAt: new Date(2020, 0, i + 1).toISOString(), decidedBy: "filler",
    });
  }
  await trust._queue;
  assert.equal(trust.decisions.length, 500);
  assert.ok(!trust.decisions.some((d) => d.original === "#old"), "sanity: the original rejection is no longer in the ledger");

  const stale = trust.list().find((e) => e.original === "#old");
  assert.equal(stale.previouslyRejected.count, 0, "must report 0, not the stale persisted count of 1");
});

test("P13-20 FIX B: the un-staled previouslyRejected does not come back after a reload either", async (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#old", suggested: "#new" });
  trust.reject("#old");
  await trust._queue;
  trust.recordPending({ original: "#old", suggested: "#new" });
  await trust._queue;

  for (let i = 0; i < 500; i++) {
    trust._pushDecision({
      original: `#filler${i}`, suggested: `#f${i}`, decision: "rejected",
      decidedAt: new Date(2020, 0, i + 1).toISOString(), decidedBy: "filler",
    });
  }
  await trust._queue;

  trust._reload();
  const stale = trust.list().find((e) => e.original === "#old");
  assert.equal(stale.previouslyRejected.count, 0, "staleness must not survive a reload either");
});

test("P13-20 FIX B: a pending entry whose pair was never rejected reports count 0 with null fields from list()", (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#fresh", suggested: "#fresh-fix" });
  const entry = trust.list()[0];
  assert.deepEqual(entry.previouslyRejected, { count: 0, lastRejectedAt: null, lastRejectedBy: null });
});

test("P13-20 FIX B: a fresh rejection recorded after a pending entry already exists is reflected by a later list() (hydration works forward too, not just on eviction)", async (t) => {
  const { trust } = trustAt(t);
  const entry = trust.recordPending({ original: "#old6", suggested: "#new6" });
  assert.equal(entry.previouslyRejected.count, 0);
  assert.equal(trust.list()[0].previouslyRejected.count, 0);

  // A decision row for the exact same pair lands in the ledger after the
  // pending entry's own previouslyRejected snapshot was taken.
  trust._pushDecision({
    original: "#old6", suggested: "#new6", decision: "rejected",
    decidedAt: new Date().toISOString(), decidedBy: "reviewer",
  });
  await trust._queue;

  const hydrated = trust.list().find((e) => e.original === "#old6");
  assert.equal(hydrated.previouslyRejected.count, 1);
  assert.equal(hydrated.previouslyRejected.lastRejectedBy, "reviewer");
});

test("P13-20 FIX B: list() never mutates this.pending", (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#a7", suggested: "#b7" });
  const before = JSON.stringify(trust.pending);
  trust.list();
  const after = JSON.stringify(trust.pending);
  assert.equal(after, before, "list() must be a pure read");
});

test("P13-20 FIX B: approve()/reject() write a freshly hydrated previouslyRejected into the decision row, not the stale persisted one", async (t) => {
  const { trust } = trustAt(t);
  trust.recordPending({ original: "#old8", suggested: "#new8" });
  // A rejection for this exact pair lands in the ledger after the pending
  // entry's own snapshot was taken.
  trust._pushDecision({
    original: "#old8", suggested: "#new8", decision: "rejected",
    decidedAt: new Date().toISOString(), decidedBy: "reviewer",
  });
  await trust._queue;
  // The raw persisted pending entry still carries its stale cached value.
  assert.equal(trust.pending["#old8"].previouslyRejected.count, 0);

  const decision = trust.approve("#old8");
  await trust._queue;
  assert.equal(decision.previouslyRejected.count, 1, "the decision row must reflect the live rejection count, not the stale cache");
});
