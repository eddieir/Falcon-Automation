const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { load, silent, temp } = require("./helpers.cjs");

/** Load a fresh AtomicJsonStore instance with a warning-capturing Logger double. */
function storeWithLogger() {
  const warnings = [];
  const Store = load("src/core/util/AtomicJsonStore.js", {
    "../../../utils/Logger": { ...silent, warning: (m) => warnings.push(m) },
  });
  return { Store, warnings };
}

// ── writeJsonAtomic(): durable writes ──

for (const [label, data] of [["object-backed", { a: 1, b: [1, 2, 3] }], ["array-backed", [{ x: 1 }, { x: 2 }]]]) {
  test(`writeJsonAtomic: a successful save leaves valid JSON and no stray temp file (${label})`, async (t) => {
    const dir = temp();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { Store } = storeWithLogger();
    const file = path.join(dir, "state.json");

    await Store.writeJsonAtomic(file, data);

    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), data);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes(".tmp-")), []);
  });
}

test("writeJsonAtomic: a write failure never rejects and leaves the previous destination byte-unchanged", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store, warnings } = storeWithLogger();
  const file = path.join(dir, "state.json");
  fs.writeFileSync(file, JSON.stringify({ safe: true }));
  const before = fs.readFileSync(file);

  const real = fs.promises.writeFile;
  fs.promises.writeFile = async () => { throw new Error("simulated disk full"); };
  t.after(() => { fs.promises.writeFile = real; });

  await assert.doesNotReject(Store.writeJsonAtomic(file, { new: true }));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.ok(warnings.some((w) => w.includes(file) && w.includes("simulated disk full")));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes(".tmp-")), []);
});

test("writeJsonAtomic: a rename failure leaves the previous destination unchanged and cleans up its own temp file", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store, warnings } = storeWithLogger();
  const file = path.join(dir, "state.json");
  fs.writeFileSync(file, JSON.stringify({ safe: true }));
  const before = fs.readFileSync(file);

  const real = fs.promises.rename;
  fs.promises.rename = async () => { throw new Error("simulated rename block"); };
  t.after(() => { fs.promises.rename = real; });

  await assert.doesNotReject(Store.writeJsonAtomic(file, { new: true }));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.ok(warnings.some((w) => w.includes("simulated rename block")));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes(".tmp-")), []);
});

test("writeJsonAtomic: one failed queued save never poisons the next queued save (promise-chain poisoning)", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store } = storeWithLogger();
  const file = path.join(dir, "state.json");

  const real = fs.promises.writeFile;
  let failNext = true;
  fs.promises.writeFile = async (...args) => {
    if (failNext) {
      failNext = false;
      throw new Error("simulated failure");
    }
    return real(...args);
  };
  t.after(() => { fs.promises.writeFile = real; });

  // Mirrors FlakinessTracker/HealingTrust's `_queue = _queue.then(() => writeJsonAtomic(...))`
  // pattern, which has no `.catch` — if writeJsonAtomic ever rejected, this chain
  // would be poisoned and the second save would silently never run.
  let queue = Promise.resolve();
  queue = queue.then(() => Store.writeJsonAtomic(file, { first: true }));
  queue = queue.then(() => Store.writeJsonAtomic(file, { second: true }));
  await queue;

  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { second: true });
});

test("writeJsonAtomic: concurrent unserialized calls never produce truncated JSON on disk", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store } = storeWithLogger();
  const file = path.join(dir, "state.json");

  await Promise.all(Array.from({ length: 20 }, (_, i) => Store.writeJsonAtomic(file, { i })));

  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
});

test("writeJsonAtomic and readJsonSync round-trip through a directory path containing spaces", async (t) => {
  const base = temp();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, "has spaces in it");
  fs.mkdirSync(dir);
  const { Store } = storeWithLogger();
  const file = path.join(dir, "state file.json");

  await Store.writeJsonAtomic(file, { ok: true });
  assert.deepEqual(Store.readJsonSync(file, {}), { ok: true });
});

test("writeJsonAtomic: the temp file is created in the same directory as the destination (no cross-filesystem rename)", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store } = storeWithLogger();
  const file = path.join(dir, "state.json");

  let seenTmpDir;
  const real = fs.promises.writeFile;
  fs.promises.writeFile = async (p, ...rest) => {
    seenTmpDir = path.dirname(p);
    return real(p, ...rest);
  };
  t.after(() => { fs.promises.writeFile = real; });

  await Store.writeJsonAtomic(file, { a: 1 });
  assert.equal(seenTmpDir, path.dirname(file));
});

test("writeJsonAtomic/readJsonSync never escape the destination's own directory even with '..' segments in the path", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store } = storeWithLogger();
  const nested = path.join(dir, "nested");
  fs.mkdirSync(nested);
  const file = path.join(nested, "..", "state.json"); // normalizes to dir/state.json

  await Store.writeJsonAtomic(file, { a: 1 });
  assert.ok(fs.readdirSync(dir).includes("state.json"));
  assert.ok(!fs.existsSync(path.join(nested, "state.json")));
});

