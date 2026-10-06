const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, silent, temp, root } = require("./helpers.cjs");

// Phase 14, slice 1 — the persistence foundation.
//
// Covers:
//   AC-08 — writeJsonAtomic resolves {ok,error} instead of undefined, and
//           never rejects.
//   AC-08 (P1, Q7) — a per-path write-failure tracker so a store chaining
//           two writes in one promise chain (history then decisions) can't
//           have a failed first write masked by a successful second write.
//   AC-06/AC-07 — LocatorStore is migrated onto AtomicJsonStore (covered
//           more fully in healing.check.cjs; this file adds the
//           write-failure-surface assertions).
//   AC-11 — prototype-pollution-safe keying for the new WriteFailureTracker.

const AtomicJsonStore = require(path.join(root, "src", "core", "util", "AtomicJsonStore.js"));

// ── AC-08: writeJsonAtomic's resolved value ──

test("writeJsonAtomic resolves {ok:true} on a successful write", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "nested", "file.json");
  const result = await AtomicJsonStore.writeJsonAtomic(filePath, { a: 1 });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { a: 1 });
});

test("writeJsonAtomic resolves {ok:false, error} on failure and never rejects", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Point the "file" path at a directory so the write can never succeed —
  // same technique existing tests use (healing.check.cjs's "tolerates write
  // errors" tests).
  const blocked = path.join(dir, "blocked");
  fs.mkdirSync(blocked);
  let result;
  await assert.doesNotReject(async () => {
    result = await AtomicJsonStore.writeJsonAtomic(blocked, { a: 1 });
  });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.ok(result.error.length > 0);
});

// ── AC-08 (Q7, P1): per-path WriteFailureTracker ──

test("WriteFailureTracker: a failure on one path is not cleared by a success on a different path", () => {
  const tracker = new AtomicJsonStore.WriteFailureTracker();
  tracker.record("/data/a.json", { ok: false, error: "disk full" });
  tracker.record("/data/b.json", { ok: true });
  assert.equal(tracker.hasUnpersistedWriteFailure(), true);
  assert.equal(tracker.lastWriteError().path, "/data/a.json");
  assert.equal(tracker.lastWriteError().error, "disk full");
});

test("WriteFailureTracker: a later success on the SAME path clears that path's own prior failure", () => {
  const tracker = new AtomicJsonStore.WriteFailureTracker();
  tracker.record("/data/a.json", { ok: false, error: "disk full" });
  assert.equal(tracker.hasUnpersistedWriteFailure(), true);
  tracker.record("/data/a.json", { ok: true });
  assert.equal(tracker.hasUnpersistedWriteFailure(), false);
  assert.equal(tracker.lastWriteError(), null);
});

test("WriteFailureTracker: with no writes recorded, reports healthy", () => {
  const tracker = new AtomicJsonStore.WriteFailureTracker();
  assert.equal(tracker.hasUnpersistedWriteFailure(), false);
  assert.equal(tracker.lastWriteError(), null);
});

// AC-11: prototype-pollution-safe keying. A CSS selector / file path could
// in principle be any string, including these — the tracker uses a Map
// (never a bare object), so these can never repoint Object.prototype or be
// masked by inherited members.
for (const dangerousKey of ["__proto__", "constructor", "prototype"]) {
  test(`WriteFailureTracker: "${dangerousKey}" as a path behaves like any other key, never touches Object.prototype`, () => {
    const tracker = new AtomicJsonStore.WriteFailureTracker();
    tracker.record(dangerousKey, { ok: false, error: "boom" });
    assert.equal(tracker.hasUnpersistedWriteFailure(), true);
    assert.equal(tracker.lastWriteError().path, dangerousKey);
    assert.equal(Object.getPrototypeOf({}), Object.prototype, "Object.prototype must be untouched");
    assert.equal({}.toString, Object.prototype.toString, "no inherited member was shadowed/poisoned");

    tracker.record(dangerousKey, { ok: true });
    assert.equal(tracker.hasUnpersistedWriteFailure(), false, "recording success for a dangerous key must still clear it");
  });
}

// ── AC-08 (Q7, P1): the actual hazard, proven against FlakinessTracker's
// real quarantine() chain (historyPath write then decisionsPath write) ──

function seedFlakyScenario(Tracker, key) {
  Tracker._setScenario(key, {
    key, url: "https://example.com", action: "click", locator: "#save", description: "Save",
    history: [{ status: "passed" }, { status: "failed" }],
    classification: "flaky", flakeRate: 0.5, sampleSize: 2,
    lastUsed: Date.now(), quarantined: false, quarantinedAt: null, quarantinedBy: null, flakySince: null,
  });
}

function trackerWithFailingHistoryWrite(t, dir) {
  const Tracker = load("src/core/FlakinessTracker.js", {
    "./Middleware": { emit() {} },
    "../../utils/Logger": silent,
    "./util/AtomicJsonStore": {
      readJsonSync: AtomicJsonStore.readJsonSync,
      // historyPath always fails; decisionsPath always succeeds for real —
      // this is exactly the shape Q7 describes: first write in the chain
      // fails, second write in the chain succeeds.
      writeJsonAtomic: (filePath, data) => {
        if (filePath.includes("scenario_history")) {
          return Promise.resolve({ ok: false, error: "simulated ENOSPC" });
        }
        return AtomicJsonStore.writeJsonAtomic(filePath, data);
      },
      WriteFailureTracker: AtomicJsonStore.WriteFailureTracker,
    },
  });
  Tracker.historyPath = path.join(dir, "scenario_history.json");
  Tracker.decisionsPath = path.join(dir, "quarantine_decisions.json");
  Tracker._reload();
  return Tracker;
}

