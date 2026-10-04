"use strict";

/**
 * P14-29 regression: competitor-matrix data integrity and a published-claims
 * doc-lint.
 *
 * This file backstops AC-64, AC-69 and AC-70, each of which the Gate 0 QA
 * testability review (08-qa-testability.md, section 3) found had NO
 * mechanical gate at all. It builds the three gates that review specified
 * as the closest-available alternative to a behavioral test:
 *
 *   - AC-70: `docs/research/competitor-matrix.json` is structured data with
 *     a required, enum-typed status cell per competitor-per-feature pair,
 *     restricted to exactly VERIFIED | UNKNOWN | NOT_FOUND_IN_DOCS |
 *     MARKETING_CLAIM | ACCOUNT_ACCESS_REQUIRED | FETCH_BLOCKED, with no
 *     default and no blank allowed. A schema test below asserts every cell
 *     in the full competitor x feature cross product carries exactly one of
 *     those six values.
 *
 *   - AC-64: every differentiation "claim" the matrix records cites at
 *     least one source, and every cited source id resolves to a real row in
 *     the matrix's own `sources` list. A schema test asserts no claim ever
 *     references a source that does not exist.
 *
 *   - AC-69: a heuristic doc-lint scans the two published Phase 14 research
 *     documents for superiority-shaped sentences ABOUT FALCON (comparatives,
 *     percentages, "best"/"highest"/"safer than"/uniqueness assertions, and
 *     the project's exact banned phrases) and requires each one to sit
 *     within a few lines of a "Conditions:" / "Limitations:" marker, unless
 *     the sentence itself is already a negation, a rhetorical question, or
 *     sits inside a heading-scoped "claims to avoid" checklist section.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES **NOT** PROVE (stated once here, binding for every test
 * below, exactly as the Gate 0 QA review required):
 *
 *   - The AC-70 schema test proves the matrix's DATA INTEGRITY (no missing
 *     cell, no invalid status, no default silently favouring Falcon). It
 *     does NOT prove the prose anyone later writes FROM this data honestly
 *     reflects it — that stays a human review gate.
 *   - The AC-64 source-linkage test proves every claim CITES something that
 *     exists. It does NOT prove the citation actually SUPPORTS the claim's
 *     argument in a sound way ("supports" in the evidentiary-sufficiency
 *     sense) — that judgment call is explicitly out of reach for an
 *     automated test and stays a QA/Release Manager review gate.
 *   - The AC-69 doc-lint is a MECHANICAL, HEURISTIC pattern scanner. It
 *     catches an UNQUALIFIED claim (one with no nearby Conditions/
 *     Limitations marker) but it CANNOT judge whether stated conditions are
 *     ADEQUATE, complete, or honest — only that something resembling a
 *     marker exists nearby. A human (Release Manager, per the Definition of
 *     Done) remains the actual authority on AC-69. Passing this test is not
 *     sufficient proof of AC-69 on its own, and must never be reported as
 *     such.
 *
 * Run directly with `node --test`, independent of the rest of the suite.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root, temp } = require("./helpers.cjs");

const MATRIX_PATH = path.join(root, "docs", "research", "competitor-matrix.json");

function loadMatrix() {
  const raw = fs.readFileSync(MATRIX_PATH, "utf8");
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// AC-70 — structured status cell, enum-restricted, no default, no blank.
// ---------------------------------------------------------------------------

test("AC-70: every competitor-x-feature cell carries exactly one of the six allowed statuses", () => {
  const matrix = loadMatrix();
  const featureIds = matrix.features.map((f) => f.id);
  assert.ok(featureIds.length > 0, "the matrix must declare at least one feature");
  assert.ok(Object.keys(matrix.competitors).length > 0, "the matrix must declare at least one competitor");

  const allowed = new Set(matrix.statusEnum);
  assert.deepEqual(
    [...allowed].sort(),
    ["ACCOUNT_ACCESS_REQUIRED", "FETCH_BLOCKED", "MARKETING_CLAIM", "NOT_FOUND_IN_DOCS", "UNKNOWN", "VERIFIED"],
    "the enum itself must be exactly the six-value vocabulary, no more and no fewer"
  );

  let checked = 0;
  for (const [vendor, entry] of Object.entries(matrix.competitors)) {
    for (const featureId of featureIds) {
      checked += 1;
      const cell = entry.cells && Object.hasOwn(entry.cells, featureId) ? entry.cells[featureId] : undefined;
      assert.ok(cell, `${vendor} is missing a cell for feature "${featureId}" — AC-70 forbids a missing cell`);
      assert.ok(
        typeof cell.status === "string" && cell.status.length > 0,
        `${vendor}/${featureId} has a blank or missing status`
      );
      assert.ok(
        allowed.has(cell.status),
        `${vendor}/${featureId} has status "${cell.status}", which is not one of the six allowed values`
      );
    }
  }
  assert.equal(checked, Object.keys(matrix.competitors).length * featureIds.length, "every cross-product cell was actually checked");
});

test("AC-70 negative control: a blank status is rejected by the same check that passes the real file", () => {
  const matrix = loadMatrix();
  const vendor = Object.keys(matrix.competitors)[0];
  const featureId = matrix.features[0].id;
  matrix.competitors[vendor].cells[featureId] = { status: "", value: null, sourceIds: [] };

  assert.throws(() => {
    const cell = matrix.competitors[vendor].cells[featureId];
    assert.ok(typeof cell.status === "string" && cell.status.length > 0, "status must not be blank");
  }, /status must not be blank/);
});

test("AC-70 negative control: a status outside the six-value enum is rejected", () => {
  const matrix = loadMatrix();
  const allowed = new Set(matrix.statusEnum);
  const vendor = Object.keys(matrix.competitors)[0];
  const featureId = matrix.features[0].id;
  matrix.competitors[vendor].cells[featureId] = { status: "PROBABLY_TRUE", value: "invented", sourceIds: [] };

  assert.throws(() => {
    const cell = matrix.competitors[vendor].cells[featureId];
    assert.ok(allowed.has(cell.status), `status "${cell.status}" is not one of the six allowed values`);
  }, /not one of the six allowed values/);
});

test("AC-70 negative control: a missing cell entirely is rejected, not silently skipped", () => {
  const matrix = loadMatrix();
  const vendor = Object.keys(matrix.competitors)[0];
  const featureId = matrix.features[0].id;
  delete matrix.competitors[vendor].cells[featureId];

  assert.throws(() => {
    const cell = matrix.competitors[vendor].cells[featureId];
    assert.ok(cell, `${vendor} is missing a cell for feature "${featureId}"`);
  }, /is missing a cell/);
});

// ---------------------------------------------------------------------------
// AC-64 — every claim's sourceIds resolve to a real row in the matrix's own
// sources list; no claim cites a source that does not exist.
// ---------------------------------------------------------------------------

test("AC-64: every claim cites at least one source, and every cited source id exists in the matrix's sources list", () => {
  const matrix = loadMatrix();
  const sourceIds = new Set(matrix.sources.map((s) => s.id));
  assert.ok(Array.isArray(matrix.claims) && matrix.claims.length > 0, "the matrix must record at least one claim");

  for (const claim of matrix.claims) {
    assert.ok(Array.isArray(claim.sourceIds) && claim.sourceIds.length > 0, `claim ${claim.id} cites no source at all`);
    for (const sid of claim.sourceIds) {
      assert.ok(sourceIds.has(sid), `claim ${claim.id} cites source "${sid}", which does not exist in the matrix's own sources list`);
    }
  }
});

test("AC-64 negative control: a claim citing a nonexistent source id is rejected by the same check that passes the real file", () => {
  const matrix = loadMatrix();
  const sourceIds = new Set(matrix.sources.map((s) => s.id));
  const badClaim = { id: "C-FAKE", text: "invented claim", sourceIds: ["S-99-does-not-exist"] };

  assert.throws(() => {
    for (const sid of badClaim.sourceIds) {
      assert.ok(sourceIds.has(sid), `claim ${badClaim.id} cites source "${sid}", which does not exist`);
    }
  }, /does not exist/);
});

test("AC-64: every source row the matrix declares is actually cited by at least one competitor cell or claim (no orphan source)", () => {
  const matrix = loadMatrix();
  const cited = new Set();
  for (const entry of Object.values(matrix.competitors)) {
    for (const cell of Object.values(entry.cells)) {
      for (const sid of cell.sourceIds || []) cited.add(sid);
    }
  }
  for (const claim of matrix.claims) for (const sid of claim.sourceIds) cited.add(sid);

  for (const source of matrix.sources) {
    assert.ok(cited.has(source.id), `source ${source.id} (${source.vendor}) is declared but never cited by any cell or claim`);
  }
});

// ---------------------------------------------------------------------------
// AC-69 — heuristic doc-lint for unqualified published superiority claims.
// ---------------------------------------------------------------------------

const EXACT_BANNED_PHRASES = [
  "best self-healing framework",
  "highest accuracy",
  "safer than every competitor",
  "zero-maintenance testing",
  "no false heals",
  "complete dom understanding",
  "production-grade superiority",
  "100 levels above competitors",
  "general dom understanding",
];

const COMPARATIVE_RE = /\b(best|highest|safer than|more accurate|better than|most accurate|fastest)\b/i;
const PERCENTAGE_RE = /\d{1,3}%/;
const UNIQUENESS_RE = /\b(unique|uniquely|the only (tool|product|framework))\b/i;
const ATOMIC_MULTIPROCESS_RE = /atomic rename[^.\n]{0,80}(multi-process|concurrent writer)[^.\n]{0,60}safe/i;
const HASH_IRRECOVERABLE_RE = /hash(ed)?[^.\n]{0,60}irrecoverable/i;

const NEGATION_RE = /\b(not|never|cannot|contradicts|prohibited|must avoid|checklist)\b/i;
const MARKER_RE = /\b(conditions|limitations)\s*:/i;
const HEADING_EXEMPT_RE = /avoid|prohibit|banned|checklist|must not/i;

function isHeadingLine(line) {
  return /^#{1,6}\s/.test(line) || /^\*\*\d+\.[^*]*\*\*\s*$/.test(line.trim());
}

function lineIsTriggered(line) {
  const lower = line.toLowerCase();
  if (EXACT_BANNED_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  if (COMPARATIVE_RE.test(line)) return true;
  if (PERCENTAGE_RE.test(line)) return true;
  if (UNIQUENESS_RE.test(line)) return true;
  if (ATOMIC_MULTIPROCESS_RE.test(line)) return true;
  if (HASH_IRRECOVERABLE_RE.test(line)) return true;
  return false;
}

/**
 * Scan `text` for unqualified Falcon-superiority-shaped sentences. Returns
 * an array of {lineNumber, line} violations. See the file header for what
 * this does and does not prove.
 */
