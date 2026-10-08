const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseParallelArgs: p } = require("../../src/core/parallel/Args");

test("defaults", () => {
  assert.deepEqual(p([]), { ok: true, workers: 1, shard: null, runId: null, merge: null });
  assert.equal(p(["--headless", "--other=1"]).ok, true);
});
test("valid workers boundaries", () => {
  assert.equal(p(["--workers=1"]).workers, 1);
  assert.equal(p(["--workers=16"]).workers, 16);
});
test("invalid workers values rejected", () => {
  for (const v of ["", "0", "17", "-1", "1.5", "1.", "0x4", "1e1", " 4", "4 ", "+4", "04", "abc", "99999999999"]) {
    const r = p([`--workers=${v}`]);
    assert.equal(r.ok, false, `workers=${JSON.stringify(v)}`);
    assert.ok(r.message.length <= 300);
  }
  assert.equal(p(["--workers"]).ok, false);
  assert.equal(p(["--workers=2", "--workers=3"]).ok, false);
  assert.equal(p(["--workers=2", "--workers=2"]).ok, false);
});
test("shard validation", () => {
  assert.deepEqual(p(["--shard=1/1", "--run-id=abcdef1"]).shard, { index: 1, total: 1 });
  assert.deepEqual(p(["--shard=64/64", "--run-id=abcdef1"]).shard, { index: 64, total: 64 });
  for (const v of ["", "0/4", "5/4", "1/0", "1/65", "-1/4", "1.5/4", "1/4.0", "0x1/4", "1e0/4", " 1/4", "1/4 ", "1", "1/", "/4", "1/2/3", "a/b"]) {
    assert.equal(p([`--shard=${v}`, "--run-id=abcdef1"]).ok, false, `shard=${JSON.stringify(v)}`);
  }
  assert.equal(p(["--shard=1/2", "--shard=2/2", "--run-id=abcdef1"]).ok, false);
});
test("run-id pattern and requirement", () => {
  assert.equal(p(["--shard=1/2"]).ok, false);
  assert.equal(p(["--run-id=abcdef1"]).ok, false);
  const base = ["--shard=1/2"];
  assert.equal(p([...base, `--run-id=${"a".repeat(6)}`]).ok, true);
  assert.equal(p([...base, `--run-id=${"a".repeat(63)}`]).ok, true);
  for (const v of ["", "a".repeat(5), "a".repeat(64), "-abcdefg", "ABCDEFG", "abc_defg", "abc defg", "abc/defg", "../abcdefg"]) {
    assert.equal(p([...base, `--run-id=${v}`]).ok, false, v);
  }
  assert.equal(p([...base, "--run-id=abcdef1", "--run-id=abcdef2"]).ok, false);
});
test("echo is bounded and sanitized", () => {
  const evil = "\u001b[31m" + "x".repeat(500) + "\nSECRET";
  const r = p([`--workers=${evil}`]);
  assert.equal(r.ok, false);
  assert.ok(r.message.length <= 300);
  assert.ok(!r.message.includes("\u001b"));
  assert.ok(!r.message.includes("\n"));
  assert.ok(!r.message.includes("SECRET"));
  assert.ok(!r.message.includes("x".repeat(41)));
});
test("merge command", () => {
  assert.deepEqual(p(["merge", "--input=out", "--expect-total=3"]).merge, { input: "out", expectTotal: 3 });
  assert.deepEqual(p(["merge", "--input=out"]).merge, { input: "out", expectTotal: null });
  assert.equal(p(["merge"]).ok, false);
  assert.equal(p(["merge", "--input="]).ok, false);
  assert.equal(p(["merge", "--input=a", "--input=b"]).ok, false);
  assert.equal(p(["merge", "--input=a", "--expect-total=0"]).ok, false);
  assert.equal(p(["merge", "--input=a", "--expect-total=65"]).ok, false);
  assert.equal(p(["merge", "--input=a", "--workers=2"]).ok, false);
  assert.equal(p(["merge", "--input=a", "--shard=1/2", "--run-id=abcdef1"]).ok, false);
  assert.equal(p(["--input=a"]).ok, false);
  assert.equal(p(["--expect-total=2"]).ok, false);
});
