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

const COMPARATIVE_RE = /\b(best|safer than|more accurate|better than|most accurate|fastest)\b/i;
// "highest" alone is handled separately from the rest of COMPARATIVE_RE
// because it has a legitimate non-superiority sense this repo's own risk
// registers use constantly: "highest-ranked risk" / "highest priority" is
// risk-management vocabulary (which risk sorts to the top of a list), not
// a claim that Falcon has the highest anything. Excluding exactly that
// idiom — and only that idiom — keeps "Falcon has the highest accuracy"
// caught (independently, it is also one of EXACT_BANNED_PHRASES) while
// retiring a real false positive found scanning phase-14-gap-analysis.md:175
// ("highest-ranked risk in QA's plan (R1 — ... Falcon worse than
// table-stakes competitors)") — note that sentence is already the OPPOSITE
// of a superiority claim (it says Falcon could be worse), which is further
// evidence "highest" there was never modifying a claim about Falcon at all.
const HIGHEST_SUPERIORITY_RE = /\bhighest\b(?!-ranked\b|\s+(?:ranked|priority)\b)/i;
const PERCENTAGE_RE = /\d{1,3}%/;
// Uniqueness / unsupported-negative-competitor-claim shape (round 3): round
// 2's four real violations shared this pattern — "the only one", "no
// competitor has/surfaces/exposes/documents/offers/supports", "uniquely",
// "first and only". The standing rule this phase established is that
// absence of evidence in a vendor's documentation is never evidence the
// vendor lacks the capability, so a claim of this shape about a named or
// unnamed competitor is exactly as dangerous as a bare superlative.
const UNIQUENESS_RE = /\b(unique|uniquely|the only (tool|product|framework|one)|first and only)\b/i;
const NEGATIVE_COMPETITOR_CLAIM_RE = /\bno competitors?\b[^.\n]{0,80}\b(has|have|surfaces?|expose[sd]?|exposing|document(s|ed)?|offers?|supports?|does|do|provides?)\b/i;
const ATOMIC_MULTIPROCESS_RE = /atomic rename[^.\n]{0,80}(multi-process|concurrent writer)[^.\n]{0,60}safe/i;
const HASH_IRRECOVERABLE_RE = /hash(ed)?[^.\n]{0,60}irrecoverable/i;

// Negation-aware: a line/paragraph carrying one of these is read as a hedge,
// a prohibition, or a correction — never itself an assertion of the claim —
// so it is exempt even if it also contains a trigger pattern. This is what
// lets "Requiring approval ... is **not** a differentiator", "was not
// established by the reviewed public documentation", and "is not a
// differentiator" stand without tripping the check that enforces exactly
// that rule. Deliberately excludes bare "no" (not "not") — "no false heals"
// is itself a banned phrase and "no competitor ... surfaces" is itself the
// new banned shape above; treating "no" as a negation marker would exempt
// the very claims this file exists to catch.
const NEGATION_RE = /\b(not|never|cannot|contradicts|prohibited|must avoid|checklist)\b/i;
const MARKER_RE = /\b(conditions|limitations)\s*:/i;
const HEADING_EXEMPT_RE = /avoid|prohibit|banned|checklist|must not/i;

function isHeadingLine(line) {
  return /^#{1,6}\s/.test(line) || /^\*\*\d+\.[^*]*\*\*\s*$/.test(line.trim());
}

/** A line that must never be merged with a PRIOR line's logical block — a markdown list item, table row, or heading each start their own unit, regardless of whether the previous line ended a sentence. */
function startsNewBlock(line) {
  return isHeadingLine(line) || /^\s*([-*]\s|\d+\.\s|\|)/.test(line);
}

/** True once `accumulated`'s own text already closed a sentence — the point past which a further physical line must never be folded into the same logical block, even absent a blank line or list marker. */
function endsLogicalBlock(accumulated) {
  return /[.!?:]\s*(\*\*)?$/.test(accumulated.trimEnd());
}

function textIsTriggered(blockText) {
  const lower = blockText.toLowerCase();
  if (EXACT_BANNED_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  if (COMPARATIVE_RE.test(blockText)) return true;
  if (HIGHEST_SUPERIORITY_RE.test(blockText)) return true;
  if (PERCENTAGE_RE.test(blockText)) return true;
  if (UNIQUENESS_RE.test(blockText)) return true;
  if (NEGATIVE_COMPETITOR_CLAIM_RE.test(blockText)) return true;
  if (ATOMIC_MULTIPROCESS_RE.test(blockText)) return true;
  if (HASH_IRRECOVERABLE_RE.test(blockText)) return true;
  return false;
}

/**
 * Split `lines` into logical scan units: markdown prose wraps a single
 * sentence across several physical lines with no blank line between them
 * (plain `textwrap`-style authoring, used throughout this repo's docs), so
 * scanning one physical line at a time misses a claim whose subject
 * ("Falcon") and trigger word land on different physical lines of the same
 * sentence — exactly the shape of the violation this round's report
 * described. Each returned unit is `{startLine, endLine, text}` (0-based,
 * inclusive); a heading is returned as its own unit with `isHeading: true`
 * and is never merged with anything.
 */
function toLogicalBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }
    if (isHeadingLine(lines[i])) {
      blocks.push({ startLine: i, endLine: i, text: lines[i], isHeading: true });
      i += 1;
      continue;
    }
    const startLine = i;
    const parts = [lines[i]];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "" && !startsNewBlock(lines[i]) && !endsLogicalBlock(parts.join(" "))) {
      parts.push(lines[i]);
      i += 1;
    }
    blocks.push({ startLine, endLine: i - 1, text: parts.join(" "), isHeading: false });
  }
  return blocks;
}