// ── readJsonSync(): corruption recovery (AC-10) ──

for (const [label, fallback, badContent] of [
  ["object-backed", {}, "{not json"],
  ["array-backed", [], "[not json"],
]) {
  test(`readJsonSync: truncated JSON recovers with a byte-identical sidecar and the correct fallback (${label})`, (t) => {
    const dir = temp();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { Store, warnings } = storeWithLogger();
    const file = path.join(dir, "state.json");
    fs.writeFileSync(file, badContent);
    const before = fs.readFileSync(file);

    const result = Store.readJsonSync(file, fallback);

    assert.deepEqual(result, fallback);
    assert.ok(warnings.some((w) => w.includes(file)));
    assert.ok(!warnings.some((w) => w.includes(badContent)), "warning must not echo file contents");

    const sidecars = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    assert.equal(sidecars.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(dir, sidecars[0])), before);
  });
}

test("readJsonSync: a valid-JSON-wrong-shape file is treated as corrupt too (sidecar + warning + fallback)", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store, warnings } = storeWithLogger();
  const file = path.join(dir, "state.json");
  fs.writeFileSync(file, JSON.stringify([1, 2, 3])); // array where an object is expected

  const result = Store.readJsonSync(file, {});

  assert.deepEqual(result, {});
  assert.ok(warnings.some((w) => w.includes(file)));
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes(".corrupt-")).length, 1);
});

test("readJsonSync: an empty file recovers with sidecar + warning + the correct fallback", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store, warnings } = storeWithLogger();
  const file = path.join(dir, "state.json");
  fs.writeFileSync(file, "");

  const result = Store.readJsonSync(file, []);

  assert.deepEqual(result, []);
  assert.ok(warnings.length >= 1);
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes(".corrupt-")).length, 1);
});

test("readJsonSync: a missing file returns the fallback silently — not corruption", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store, warnings } = storeWithLogger();
  const file = path.join(dir, "missing.json");

  assert.deepEqual(Store.readJsonSync(file, { a: 1 }), { a: 1 });
  assert.equal(warnings.length, 0);
  assert.equal(fs.readdirSync(dir).length, 0);
});

test("readJsonSync: a sidecar naming collision never overwrites an earlier sidecar", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store, warnings } = storeWithLogger();
  const file = path.join(dir, "state.json");

  const realNow = Date.now;
  const realUUID = crypto.randomUUID;
  Date.now = () => 1700000000000;
  crypto.randomUUID = () => "fixed-uuid-0000";
  t.after(() => { Date.now = realNow; crypto.randomUUID = realUUID; });

  fs.writeFileSync(file, "{first corrupt");
  assert.deepEqual(Store.readJsonSync(file, {}), {});
  const afterFirst = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
  assert.equal(afterFirst.length, 1);
  const firstSidecarBytes = fs.readFileSync(path.join(dir, afterFirst[0]));

  // Same frozen clock + same forced uuid => the exact same sidecar path as
  // before. A second corruption must never clobber the first's evidence.
  fs.writeFileSync(file, "{second corrupt, totally different bytes and length");
  assert.deepEqual(Store.readJsonSync(file, {}), {});

  const afterSecond = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
  assert.equal(afterSecond.length, 1, "collision must not create or overwrite to a second file");
  assert.deepEqual(fs.readFileSync(path.join(dir, afterSecond[0])), firstSidecarBytes);
  assert.ok(warnings.some((w) => w.toLowerCase().includes("sidecar")));
});

test("readJsonSync: a sidecar write failure is fail-open — logs loudly and still returns the clean fallback", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store, warnings } = storeWithLogger();
  const file = path.join(dir, "state.json");
  fs.writeFileSync(file, "{not json");

  const real = fs.writeFileSync;
  fs.writeFileSync = (p, ...rest) => {
    if (String(p).includes(".corrupt-")) throw new Error("simulated sidecar write block");
    return real(p, ...rest);
  };
  t.after(() => { fs.writeFileSync = real; });

  const result = Store.readJsonSync(file, {});

  assert.deepEqual(result, {});
  assert.ok(warnings.some((w) => w.includes("simulated sidecar write block")));
});

test("warnings from both read and write paths carry path/error context but never raw file contents", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { Store, warnings } = storeWithLogger();
  const file = path.join(dir, "state.json");
  const secretLookingContent = "{ \"password\": \"do-not-log-me\", broken";
  fs.writeFileSync(file, secretLookingContent);

  Store.readJsonSync(file, {});

  const realRename = fs.promises.rename;
  fs.promises.rename = async () => { throw new Error("rename failed"); };
  t.after(() => { fs.promises.rename = realRename; });
  await Store.writeJsonAtomic(file, { clean: true });

  assert.ok(warnings.length >= 2);
  for (const w of warnings) {
    assert.ok(!w.includes("do-not-log-me"), `warning leaked file contents: ${w}`);
  }
  assert.ok(warnings.every((w) => w.includes(file)));
});