function lintDocument(text) {
  const lines = text.split("\n");
  const violations = [];
  let sectionExempt = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isHeadingLine(line)) {
      sectionExempt = HEADING_EXEMPT_RE.test(line);
      continue;
    }

    if (!/Falcon/.test(line)) continue; // AC-69 is about Falcon's own published claims, not neutral competitor reporting.
    if (sectionExempt) continue;
    if (line.trim().endsWith("?")) continue; // rhetorical/analytical question, not an assertion.
    if (NEGATION_RE.test(line)) continue;
    if (!lineIsTriggered(line)) continue;

    const windowStart = Math.max(0, i - 8);
    const windowEnd = Math.min(lines.length - 1, i + 8);
    const hasMarker = lines.slice(windowStart, windowEnd + 1).some((l) => MARKER_RE.test(l));
    if (!hasMarker) {
      violations.push({ lineNumber: i + 1, line: line.trim() });
    }
  }
  return violations;
}

const SCANNED_DOCS = [
  path.join(root, "docs", "research", "phase-14-competitive-analysis.md"),
  path.join(root, "docs", "research", "phase-14-gap-analysis.md"),
];

test("AC-69 doc-lint: the two published Phase 14 research documents carry no unqualified Falcon superiority claim", () => {
  for (const docPath of SCANNED_DOCS) {
    const text = fs.readFileSync(docPath, "utf8");
    const violations = lintDocument(text);
    assert.deepEqual(
      violations,
      [],
      `${path.relative(root, docPath)} has unqualified superiority-shaped claim(s): ${JSON.stringify(violations)}`
    );
  }
});

