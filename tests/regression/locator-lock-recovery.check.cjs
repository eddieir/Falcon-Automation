"use strict";
// A writer lock left behind by a crashed or killed process used to block every
// later locator-memory write forever, and a failing handle.close() used to
// reject write() and poison the LocatorMemory queue. These tests pin the
// reclaim rules (dead owner, or unprovable owner older than the grace period)
// and the rejection-proof release/queue behaviour.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const Writer = require("../../src/core/locator/LocatorMemoryWriter");
const AtomicJsonStore = require("../../src/core/util/AtomicJsonStore");
const Memory = require("../../src/core/locator/LocatorMemory");
const Identity = require("../../src/core/locator/LocatorIdentity");
const Signature = require("../../src/core/locator/ElementSignature");

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-lock-recovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "memory.json");
  return { dir, file, lock: `${file}.lock` };
}
const staleFiles = (dir) => fs.readdirSync(dir).filter((n) => n.includes(".stale."));
const backdate = (p, ms) => { const d = new Date(Date.now() - ms); fs.utimesSync(p, d, d); };
const put = (file, data) => Writer.write(file, data, Writer.digestSync(file), AtomicJsonStore.writeJsonAtomic);
function deadPid() {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
  return Number(r.stdout.toString());
}

test("a lock owned by a dead pid is reclaimed and the write persists", async (t) => {
  const f = tmp(t);
  fs.writeFileSync(f.lock, JSON.stringify({ token: "x", pid: deadPid() }));
  const r = await put(f.file, { a: 1 });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, "utf8")), { a: 1 });
  assert.equal(fs.existsSync(f.lock), false);
  assert.deepEqual(staleFiles(f.dir), []);
});

test("a lock owned by a live foreign pid is preserved and reported as a conflict", async (t) => {
  const f = tmp(t);
  const body = JSON.stringify({ token: "x", pid: process.ppid });
  fs.writeFileSync(f.lock, body);
  backdate(f.lock, 3600e3);
  const r = await put(f.file, { a: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /writer conflict: lock exists/);
  assert.equal(fs.readFileSync(f.lock, "utf8"), body);
  assert.deepEqual(staleFiles(f.dir), []);
});

test("an empty lock is kept while fresh and reclaimed once past the grace period", async (t) => {
  const f = tmp(t);
  fs.writeFileSync(f.lock, "");
  const fresh = await put(f.file, { a: 1 });
  assert.equal(fresh.ok, false);
  assert.match(fresh.error, /writer conflict: lock exists/);
  assert.equal(fs.existsSync(f.lock), true);
  backdate(f.lock, 60e3);
  const old = await put(f.file, { a: 2 });
  assert.equal(old.ok, true, old.error);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, "utf8")), { a: 2 });
  assert.equal(fs.existsSync(f.lock), false);
});

test("a corrupt lock older than the grace period is reclaimed", async (t) => {
  const f = tmp(t);
  fs.writeFileSync(f.lock, "{not json");
  backdate(f.lock, 60e3);
  const r = await put(f.file, { a: 1 });
  assert.equal(r.ok, true, r.error);
  assert.equal(fs.existsSync(f.lock), false);
  assert.deepEqual(staleFiles(f.dir), []);
});

test("concurrent writers against one stale lock never both win and leave nothing behind", async (t) => {
  const f = tmp(t);
  fs.writeFileSync(f.lock, JSON.stringify({ token: "x", pid: deadPid() }));
  const results = await Promise.all([put(f.file, { n: 1 }), put(f.file, { n: 2 })]);
  const conflicts = results.filter((r) => !r.ok);
  assert.ok(conflicts.length <= 1, JSON.stringify(results));
  for (const c of conflicts) assert.match(c.error, /writer conflict/);
  assert.ok(results.some((r) => r.ok), "at least one writer succeeds");
  assert.equal(fs.existsSync(f.lock), false);
  assert.deepEqual(staleFiles(f.dir), []);
  assert.ok([1, 2].includes(JSON.parse(fs.readFileSync(f.file, "utf8")).n));
});

