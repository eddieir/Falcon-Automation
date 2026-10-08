"use strict";
// T17: a writer lock records the host that created it. pid probing is only
// meaningful on the same host, so a lock from another host is never reclaimed
// automatically; the write fails closed with LOCK_FOREIGN_HOST.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Writer = require("../../src/core/locator/LocatorMemoryWriter");
const AtomicJsonStore = require("../../src/core/util/AtomicJsonStore");
const { buildRunRecord } = require("../../src/core/history/RunRecord.js");
const { RunLedger } = require("../../src/core/history/RunLedger");

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-lock-host-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "memory.json");
  return { dir, file, lock: `${file}.lock` };
}
const put = (file, data, opts) => Writer.write(file, data, Writer.digestSync(file), AtomicJsonStore.writeJsonAtomic, opts);
const deadPid = () => Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString());
const writeLock = (f, body) => fs.writeFileSync(f.lock, typeof body === "string" ? body : JSON.stringify(body));
const staleFiles = (dir) => fs.readdirSync(dir).filter((n) => n.includes(".stale."));

test("T17: a lock from another host is not reclaimed, even with a dead pid", async (t) => {
  const f = tmp(t);
  writeLock(f, { token: "x", pid: deadPid(), host: "some-other-host-" + os.hostname() });
  const before = fs.readFileSync(f.lock, "utf8");
  const r = await put(f.file, { a: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "LOCK_FOREIGN_HOST");
  assert.match(r.error, /^LOCK_FOREIGN_HOST/);
  assert.equal(fs.readFileSync(f.lock, "utf8"), before, "foreign lock left in place");
  assert.equal(fs.existsSync(f.file), false, "no canonical change");
  assert.deepEqual(staleFiles(f.dir), []);
});

test("T17: a foreign-host lock stays blocked however old it is", async (t) => {
  const f = tmp(t);
  writeLock(f, { token: "x", pid: deadPid(), host: "elsewhere" });
  const r = await put(f.file, { a: 1 }, { now: () => Date.now() + 30 * 24 * 3600e3 });
  assert.equal(r.code, "LOCK_FOREIGN_HOST");
  assert.equal(fs.existsSync(f.file), false);
});

test("T17: a same-host lock with a dead pid is reclaimed", async (t) => {
  const f = tmp(t);
  writeLock(f, { token: "x", pid: deadPid(), host: os.hostname() });
  const r = await put(f.file, { a: 1 });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, "utf8")), { a: 1 });
  assert.equal(fs.existsSync(f.lock), false);
});

test("T17: a same-host lock held by a live process is respected", async (t) => {
  const f = tmp(t);
  writeLock(f, { token: "x", pid: process.ppid, host: os.hostname() });
  const r = await put(f.file, { a: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /^writer conflict: lock exists/);
  assert.notEqual(r.code, "LOCK_FOREIGN_HOST");
  assert.equal(fs.existsSync(f.file), false);
});

test("T17: a legacy lock with no host or pid is kept inside the 60 s grace and reclaimed after", async (t) => {
  const f = tmp(t);
  writeLock(f, "");
  const young = await put(f.file, { a: 1 });
  assert.equal(young.ok, false);
  assert.match(young.error, /writer conflict/);
  const mtime = fs.statSync(f.lock).mtimeMs;
  const at45 = await put(f.file, { a: 1 }, { now: () => mtime + 45e3 });
  assert.equal(at45.ok, false, "still inside the grace period at 45 s");
  const at61 = await put(f.file, { a: 1 }, { now: () => mtime + 61e3 });
  assert.equal(at61.ok, true, at61.error);
  assert.equal(fs.existsSync(f.lock), false);
});

test("T17: new locks record host, pid and creation time", async (t) => {
  const f = tmp(t);
  let seen;
  const atomic = async (file, data) => { seen = JSON.parse(fs.readFileSync(f.lock, "utf8")); return AtomicJsonStore.writeJsonAtomic(file, data); };
  const r = await Writer.write(f.file, { a: 1 }, Writer.digestSync(f.file), atomic);
  assert.equal(r.ok, true, r.error);
  assert.equal(seen.host, os.hostname());
  assert.equal(seen.pid, process.pid);
  assert.ok(!Number.isNaN(Date.parse(seen.createdAt)));
});

test("T17: RunLedger fails closed on a foreign-host lock and leaves the ledger unchanged", async (t) => {
  const f = tmp(t);
  const ledger = new RunLedger({ filePath: path.join(f.dir, "run_history.json"), env: {} });
  writeLock({ lock: `${ledger.filePath}.lock` }, { token: "x", pid: deadPid(), host: "elsewhere" });
  const r = await ledger.append(buildRunRecord({ report: { result: "PASSED", summary: {} } }));
  assert.equal(r.ok, false);
  assert.match(r.error, /^LOCK_FOREIGN_HOST/);
  assert.equal(fs.existsSync(ledger.filePath), false);
});