test("AC-69 doc-lint negative control: an unqualified banned-phrase claim with no Conditions/Limitations marker is caught", () => {
  const bad = [
    "## Marketing Summary",
    "",
    "Falcon is the best self-healing framework available today.",
    "",
  ].join("\n");
  const violations = lintDocument(bad);
  assert.equal(violations.length, 1);
  assert.match(violations[0].line, /best self-healing framework/);
});

test("AC-69 doc-lint negative control: an unqualified percentage claim about Falcon with no marker is caught", () => {
  const bad = ["Falcon reduces maintenance effort by 87% versus manual repair."].join("\n");
  const violations = lintDocument(bad);
  assert.equal(violations.length, 1);
});

test("AC-69 doc-lint negative control: the atomic-rename / multi-process-safety banned claim is caught", () => {
  const bad = ["Falcon's atomic rename gives full multi-process concurrent writer safety."].join("\n");
  const violations = lintDocument(bad);
  assert.equal(violations.length, 1);
});

test("AC-69 doc-lint negative control: the hashed-values-irrecoverable banned claim is caught", () => {
  const bad = ["Falcon's hashed locator values are irrecoverable, even to an operator holding the data file."].join("\n");
  const violations = lintDocument(bad);
  assert.equal(violations.length, 1);
});

test("AC-69 doc-lint: the SAME banned phrase is NOT flagged once a nearby Conditions/Limitations marker is present", () => {
  const good = [
    "Falcon is the best self-healing framework for this benchmark run.",
    "Conditions: measured on Falcon's own published synthetic corpus, mutation-class fixtures only.",
    "Limitations: no comparison against any competitor's actual accuracy was performed or is claimed.",
  ].join("\n");
  const violations = lintDocument(good);
  assert.deepEqual(violations, [], "a claim immediately followed by Conditions/Limitations must not be flagged");
});

