const test = require("node:test");
const assert = require("node:assert/strict");
const ParallelMode = require("../../src/core/parallel/ParallelMode");

test.afterEach(() => ParallelMode.setActive(false));

test("divertTarget is null when journal mode is off, even inside a journal context", () => {
    const calls = [];
    ParallelMode.runWithJournal({ record: (...a) => calls.push(a) }, () => {
        assert.equal(ParallelMode.divertTarget(), null);
    });
    assert.equal(calls.length, 0);
});

test("divertTarget is null outside a task even when journal mode is on", () => {
    ParallelMode.setActive(true);
    assert.equal(ParallelMode.divertTarget(), null);
});

test("inside a task, records carry the current scenario and repetition", async () => {
    ParallelMode.setActive(true);
    const calls = [];
    const journal = { record: (type, scn, rep, payload) => calls.push([type, scn, rep, payload]) };
    await ParallelMode.runWithJournal(journal, async () => {
        ParallelMode.setPosition(2, 3);
        await new Promise((r) => setTimeout(r, 1));
        ParallelMode.divertTarget().record("healing.tier3", { original: "#a" });
    });
    assert.deepEqual(calls, [["healing.tier3", 2, 3, { original: "#a" }]]);
});

test("concurrent tasks keep separate journals", async () => {
    ParallelMode.setActive(true);
    const seen = { a: [], b: [] };
    const mk = (k) => ({ record: (t) => seen[k].push(t) });
    await Promise.all([
        ParallelMode.runWithJournal(mk("a"), async () => { await new Promise((r) => setTimeout(r, 5)); ParallelMode.divertTarget().record("x"); }),
        ParallelMode.runWithJournal(mk("b"), async () => { ParallelMode.divertTarget().record("y"); }),
    ]);
    assert.deepEqual(seen, { a: ["x"], b: ["y"] });
});
