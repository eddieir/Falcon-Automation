/**
 * M0 #76: docs/CAPABILITY-TRUTH-TABLE.md must stay consistent with the repository.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const STATUSES = new Set(["SHIPPED", "PARTIAL", "PLANNED", "UNVERIFIED"]);

function rowsOf(md, headerStart) {
  const lines = md.split("\n");
  const i = lines.findIndex((l) => l.startsWith(headerStart));
  if (i < 0) return [];
  const rows = [];
  for (let j = i + 2; j < lines.length && lines[j].startsWith("|"); j++) {
    rows.push(lines[j].split("|").slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}

const paths = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

function problems(md, exists = (rel) => fs.existsSync(path.join(ROOT, rel))) {
  const out = [];
  const gaps = new Set(rowsOf(md, "| Gap |").map((r) => r[0]));
  const ids = new Set();
  const caps = rowsOf(md, "| ID |");
  if (caps.length === 0) out.push("no capability rows found");
  for (const [id, , , status, evidence, limits] of caps) {
    if (ids.has(id)) out.push(id + " duplicate id");
    ids.add(id);
    if (!STATUSES.has(status)) { out.push(id + " invalid status " + status); continue; }
    const files = paths(evidence);
    if (status !== "UNVERIFIED" && files.length === 0) out.push(id + " cites no evidence");
    for (const f of files) if (!exists(f)) out.push(id + " cites missing file " + f);
    if (status === "SHIPPED" || status === "PARTIAL") {
      if (!files.some((f) => f.startsWith("tests/") || f.startsWith(".github/") || f.startsWith("playwright"))) {
        out.push(id + " has no executable evidence");
      }
    }
    if (status === "PLANNED" && !files.some((f) => f.startsWith("docs/"))) out.push(id + " PLANNED without a plan document");
    if (status === "PLANNED" && files.some((f) => f.startsWith("tests/"))) out.push(id + " PLANNED but cites tests");
    if (status === "PARTIAL" && (!limits || limits.toLowerCase() === "none.")) out.push(id + " PARTIAL without a stated limit");
    if (status === "UNVERIFIED") {
      const g = (limits.match(/G-\d+/) || [])[0];
      if (!g || !gaps.has(g)) out.push(id + " UNVERIFIED without a registered gap");
    }
  }
  return out;
}

test("AC76-01..04: the committed truth table has no problems", () => {
  assert.deepEqual(problems(read("docs/CAPABILITY-TRUTH-TABLE.md")), []);
});

test("AC76-02 negative: invalid status, missing file, missing limit, unregistered gap are rejected", () => {
  const md = [
    "| ID | Capability | Claimed in | Status | Executable evidence | Known limits |",
    "| --- | --- | --- | --- | --- | --- |",
    "| CAP-1 | a | b | WORKS | `tests/x.cjs` | l |",
    "| CAP-2 | a | b | SHIPPED | `tests/nope.cjs` | l |",
    "| CAP-3 | a | b | PARTIAL | `tests/regression/cli.check.cjs` |  |",
    "| CAP-4 | a | b | UNVERIFIED | none | See G-9. |",
    "| CAP-5 | a | b | PLANNED | `tests/regression/cli.check.cjs` | l |",
    "| CAP-5 | a | b | SHIPPED | `docs/PHASE-PLANS.md` | l |",
    "",
    "| Gap | Affects | What is missing |",
    "| --- | --- | --- |",
    "| G-1 | CAP-4 | x |",
  ].join("\n");
  const p = problems(md).join("\n");
  for (const m of ["invalid status", "missing file", "without a stated limit", "unregistered gap", "PLANNED without a plan", "PLANNED but cites tests", "duplicate id", "no executable evidence"]) {
    assert.match(p, m === "unregistered gap" ? /UNVERIFIED without a registered gap/ : new RegExp(m));
  }
  assert.deepEqual(problems("no table here"), ["no capability rows found"]);
});

test("AC76-01 boundary: UNVERIFIED rows may cite no file; every README capability has a row", () => {
  const md = read("docs/CAPABILITY-TRUTH-TABLE.md");
  assert.ok(rowsOf(md, "| ID |").some((r) => r[3] === "UNVERIFIED" && r[4] === "none"));
  const readme = read("README.md");
  const labels = rowsOf(readme, "| Capability | Available today").map((r) => r[0]);
  assert.ok(labels.length >= 8);
  const claimed = rowsOf(md, "| ID |").map((r) => r[2]).join("\n");
  for (const l of labels) assert.ok(claimed.includes("README: " + l), "no truth-table row for README capability: " + l);
});

test("AC76-01,03: every status is used, gaps are all referenced, and README links the table", () => {
  const md = read("docs/CAPABILITY-TRUTH-TABLE.md");
  const caps = rowsOf(md, "| ID |");
  assert.deepEqual(new Set(caps.map((r) => r[3])), STATUSES);
  for (const [g] of rowsOf(md, "| Gap |")) assert.ok(caps.some((r) => r[5].includes(g)), g + " is not referenced by a row");
  assert.match(read("README.md"), /\]\(docs\/CAPABILITY-TRUTH-TABLE\.md\)/);
});

test("AC76-01,03: misleading comparative claims stay corrected", () => {
  const plans = read("docs/PHASE-PLANS.md");
  for (const bad of [
    "No generation, no healing, no flake intelligence",
    "silent and proprietary",
    "trusted with no human ever seeing it",
    "Every competitor requires per-test authorship",
    "It is a different offer",
    "it should be in a different category",
  ]) assert.ok(!plans.includes(bad), "reintroduced claim: " + bad);
  assert.match(plans, /CAPABILITY-TRUTH-TABLE\.md/);
});

test("AC76-04: the CLI exit-code guarantee the table cites is still tested", () => {
  assert.match(read("tests/regression/cli.check.cjs"), /honest exit status/);
});
