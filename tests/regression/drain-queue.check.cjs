const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { temp, drainQueue, drainAll } = require("./helpers.cjs");

test("drainQueue rejects with a timeout naming the owner and bound when the queue hangs", async (t) => {
  const start = Date.now();
  const owner = { _queue: new Promise(() => {}) };
  await assert.rejects(
    () => drainQueue(owner, undefined, { timeoutMs: 150 }),
    /did not drain within 150ms/,
  );
  assert.ok(Date.now() - start < 2000, "timeout should fire well under 2s");
});

test("drainQueue surfaces the original rejection, not a timeout message", async (t) => {
  const owner = { _queue: Promise.reject(new Error("write failed: disk full")) };
  await assert.rejects(
    () => drainQueue(owner, undefined, { timeoutMs: 1000 }),
    (err) => {
      assert.equal(err.message, "write failed: disk full");
      assert.ok(!/did not drain/.test(err.message));
      return true;
    },
  );
});

test("drainQueue follows a write appended while draining", async (t) => {
  let appendedSettled = false;
  const owner = { _queue: new Promise((resolve) => setTimeout(resolve, 10)) };
  // Replace the queue's tail with a longer-running write before the current
  // one settles, modelling a write appended while draining is in progress.
  setTimeout(() => {
    owner._queue = new Promise((resolve) =>
      setTimeout(() => {
        appendedSettled = true;
        resolve();
      }, 20),
    );
  }, 5);
  await drainQueue(owner, undefined, { timeoutMs: 1000 });
  assert.equal(appendedSettled, true, "should wait for the appended tail to settle");
});

test("drainQueue fails when leftover lock/tmp artifacts remain, and passes on a clean dir", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(dir, "x.lock"), "");
  fs.writeFileSync(path.join(dir, "x.tmp-1-abc"), "");

  const owner = { _queue: Promise.resolve() };
  await assert.rejects(
    () => drainQueue(owner, dir, { timeoutMs: 1000 }),
    (err) => {
      assert.match(err.message, /x\.lock/);
      assert.match(err.message, /x\.tmp-1-abc/);
      return true;
    },
  );

  fs.rmSync(path.join(dir, "x.lock"));
  fs.rmSync(path.join(dir, "x.tmp-1-abc"));

  await drainQueue(owner, dir, { timeoutMs: 1000 });
});

test("drainAll avoids the false positive an early per-owner dir check would hit while a sibling owner still writes", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // ownerA settles immediately; ownerB's write is still in flight and has a
  // real transient tmp file on disk until its queue resolves.
  const tmpFile = path.join(dir, "ownerB.tmp-1-abc");
  fs.writeFileSync(tmpFile, "");
  let ownerBWriteDone = false;
  const ownerA = { _queue: Promise.resolve() };
  const ownerB = {
    _queue: new Promise((resolve) =>
      setTimeout(() => {
        fs.rmSync(tmpFile);
        ownerBWriteDone = true;
        resolve();
      }, 10),
    ),
  };

  // Contrast: checking the directory right after only ownerA has drained —
  // the shape of the old per-owner call site — sees ownerB's legitimate
  // in-flight tmp file and fails even though nothing is actually stuck.
  await drainQueue(ownerA, undefined, { timeoutMs: 1000 });
  assert.throws(
    () => {
      const entries = fs.readdirSync(dir);
      const transient = entries.filter((f) => /\.lock$|\.tmp-/.test(f));
      if (transient.length) throw new Error("early check sees ownerB's in-flight tmp file");
    },
    /early check sees ownerB's in-flight tmp file/,
  );

  await drainAll([ownerA, ownerB], dir, { timeoutMs: 1000 });
  assert.equal(ownerBWriteDone, true, "drainAll should have waited for ownerB to finish");
});

test("drainAll drains every owner even when one rejects, and rethrows the original rejection", async (t) => {
  let otherDrained = false;
  const failing = { _queue: Promise.reject(new Error("write failed: disk full")) };
  const other = {
    _queue: new Promise((resolve) =>
      setTimeout(() => {
        otherDrained = true;
        resolve();
      }, 10),
    ),
  };
  await assert.rejects(
    () => drainAll([failing, other], undefined, { timeoutMs: 1000 }),
    (err) => {
      assert.equal(err.message, "write failed: disk full");
      return true;
    },
  );
  assert.equal(otherDrained, true, "the other owner must still be drained, not skipped");
});

test("drainAll still fails when a leftover lock/tmp artifact remains after every owner is stable", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(dir, "stale.lock"), "");

  const ownerA = { _queue: Promise.resolve() };
  const ownerB = { _queue: Promise.resolve() };
  await assert.rejects(
    () => drainAll([ownerA, ownerB], dir, { timeoutMs: 1000 }),
    (err) => {
      assert.match(err.message, /stale\.lock/);
      return true;
    },
  );
});

test("drainAll times out with a message naming every owner and the dir when an owner hangs", async (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  class StuckOwner {}
  class FineOwner {}
  const stuck = Object.assign(new StuckOwner(), { _queue: new Promise(() => {}) });
  const fine = Object.assign(new FineOwner(), { _queue: Promise.resolve() });

  await assert.rejects(
    () => drainAll([stuck, fine], dir, { timeoutMs: 150 }),
    (err) => {
      assert.match(err.message, /did not drain within 150ms/);
      assert.match(err.message, /StuckOwner/);
      assert.match(err.message, /FineOwner/);
      assert.match(err.message, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    },
  );
});