/**
 * Scan `text` for unqualified Falcon-superiority-shaped (or unsupported
 * negative-competitor-shaped) claims. Returns an array of
 * {lineNumber, line} violations — `lineNumber` is the FIRST physical line
 * of the logical block that triggered, 1-based. See the file header for
 * what this does and does not prove.
 */
function lintDocument(text) {
  const lines = text.split("\n");
  const blocks = toLogicalBlocks(lines);
  const violations = [];
  let sectionExempt = false;

  for (const block of blocks) {
    if (block.isHeading) {
      sectionExempt = HEADING_EXEMPT_RE.test(block.text);
      continue;
    }

    if (!/Falcon/.test(block.text)) continue; // AC-69 is about Falcon's own published claims, not neutral competitor reporting.
    if (sectionExempt) continue;
    if (block.text.trim().endsWith("?")) continue; // rhetorical/analytical question, not an assertion.
    if (NEGATION_RE.test(block.text)) continue;
    if (!textIsTriggered(block.text)) continue;

    const windowStart = Math.max(0, block.startLine - 8);
    const windowEnd = Math.min(lines.length - 1, block.endLine + 8);
    const hasMarker = lines.slice(windowStart, windowEnd + 1).some((l) => MARKER_RE.test(l));
    if (!hasMarker) {
      violations.push({ lineNumber: block.startLine + 1, line: block.text.trim() });
    }
  }
  return violations;
}

// Every tracked document that carries claims about Falcon or its
// competitors — not just the two Phase 14 research documents. Round 2 of
// this review found four real prohibited-claim violations that this lint
// could not see because it only ever opened the two research documents;
// every one of the four lived in docs/PHASE-PLANS.md, which was never on
// this list.
const SCANNED_DOCS = [
  path.join(root, "docs", "research", "phase-14-competitive-analysis.md"),
  path.join(root, "docs", "research", "phase-14-gap-analysis.md"),
  path.join(root, "docs", "PHASE-PLANS.md"),
  path.join(root, "README.md"),
  path.join(root, "HANDOFF.md"),
  path.join(root, "CHANGELOG.md"),
];