test("AC-69 doc-lint: a claim inside a heading-scoped 'claims to avoid' checklist section is exempt, not a false positive", () => {
  const prose = [
    "**16. What claims must Falcon avoid after Phase 14?**",
    "Concrete prohibited-claims checklist, to be run against every externally published sentence:",
    "- \"Falcon has the most/highest accuracy,\" \"best self-healing framework,\" \"safer than every",
    "  competitor,\" \"100 levels above competitors,\" or any unqualified superlative.",
    "- \"Zero false heals\" / \"no false heals\" / \"eliminates test maintenance.\"",
  ].join("\n");
  const violations = lintDocument(prose);
  assert.deepEqual(violations, [], "a checklist of phrases NOT to say must not itself be flagged as saying them");
});

test("AC-69 doc-lint: a heading-scoped exemption ends at the next heading, so a later real section is still scanned", () => {
  const prose = [
    "**16. What claims must Falcon avoid after Phase 14?**",
    "- \"best self-healing framework\" or any unqualified superlative.",
    "",
    "## Published Summary",
    "",
    "Falcon is the best self-healing framework on the market.",
  ].join("\n");
  const violations = lintDocument(prose);
  assert.equal(violations.length, 1, "the exemption from section 16 must not leak into the unrelated section after it");
  assert.match(violations[0].line, /best self-healing framework on the market/);
});

// ---------------------------------------------------------------------------
// Sanity: the lint function itself is exercised against a real temp file
// path too, not only in-memory strings, so a future refactor that only
// works on string literals (e.g. assumes no trailing newline) is caught.
// ---------------------------------------------------------------------------

test("AC-69 doc-lint: works identically when the text comes from a file on disk", () => {
  const dir = temp();
  try {
    const filePath = path.join(dir, "scratch.md");
    fs.writeFileSync(filePath, "Falcon is the best self-healing framework available.\n", "utf8");
    const violations = lintDocument(fs.readFileSync(filePath, "utf8"));
    assert.equal(violations.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

module.exports = { lintDocument };
