"use strict";

/**
 * Phase 16 traceability (P16-AC-40). Run directly with `node --test`.
 *
 * The register (docs/phase-16-acceptance-criteria.json) must carry every id
 * P16-AC-01..42 and P16-AC-101..125 exactly once. Every row marked done or
 * partial must point at implementation paths that exist and at tests that are
 * registered as live test(...) calls in the named file. A done row needs real
 * implementation and, unless verified by review or platform with a note, a test.
 * A negative control proves the checker rejects each kind of defect.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root } = require("./helpers.cjs");

const REGISTER_PATH = path.join(root, "docs", "phase-16-acceptance-criteria.json");
const VERIFIED_BY = new Set(["test", "platform", "review"]);
const STATUSES = new Set(["done", "partial", "planned"]);
const idOf = (n) => `P16-AC-${String(n).padStart(2, "0")}`;
const REQUIRED_IDS = [
  ...Array.from({ length: 42 }, (_, i) => idOf(i + 1)),
  ...Array.from({ length: 25 }, (_, i) => idOf(i + 101)),
];

const loadRegister = () => JSON.parse(fs.readFileSync(REGISTER_PATH, "utf8"));

const fileCache = new Map();
function readFileOrNull(rel) {
  if (!fileCache.has(rel)) {
    const abs = path.join(root, rel);
    fileCache.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null);
  }
  return fileCache.get(rel);
}

/** True when `name` is the first argument of a live `test(` call (template titles matched as source text). */
function registersLiveTest(contents, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`\btest\s*\(\s*(["'\x60])${escaped}\1`).test(contents);
}

/** Every problem found in a register, as a list of strings. */
function checkRegister(register) {
  const problems = [];
  const criteria = register.criteria || [];
  const seen = new Map();
  for (const c of criteria) seen.set(c.id, (seen.get(c.id) || 0) + 1);
  for (const id of REQUIRED_IDS) {
    if (!seen.has(id)) problems.push(`${id}: missing from the register`);
  }
  for (const [id, n] of seen) {
    if (n > 1) problems.push(`${id}: appears ${n} times`);
    if (!REQUIRED_IDS.includes(id)) problems.push(`${id}: unexpected id`);
  }
  for (const c of criteria) {
    if (!STATUSES.has(c.status)) problems.push(`${c.id}: unknown status ${c.status}`);
    if (!VERIFIED_BY.has(c.verifiedBy)) problems.push(`${c.id}: unknown verifiedBy ${c.verifiedBy}`);
    const impl = Array.isArray(c.implementation) ? c.implementation : [];
    const tests = Array.isArray(c.tests) ? c.tests : [];
    if (c.status === "done" || c.status === "partial") {
      for (const rel of impl) {
        if (!fs.existsSync(path.join(root, rel))) problems.push(`${c.id}: implementation path does not exist - ${rel}`);
      }
      for (const ref of tests) {
        const contents = readFileOrNull(ref.file);
        if (contents === null) problems.push(`${c.id}: test file does not exist - ${ref.file}`);
        else if (!registersLiveTest(contents, ref.name)) problems.push(`${c.id}: no such live test in ${ref.file} - "${ref.name}"`);
      }
    }
    if (c.status === "partial" && !(c.note && c.note.trim())) problems.push(`${c.id}: partial row needs a note`);
    if (c.status === "done") {
      if (impl.length === 0) problems.push(`${c.id}: done without an implementation`);
      const justified = c.verifiedBy !== "test" && c.note && c.note.trim();
      if (tests.length === 0 && !justified) problems.push(`${c.id}: done without a test`);
    }
  }
  return problems;
}

test("P16-AC-40: every required AC id is present exactly once", () => {
  const reg = loadRegister();
  assert.equal(reg.phase, 16);
  assert.deepEqual(reg.criteria.map((c) => c.id), REQUIRED_IDS);
  assert.equal(new Set(reg.criteria.map((c) => c.id)).size, REQUIRED_IDS.length);
  for (const c of reg.criteria) {
    assert.ok(c.text && c.text.trim().length > 5, `${c.id} must carry the criterion text`);
  }
});

test("P16-AC-40: every done or partial row resolves to existing implementation paths and live tests", (t) => {
  const reg = loadRegister();
  const problems = checkRegister(reg);
  assert.deepEqual(problems, [], `register problems:\n  ${problems.join("\n  ")}`);
  const counts = { done: 0, partial: 0, planned: 0 };
  for (const c of reg.criteria) counts[c.status] += 1;
  t.diagnostic(`P16 register: done=${counts.done} partial=${counts.partial} planned=${counts.planned} total=${reg.criteria.length}`);
  assert.equal(counts.done + counts.partial + counts.planned, REQUIRED_IDS.length);
});

test("P16-AC-40 negative control: a bogus test name, a missing implementation path and a duplicate id are each rejected", () => {
  const base = loadRegister();
  assert.deepEqual(checkRegister(base), []);
  const fresh = () => JSON.parse(JSON.stringify(base));
  const doneRow = (reg) => reg.criteria.find((c) => c.status === "done" && c.tests.length > 0);

  const bogus = fresh();
  doneRow(bogus).tests.push({ file: doneRow(bogus).tests[0].file, name: "a test that was never written anywhere" });
  assert.ok(checkRegister(bogus).some((p) => /no such live test/.test(p)));

  const noFile = fresh();
  doneRow(noFile).tests.push({ file: "tests/regression/no-such-file.cjs", name: "x" });
  assert.ok(checkRegister(noFile).some((p) => /test file does not exist/.test(p)));

  const missingImpl = fresh();
  doneRow(missingImpl).implementation.push("src/core/parallel/DoesNotExist.js");
  assert.ok(checkRegister(missingImpl).some((p) => /implementation path does not exist/.test(p)));

  const dup = fresh();
  dup.criteria.push(JSON.parse(JSON.stringify(dup.criteria[0])));
  assert.ok(checkRegister(dup).some((p) => /appears 2 times/.test(p)));

  const gone = fresh();
  gone.criteria.pop();
  assert.ok(checkRegister(gone).some((p) => /missing from the register/.test(p)));

  const noImplDone = fresh();
  const row = doneRow(noImplDone);
  row.implementation = [];
  assert.ok(checkRegister(noImplDone).some((p) => /done without an implementation/.test(p)));

  const noTestDone = fresh();
  const row2 = doneRow(noTestDone);
  row2.tests = [];
  assert.ok(checkRegister(noTestDone).some((p) => /done without a test/.test(p)));

  for (const contents of [`// ${"x: t"}\n`, `test.skip("x: t", () => {});\n`, `assert.ok(true, "see x: t");\n`]) {
    assert.equal(registersLiveTest(contents, "x: t"), false);
  }
  assert.equal(registersLiveTest("test(`${name}: a loop title`, () => {});", "${name}: a loop title"), true);
});

module.exports = { checkRegister, registersLiveTest };
