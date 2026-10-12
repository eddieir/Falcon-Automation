const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../src/core/parallel/Planning");

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function shuffle(a, r) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

test("shardOf partitions exactly with balanced counts for N 1..64", () => {
  const r = rng(7);
  for (let total = 1; total <= 64; total++) {
    const sizes = [0, 1, total - 1, total, total + 1, Math.floor(r() * 500)].filter((x) => x >= 0);
    for (const size of sizes) {
      const counts = new Array(total + 1).fill(0);
      for (let o = 0; o < size; o++) {
        const s = P.shardOf(o, total);
        assert.ok(Number.isInteger(s) && s >= 1 && s <= total);
        counts[s]++;
      }
      const c = counts.slice(1);
      assert.equal(c.reduce((a, b) => a + b, 0), size);
      assert.ok(Math.max(...c) - Math.min(...c) <= 1, `total=${total} size=${size}`);
    }
  }
});
test("assignShards gives each ordinal exactly one shard", () => {
  const urls = Array.from({ length: 37 }, (_, i) => `https://e.test/${i}`);
  const a = P.assignShards(urls, 5);
  assert.equal(a.length, 37);
  a.forEach((x, i) => { assert.equal(x.ordinal, i); assert.equal(x.shard, (i % 5) + 1); });
});
test("canonicalOrder: entry first, code-unit sort, unique, input-order independent", () => {
  const entry = "https://e.test/z";
  const urls = ["https://e.test/b", "https://e.test/B", "https://e.test/a", "https://e.test/z", "https://e.test/a", "https://e.test/é", "https://e.test/Z"];
  const expected = [entry, "https://e.test/B", "https://e.test/Z", "https://e.test/a", "https://e.test/b", "https://e.test/é"];
  assert.deepEqual(P.canonicalOrder(entry, urls), expected);
  const r = rng(3);
  for (let i = 0; i < 50; i++) assert.deepEqual(P.canonicalOrder(entry, shuffle(urls, r)), expected);
  assert.deepEqual(P.canonicalOrder(entry, []), [entry]);
});
test("dedupeInOrder: first owner keeps, same output for shuffled input", () => {
  const sigMap = { 0: ["a", "b"], 1: ["b", "c"], 2: ["a", "c", "d"], 3: ["d"] };
  const pages = [0, 1, 2, 3].map((o) => ({ ordinal: o, url: `u${o}`, name: `p${o}` }));
  const sig = (pg) => sigMap[pg.ordinal];
  const base = P.dedupeInOrder(pages, sig);
  assert.deepEqual(base.map((x) => x.kept), [["a", "b"], ["c"], ["d"], []]);
  assert.deepEqual(base[1].deduped, [{ name: "p1", signature: "b", status: "deduped", firstRunOn: "u0" }]);
  assert.deepEqual(base[2].deduped.map((d) => [d.signature, d.firstRunOn]), [["a", "u0"], ["c", "u1"]]);
  const r = rng(11);
  for (let i = 0; i < 50; i++) assert.deepEqual(P.dedupeInOrder(shuffle(pages, r), sig), base);
  assert.deepEqual(P.dedupeInOrder([...pages].reverse(), sig), base);
});
test("digests are deterministic, key-order independent, and sensitive", () => {
  assert.match(P.frontierDigest(["a", "b"]), /^[0-9a-f]{64}$/);
  assert.equal(P.frontierDigest(["a", "b"]), P.frontierDigest(["a", "b"]));
  assert.notEqual(P.frontierDigest(["a", "b"]), P.frontierDigest(["b", "a"]));
  assert.equal(P.planDigest([{ x: 1, y: 2 }]), P.planDigest([{ y: 2, x: 1 }]));
  assert.notEqual(P.planDigest([["a"]]), P.planDigest([["a", "b"]]));
});