test("a rejecting handle.close() neither rejects write() nor leaves the lock or poisons the queue", async (t) => {
  const f = tmp(t);
  const memory = new Memory({ memoryPath: f.file, env: { FALCON_LOCATOR_SALT: "lock-recovery" } });
  const identity = Identity.buildIdentity({ url: "https://example.com/x", action: "click", originalSelector: "#a", env: {} }).identity;
  const signature = Signature.capture({ tagName: "button", role: "button", attributes: { id: "n" }, ownText: "Save", structuralPath: ["body"] }, { salt: memory.salt });

  const realOpen = fs.promises.open;
  fs.promises.open = async (...args) => {
    const handle = await realOpen(...args);
    const realClose = handle.close.bind(handle);
    handle.close = async () => { await realClose(); throw new Error("close failed"); };
    return handle;
  };
  let direct;
  try {
    direct = await put(path.join(f.dir, "other.json"), { a: 1 });
    memory.recordPendingCandidate(identity, { selector: "#b", signature });
    await memory._queue;
  } finally {
    fs.promises.open = realOpen;
  }
  assert.equal(direct.ok, true, direct && direct.error);
  assert.equal(fs.existsSync(f.lock), false);
  assert.equal(fs.existsSync(path.join(f.dir, "other.json.lock")), false);

  // The queue still accepts and completes later persists.
  memory.recordPendingCandidate(identity, { selector: "#c", signature });
  const settled = await memory._queue;
  assert.equal(settled === undefined || settled.ok !== false, true);
  assert.ok(fs.readFileSync(f.file, "utf8").includes("#c"));
});

// Swaps the lock for a brand-new file (new inode, fresh mtime) with the given body.
function swapLock(lock, body) {
  const tmpName = `${lock}.swap`;
  fs.writeFileSync(tmpName, body);
  fs.renameSync(tmpName, lock);
}

test("reclaim never removes a live empty lock created between inspection and rename", async (t) => {
  const f = tmp(t);
  fs.writeFileSync(f.lock, "");
  backdate(f.lock, 60e3);
  const reclaimed = await Writer._reclaimStale(f.lock, { beforeRename: () => swapLock(f.lock, "") });
  assert.equal(reclaimed, false);
  assert.equal(fs.existsSync(f.lock), true, "the live lock must still be in place");
  assert.equal(fs.readFileSync(f.lock, "utf8"), "");
  assert.ok(Date.now() - fs.statSync(f.lock).mtimeMs < 30e3, "the fresh lock itself, not the backdated one");
  assert.deepEqual(staleFiles(f.dir), []);
});

test("restoring a displaced live lock never clobbers a lock created in the meantime", async (t) => {
  const f = tmp(t);
  fs.writeFileSync(f.lock, "");
  backdate(f.lock, 60e3);
  const third = JSON.stringify({ token: "third", pid: process.pid });
  const reclaimed = await Writer._reclaimStale(f.lock, {
    beforeRename: () => swapLock(f.lock, ""),
    afterRename: () => fs.writeFileSync(f.lock, third),
  });
  assert.equal(reclaimed, false);
  assert.equal(fs.readFileSync(f.lock, "utf8"), third);
  assert.deepEqual(staleFiles(f.dir), []);
});

test("a displaced live lock is put back when the path is still free", async (t) => {
  const f = tmp(t);
  fs.writeFileSync(f.lock, "");
  backdate(f.lock, 60e3);
  const live = JSON.stringify({ token: "live", pid: process.ppid });
  const reclaimed = await Writer._reclaimStale(f.lock, { beforeRename: () => swapLock(f.lock, live) });
  assert.equal(reclaimed, false);
  assert.equal(fs.readFileSync(f.lock, "utf8"), live);
  assert.deepEqual(staleFiles(f.dir), []);
});