test("AC-69 doc-lint: every tracked document carrying claims about Falcon or its competitors has no unqualified superiority or unsupported negative-competitor claim", () => {
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

// ---------------------------------------------------------------------------
// Round 3: the uniqueness / unsupported-negative-competitor-claim shape, and
// the multi-physical-line sentence that let the four real violations slip
// past a per-line-only scan.
// ---------------------------------------------------------------------------

test("AC-69 doc-lint: a 'the only one' uniqueness claim about Falcon with no marker is caught", () => {
  const bad = "Falcon is the only one of these where an AI-inferred locator is quarantined pending human approval rather than silently trusted.";
  const violations = lintDocument(bad);
  assert.equal(violations.length, 1);
  assert.match(violations[0].line, /the only one/);
});

test("AC-69 doc-lint: a 'no competitor exposes/surfaces' unsupported negative claim is caught", () => {
  const bad1 = lintDocument("No competitor exposes a trend view that surfaces heal-rate drift the way Falcon does.");
  assert.equal(bad1.length, 1);
  const bad2 = lintDocument("No competitors document a review queue with this shape, so Falcon is first to ship one.");
  assert.equal(bad2.length, 1);
});

test("AC-69 doc-lint: 'uniquely' and 'first and only' about Falcon are caught", () => {
  assert.equal(lintDocument("Falcon is uniquely able to refuse a low-confidence heal.").length, 1);
  assert.equal(lintDocument("Falcon is the first and only tool to publish this benchmark.").length, 1);
});

test("AC-69 doc-lint: the SAME uniqueness claim is exempt once hedged with 'not established by the reviewed documentation' (the round-3 correction phrasing)", () => {
  const good = [
    "Whether a competitor surfaces queue staleness was not established by the reviewed public",
    "documentation, so nothing here claims they do not — absence of evidence in a vendor's docs is",
    "not evidence the vendor lacks the capability. Falcon should be the tool that refuses to let a",
    "stale queue happen quietly.",
  ].join("\n");
  assert.deepEqual(lintDocument(good), [], "a hedged, explicitly-not-established claim must not be flagged as an assertion");
});

test("AC-69 doc-lint: 'is not a differentiator' about Falcon does not trip the uniqueness/comparative check", () => {
  const good = "Requiring approval before reuse about Falcon is not a differentiator, since Katalon and Testsigma both already document their own approval step.";
  assert.deepEqual(lintDocument(good), []);
});

test("AC-69 doc-lint: a sentence about Falcon wrapped across several physical lines with no blank line between them is still scanned as one claim", () => {
  const bad = [
    "Falcon's structural advantage here is that it is the only one of these tools where an",
    "AI-inferred locator is quarantined pending human approval rather than being silently trusted",
    "the moment it is produced, unlike every other product reviewed in this research pass.",
  ].join("\n");
  const violations = lintDocument(bad);
  assert.equal(violations.length, 1, "a claim whose subject and trigger word land on different physical lines must still be caught");
  assert.match(violations[0].line, /the only one of these tools/);
});

test("AC-69 doc-lint: a demo-transcript line about CSS selector uniqueness (no 'Falcon' mention) is not mistaken for a competitive claim", () => {
  const notAClaim = "✓ the real search field is uniquely findable by its placeholder (count=1)";
  assert.deepEqual(lintDocument(notAClaim), [], "a line with no mention of Falcon is out of scope for AC-69 regardless of what other words it contains");
});

test("AC-69 doc-lint: a markdown list keeps each item as its own scan unit, even with no blank lines between items", () => {
  const prose = [
    "1. **Item one.** Falcon is the only one of these where this is true.",
    "2. **Item two.** A second, unrelated, perfectly ordinary sentence with no claim in it at all.",
  ].join("\n");
  const violations = lintDocument(prose);
  assert.equal(violations.length, 1, "only the first list item's claim must be flagged, not a merge of both items into one block");
  assert.match(violations[0].line, /Item one/);
});

test("AC-69 doc-lint negative control (round 3): the real phase-14-gap-analysis.md risk-register line ('highest-ranked risk') is a legitimate exemption, not a softened pattern", () => {
  // Regression guard for the false positive this round's own work surfaced:
  // "highest-ranked risk" is risk-management vocabulary (which risk sorts
  // to the top of a list), not a claim that Falcon has "the highest"
  // anything — and the same sentence already says the OPPOSITE of a
  // superiority claim (Falcon could be WORSE than table-stakes
  // competitors). The exact banned phrase "highest accuracy" must still be
  // caught; only this specific idiom is exempt.
  assert.deepEqual(
    lintDocument("- Cost/risk: highest-ranked risk in QA's plan (Falcon worse than table-stakes competitors)."),
    []
  );
  assert.deepEqual(lintDocument("This is the highest priority risk for Falcon to close."), []);
  assert.equal(lintDocument("Falcon has the highest accuracy of any tool reviewed.").length, 1, "the actual banned phrase must still be caught");
});

// ---------------------------------------------------------------------------
// Round 3 verification step 3: prove the new coverage (wider file list +
// uniqueness/negative-competitor shape) can actually fail, directly against
// scratch copies of the two newly-added real documents — then prove the
// real, unmodified files on disk still pass the identical check. Neither
// real file is ever written to.
// ---------------------------------------------------------------------------

test("AC-69 doc-lint round 3: a scratch copy of docs/PHASE-PLANS.md with an injected uniqueness claim is caught, and the real file is untouched and still passes", () => {
  const realPath = path.join(root, "docs", "PHASE-PLANS.md");
  const realText = fs.readFileSync(realPath, "utf8");

  const injected = realText + "\n\nFalcon is the only one of these tools that ships this feature at all.\n";
  const violations = lintDocument(injected);
  assert.ok(
    violations.some((v) => /the only one of these tools/.test(v.line)),
    "the injected uniqueness claim must be caught in the scratch copy"
  );

  // The real file on disk was only ever read, never written — re-reading it
  // here and re-running the lint proves it is still exactly as it was and
  // still passes.
  const rereadText = fs.readFileSync(realPath, "utf8");
  assert.equal(rereadText, realText, "the real file on disk must be byte-identical to what was first read — never modified by this test");
  assert.deepEqual(lintDocument(rereadText), [], "the real, untampered file must still pass");
});

test("AC-69 doc-lint round 3: a scratch copy of README.md with an injected uniqueness claim is caught, and the real file is untouched and still passes", () => {
  const realPath = path.join(root, "README.md");
  const realText = fs.readFileSync(realPath, "utf8");

  const injected = realText + "\n\nFalcon is uniquely capable of this, and no competitor exposes anything comparable.\n";
  const violations = lintDocument(injected);
  assert.ok(
    violations.some((v) => /uniquely capable/.test(v.line)),
    "the injected uniqueness claim must be caught in the scratch copy"
  );

  const rereadText = fs.readFileSync(realPath, "utf8");
  assert.equal(rereadText, realText, "the real file on disk must be byte-identical to what was first read — never modified by this test");
  assert.deepEqual(lintDocument(rereadText), [], "the real, untampered file must still pass");
});

module.exports = { lintDocument };