test("FlakinessTracker.quarantine(): a failed historyPath write is not masked by the chain's later successful decisionsPath write (Q7, P1)", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Tracker = trackerWithFailingHistoryWrite(t, dir);
  seedFlakyScenario(Tracker, "k1");

  const entry = Tracker.quarantine("k1", { by: "tester" });
  assert.equal(entry.quarantined, true, "the in-memory quarantine decision still applies immediately");
  await Tracker._queue;

  // This is the AC-08 assertion this whole fix exists for: the failed
  // historyPath write must still be observable after the chain's second
  // write (to decisionsPath) succeeded.
  assert.equal(Tracker.hasUnpersistedWriteFailure(), true,
    "a failed historyPath write must remain visible even though the chained decisionsPath write succeeded");
  assert.equal(Tracker.lastWriteError().path, Tracker.historyPath,
    "the reported failure must name the path that actually failed, not the one that succeeded");

  // Demonstrates the hazard this guards against: a naive single
  // `_lastWriteFailure` slot updated in each `.then()` of the SAME chain
  // would have this exact failure clobbered by the decisionsPath success
  // that runs immediately afterward, because both writes update the same
  // slot in call order. Swapping in that naive shape (last-write-wins,
  // not per-path) against the very same write outcomes reproduces the
  // masking bug this fix closes — proving the hazard is real, not
  // hypothetical, for this exact call site.
  let naiveSlot = null;
  const naiveRecord = (filePath, result) => {
    naiveSlot = result.ok ? null : { path: filePath, error: result.error };
  };
  naiveRecord(Tracker.historyPath, { ok: false, error: "simulated ENOSPC" });
  naiveRecord(Tracker.decisionsPath, { ok: true });
  assert.equal(naiveSlot, null,
    "documents the bug a naive last-write-wins slot would reproduce: the historyPath failure is silently lost");
});

test("FlakinessTracker.unquarantine(): the same per-path protection applies to the reverse chain", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const Tracker = trackerWithFailingHistoryWrite(t, dir);
  seedFlakyScenario(Tracker, "k1");
  Tracker.quarantine("k1", { by: "tester" });
  await Tracker._queue;
  // Failure from quarantine() is expected here too (historyPath always
  // fails in this fixture) — clear it before the assertion under test.
  Tracker._writeFailures = new AtomicJsonStore.WriteFailureTracker();

  Tracker.unquarantine("k1", { by: "tester" });
  await Tracker._queue;
  assert.equal(Tracker.hasUnpersistedWriteFailure(), true);
  assert.equal(Tracker.lastWriteError().path, Tracker.historyPath);
});

// ── AC-06/AC-07/AC-08: LocatorStore write-failure surface ──

test("LocatorStore: a blocked write directory is reported through hasUnpersistedWriteFailure()/lastWriteError(), not just swallowed", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = load("src/core/AIHealer/LocatorStore.js");
  // Point storePath at a path whose parent is itself a file, so mkdir/write
  // can never succeed (ENOTDIR) — the store must still function in memory.
  const notADirectory = path.join(dir, "not-a-directory");
  fs.writeFileSync(notADirectory, "i am a file");
  store.storePath = path.join(notADirectory, "locator_store.json");
  store.data = store._loadSync();

  assert.equal(store.hasUnpersistedWriteFailure(), false, "no write has been attempted yet");
  store.addLocator("#old", "#new");
  await store._queue;

  assert.deepEqual(store.getAlternatives("#old"), ["#new"], "in-memory state survives a failed write, same as before");
  await store._queue;
  assert.equal(store.hasUnpersistedWriteFailure(), true, "the failed write must now be visible, not merely logged");
  assert.equal(store.lastWriteError().path, store.storePath);
  assert.equal(typeof store.lastWriteError().error, "string");
});

test("LocatorStore: a successful write to the SAME path after a failure clears hasUnpersistedWriteFailure()", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = load("src/core/AIHealer/LocatorStore.js");
  const notADirectory = path.join(dir, "not-a-directory");
  fs.writeFileSync(notADirectory, "i am a file");
  store.storePath = path.join(notADirectory, "locator_store.json");
  store.data = store._loadSync();

  store.addLocator("#old", "#new");
  await store._queue;
  assert.equal(store.hasUnpersistedWriteFailure(), true);

  // Clear the obstruction and write again to the SAME path — the tracker
  // is keyed by path, so only a later write to that exact path can clear
  // that path's own failure (a write to a *different* path must not).
  fs.rmSync(notADirectory);
  fs.mkdirSync(notADirectory);
  store.addLocator("#old2", "#new2");
  await store._queue;
  assert.equal(store.hasUnpersistedWriteFailure(), false, "a subsequent successful write to the SAME path clears that path's failure");
});

test("LocatorStore: a success on a DIFFERENT path never clears an earlier path's still-outstanding failure", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = load("src/core/AIHealer/LocatorStore.js");
  const notADirectory = path.join(dir, "not-a-directory");
  fs.writeFileSync(notADirectory, "i am a file");
  const failingPath = path.join(notADirectory, "locator_store.json");
  store.storePath = failingPath;
  store.data = store._loadSync();
  store.addLocator("#old", "#new");
  await store._queue;
  assert.equal(store.hasUnpersistedWriteFailure(), true);

  // Repoint to a different, healthy path and write successfully there.
  store.storePath = path.join(dir, "locator_store.json");
  store.addLocator("#old2", "#new2");
  await store._queue;
  assert.equal(store.hasUnpersistedWriteFailure(), true,
    "the original path's failure must still be reported — a different path's success is not evidence it was ever fixed");
  assert.equal(store.lastWriteError().path, failingPath);
});
