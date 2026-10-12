const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runBounded, getTaskContext } = require("../../src/core/parallel/Scheduler");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("never exceeds limit active, with random delays", async () => {
  for (const limit of [1, 2, 3, 5]) {
    let active = 0, max = 0;
    const res = await runBounded(Array.from({ length: 30 }, (_, i) => i), limit, async (x) => {
      active++; max = Math.max(max, active);
      await sleep(Math.floor(Math.random() * 6));
      active--;
      return x * 2;
    });
    assert.ok(max <= limit, `max ${max} > ${limit}`);
    assert.ok(max >= Math.min(limit, 2) || limit === 1, "concurrency actually used");
    assert.deepEqual(res.map((r) => r.value), Array.from({ length: 30 }, (_, i) => i * 2));
  }
});
test("reverse completion order still yields index-ordered results", async () => {
  const n = 6;
  const finished = [];
  const res = await runBounded(Array.from({ length: n }, (_, i) => i), n, async (x) => {
    await sleep((n - x) * 8);
    finished.push(x);
    return x;
  });
  assert.deepEqual(finished, [5, 4, 3, 2, 1, 0]);
  assert.deepEqual(res.map((r) => [r.index, r.status, r.value]), [0, 1, 2, 3, 4, 5].map((i) => [i, "done", i]));
});
test("dispatch follows index order", async () => {
  const started = [];
  await runBounded([0, 1, 2, 3, 4, 5], 2, async (x) => { started.push(x); await sleep(2); });
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
});
test("deadline marks remainder not-started; in-flight finishes", async () => {
  let t = 0;
  const now = () => t;
  const res = await runBounded([0, 1, 2, 3, 4], 2, async (x) => {
    await sleep(5);
    t += 10; // advancing the clock after each task
    return x;
  }, { deadline: 10, now });
  const statuses = res.map((r) => r.status);
  assert.deepEqual(statuses.slice(0, 2), ["done", "done"]); // both lanes started at t=0 and finished
  assert.deepEqual(statuses.slice(2), ["not-started", "not-started", "not-started"]);
  assert.equal(res[2].value, undefined);
});
test("deadline already passed starts nothing", async () => {
  let ran = 0;
  const res = await runBounded([1, 2], 2, async () => { ran++; }, { deadline: 5, now: () => 5 });
  assert.equal(ran, 0);
  assert.deepEqual(res.map((r) => r.status), ["not-started", "not-started"]);
});
test("throwing task is isolated and error is bounded", async () => {
  const res = await runBounded([0, 1, 2, 3], 2, async (x) => {
    if (x === 1) throw new Error("boom\n" + "y".repeat(1000));
    if (x === 2) throw "plain";
    return x;
  });
  assert.deepEqual(res.map((r) => r.status), ["done", "failed", "failed", "done"]);
  assert.ok(res[1].error.length <= 300);
  assert.ok(!res[1].error.includes("\n"));
  assert.equal(res[2].error, "plain");
  assert.equal(res[3].value, 3);
});
test("task context carries pageOrdinal per task and is absent outside", async () => {
  assert.equal(getTaskContext(), undefined);
  const res = await runBounded(["a", "b", "c"], 3, async (_x, i) => {
    await sleep(3 - i);
    return getTaskContext().pageOrdinal;
  });
  assert.deepEqual(res.map((r) => r.value), [0, 1, 2]);
  assert.equal(getTaskContext(), undefined);
});
test("empty input and limit larger than items", async () => {
  assert.deepEqual(await runBounded([], 4, async () => 1), []);
  const res = await runBounded([1], 10, async (x) => x);
  assert.equal(res[0].status, "done");
});
