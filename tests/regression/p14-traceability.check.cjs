"use strict";

/**
 * P14-29 regression: compatibility/traceability gates with no existing
 * named test — AC-51 (Tier 2.5 works with no OpenAI) and AC-53 (CommonJS /
 * the Node floor).
 *
 * AC-51 per the Gate 0 QA testability review (08-qa-testability.md, section
 * 1/D1): an absent-API-key test alone does NOT prove the Tier 2.5 scorer's
 * decision path is network-free — it only proves there is a missing-key
 * fallback somewhere else (Tier 3). Two independent controls are required:
 *
 *   1. STATIC — an import-graph walk from CandidateMatcher.js and
 *      SelectorBuilder.js asserting neither module (nor anything it
 *      transitively `require()`s) ever references the OpenAI SDK, `http`,
 *      `https`, `net`, or a fetch-polyfill module. In this revision both
 *      modules have zero `require()` calls at all (see their own header
 *      comments), so the graph is a single node — but the walk is written
 *      generically so it stays a real check if a future change adds one.
 *   2. DYNAMIC — `global.fetch`, `http.request` and `https.request` are
 *      stubbed to throw unconditionally, `OPENAI_API_KEY` is set to a dummy
 *      value (the part that actually distinguishes "no key" from "cannot
 *      reach the network even if it wanted to"), and the full Tier 2.5
 *      decision path (CandidateMatcher.evaluate + SelectorBuilder.build) is
 *      run against a fixed fixture and asserted byte-identical to the same
 *      run with nothing stubbed.
 *
 * Run directly with `node --test`, independent of the rest of the suite.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { root } = require("./helpers.cjs");

const CandidateMatcher = require(path.join(root, "src", "core", "locator", "CandidateMatcher.js"));
const SelectorBuilder = require(path.join(root, "src", "core", "locator", "SelectorBuilder.js"));

const CANDIDATE_MATCHER_PATH = path.join(root, "src", "core", "locator", "CandidateMatcher.js");
const SELECTOR_BUILDER_PATH = path.join(root, "src", "core", "locator", "SelectorBuilder.js");

const BANNED_MODULE_RE = /^(node:)?(https?|net|tls|dgram|dns|child_process|cluster)$/i;
const BANNED_SUBSTRING_RE = /openai|node-fetch|undici|cross-fetch|ws$|websocket/i;

// ---------------------------------------------------------------------------
// AC-51 control 1 — static import-graph walk.
// ---------------------------------------------------------------------------

/** Every bare-string argument to a top-level `require(...)` call in `source`. */
function extractRequireSpecifiers(source) {
  const specifiers = [];
  const re = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(source))) specifiers.push(m[2]);
  return specifiers;
}

/**
 * Walk the require graph starting at `entryPath`, returning
 * {visitedFiles, specifiers} — every file visited and every specifier
 * string seen anywhere in the graph (including ones that didn't resolve to
 * a file, e.g. a bare built-in or package name, which is exactly what we
 * need to check against the banned list).
 */
function walkRequireGraph(entryPath) {
  const visitedFiles = new Set();
  const allSpecifiers = new Set();
  const queue = [entryPath];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visitedFiles.has(current)) continue;
    visitedFiles.add(current);

    const source = fs.readFileSync(current, "utf8");
    for (const specifier of extractRequireSpecifiers(source)) {
      allSpecifiers.add(specifier);
      if (specifier.startsWith(".")) {
        const resolved = require.resolve(path.join(path.dirname(current), specifier));
        if (!visitedFiles.has(resolved)) queue.push(resolved);
      }
      // Bare/builtin specifiers (http, openai, etc.) are recorded but never
      // followed as a file — they are exactly what the banned-list check
      // below is for.
    }
  }
  return { visitedFiles, allSpecifiers };
}

function assertNoNetworkInGraph(entryPath, label) {
  const { visitedFiles, allSpecifiers } = walkRequireGraph(entryPath);
  for (const specifier of allSpecifiers) {
    assert.ok(
      !BANNED_MODULE_RE.test(specifier) && !BANNED_SUBSTRING_RE.test(specifier),
      `${label}: require graph references "${specifier}", which is a banned network/LLM-provider module`
    );
  }
  return visitedFiles;
}

test("AC-51 static control: CandidateMatcher's require graph never references a network or OpenAI module", () => {
  const visited = assertNoNetworkInGraph(CANDIDATE_MATCHER_PATH, "CandidateMatcher.js");
  assert.equal(visited.size, 1, "CandidateMatcher.js currently has zero require() calls at all — the graph must be exactly one node");
});

test("AC-51 static control: SelectorBuilder's require graph never references a network or OpenAI module", () => {
  const visited = assertNoNetworkInGraph(SELECTOR_BUILDER_PATH, "SelectorBuilder.js");
  assert.equal(visited.size, 1, "SelectorBuilder.js currently has zero require() calls at all — the graph must be exactly one node");
});

test("AC-51 static control negative test: the banned-module check actually catches a banned require (proves the gate can fail)", () => {
  const specifiers = extractRequireSpecifiers('const http = require("http");\nconst openai = require("openai");\n');
  assert.deepEqual(specifiers, ["http", "openai"]);
  const flagged = specifiers.filter((s) => BANNED_MODULE_RE.test(s) || BANNED_SUBSTRING_RE.test(s));
  assert.deepEqual(flagged, ["http", "openai"], "both injected banned specifiers must be detected");
});

test("AC-51 static control negative test: a scratch copy of CandidateMatcher.js with an injected http require is caught by the walk", () => {
  const originalSource = fs.readFileSync(CANDIDATE_MATCHER_PATH, "utf8");
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "p14-static-check-"));
  try {
    const scratchPath = path.join(dir, "CandidateMatcherBad.js");
    fs.writeFileSync(scratchPath, `"use strict";\nconst http = require("http");\n${originalSource}`, "utf8");
    assert.throws(() => assertNoNetworkInGraph(scratchPath, "scratch"), /banned network\/LLM-provider module/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    void originalSource;
  }
});

// ---------------------------------------------------------------------------
// AC-51 control 2 — dynamic fetch/http stub, WITH an OPENAI_API_KEY set.
// ---------------------------------------------------------------------------

function goldenFixtureInput() {
  return {
    storedSignature: {
      schemaVersion: 1,
      tagName: "button",
      role: "button",
      accessibleNameApprox: "Submit order",
      attributes: { id: "submit-btn", "data-testid": "submit-order", type: "submit" },
      structuralPath: ["form", "div", "button"],
      textApprox: "Submit order",
      boundingBoxBucket: "bottom-right-small",
    },
    liveCandidates: [
      {
        selector: "#submit-btn",
        signature: {
          schemaVersion: 1,
          tagName: "button",
          role: "button",
          accessibleNameApprox: "Submit order",
          attributes: { id: "submit-btn", "data-testid": "submit-order", type: "submit" },
          structuralPath: ["form", "div", "button"],
          textApprox: "Submit order",
          boundingBoxBucket: "bottom-right-small",
        },
      },
      {
        selector: "#cancel-btn",
        signature: {
          schemaVersion: 1,
          tagName: "button",
          role: "button",
          accessibleNameApprox: "Cancel",
          attributes: { id: "cancel-btn" },
          structuralPath: ["form", "div", "button"],
          textApprox: "Cancel",
          boundingBoxBucket: "bottom-left-small",
        },
      },
    ],
    action: "click",
  };
}

function runFullTier25DecisionPath() {
  const matched = CandidateMatcher.evaluate(JSON.parse(JSON.stringify(goldenFixtureInput())));
  let built = null;
  if (matched.status === "accepted") {
    built = SelectorBuilder.build({
      attributes: { id: "submit-btn", "data-testid": "submit-order" },
      tagName: "button",
      matchCounts: { '[data-testid="submit-order"]': 1, "#submit-btn": 1 },
    });
  }
  return { matched, built };
}

test("AC-51 dynamic control: Tier 2.5 decision path is byte-identical with global.fetch and http/https.request stubbed to throw, OPENAI_API_KEY SET", (t) => {
  const baseline = runFullTier25DecisionPath();
  assert.equal(baseline.matched.status, "accepted", "the fixture must exercise the real acceptance path, not a trivial refusal");

  const originalFetch = global.fetch;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalKey = process.env.OPENAI_API_KEY;

  t.after(() => {
    if (originalFetch === undefined) delete global.fetch;
    else global.fetch = originalFetch;
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  global.fetch = () => {
    throw new Error("network access attempted — Tier 2.5 decision path must never do this");
  };
  http.request = () => {
    throw new Error("http.request attempted — Tier 2.5 decision path must never do this");
  };
  https.request = () => {
    throw new Error("https.request attempted — Tier 2.5 decision path must never do this");
  };
  // Setting the key is the part that actually distinguishes "doesn't have a
  // key" from "cannot reach the network even if it wanted to" (P14-06
  // section 1/D1) — a present key makes Tier 3's own code reachable in
  // principle; this test proves Tier 2.5 never calls into it regardless.
  process.env.OPENAI_API_KEY = "sk-dummy-not-a-real-key-p14-29";

  const stubbed = runFullTier25DecisionPath();
  assert.deepEqual(stubbed, baseline, "stubbing the network and setting a dummy API key must not change the decision path's output at all");
});

test("AC-51 dynamic control sanity: the stub is actually active (proves the dynamic control itself can fail)", (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    if (originalFetch === undefined) delete global.fetch;
    else global.fetch = originalFetch;
  });
  global.fetch = () => {
    throw new Error("stubbed");
  };
  assert.throws(() => global.fetch(), /stubbed/, "if this assertion ever fails, the stub itself is broken and the dynamic control above is vacuous");
});

// ---------------------------------------------------------------------------
// AC-53 — CommonJS and the Node floor.
// ---------------------------------------------------------------------------

const PACKAGE_JSON_PATH = path.join(root, "package.json");

test("AC-53: package.json declares an engines.node floor matching the project's stated Node floor", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  assert.ok(pkg.engines && typeof pkg.engines.node === "string", "package.json must declare engines.node");
  assert.equal(pkg.engines.node, ">=20.19.0", "engines.node must match CLAUDE.md's stated floor (Node >= 20.19)");
});

test("AC-53: package.json does not declare \"type\": \"module\" — the project stays CommonJS by default", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  assert.ok(!Object.hasOwn(pkg, "type") || pkg.type === "commonjs", 'package.json must not set "type": "module"');
});

const PHASE_14_MODULES = [
  "LocatorIdentity.js",
  "ElementSignature.js",
  "CandidateMatcher.js",
  "SelectorBuilder.js",
  "ElementFactsCollector.js",
  "LocatorMemory.js",
  "sharedLocatorMemory.js",
  "HealingBenchmark.js",
].map((name) => path.join(root, "src", "core", "locator", name));

const ESM_SYNTAX_RE = /^\s*(import\s+[^(]|export\s+(default|const|function|class|\{))/m;

test("AC-53: every Phase 14 locator module is plain CommonJS — no import/export syntax, and node --check succeeds", async () => {
  const { execFileSync } = require("node:child_process");
  for (const modulePath of PHASE_14_MODULES) {
    assert.ok(fs.existsSync(modulePath), `expected Phase 14 module at ${modulePath}`);
    const source = fs.readFileSync(modulePath, "utf8");
    assert.ok(
      !ESM_SYNTAX_RE.test(source),
      `${path.basename(modulePath)} contains ESM import/export syntax — Phase 14 modules must stay CommonJS`
    );
    assert.ok(/module\.exports/.test(source), `${path.basename(modulePath)} must export via module.exports (CommonJS)`);
    // node --check validates syntax under the ACTUAL running Node binary,
    // not just a regex — this is the authoritative half of the check.
    execFileSync(process.execPath, ["--check", modulePath], { stdio: "pipe" });
  }
});

test("AC-53 negative control: the ESM-syntax regex actually catches an import statement (proves the gate can fail)", () => {
  assert.ok(ESM_SYNTAX_RE.test('import Foo from "./Foo.js";\n'));
  assert.ok(ESM_SYNTAX_RE.test('export default class Foo {}\n'));
  assert.ok(!ESM_SYNTAX_RE.test('const Foo = require("./Foo.js");\nmodule.exports = Foo;\n'));
});

// ---------------------------------------------------------------------------
// AC-54 / AC-55 / AC-56 — CI state-persistence policy.
//
// QA classified these as "implemented, not independently test-covered"
// because the policy lives in `.github/workflows/ci.yml` comments rather
// than an executable assertion. The coordinator's round-2 note is right
// that a real regression gate is available for three of the four: the
// restore/save steps' `path:` lists are plain text in a file this test can
// read, and the hazard (someone later "tidies up" by adding the new
// locator-memory store to the same cache pair, letting one branch inherit
// another branch's approved evidence) is exactly what a text-level
// assertion catches the moment it happens.
//
// AC-57 (cache failure cannot hide test results) is deliberately NOT
// covered here — it is a property of GitHub Actions' own restore-step
// semantics (a failed restore does not fail the job), not of anything
// Falcon's own code or config decides. Asserting that would mean asserting
// someone else's platform behaviour, which is a worse gap than an honest
// omission.
// ---------------------------------------------------------------------------

const CI_YML_PATH = path.join(root, ".github", "workflows", "ci.yml");

const APPROVED_STATE_FILES = [
  "data/scenario_history.json",
  "data/quarantine_decisions.json",
  "data/healing_pending.json",
  "data/healing_decisions.json",
];

const RESTORE_STEP_HEADING = "- name: Restore Falcon state (flakiness/quarantine/healing)";
const SAVE_STEP_HEADING = "- name: Save Falcon state (flakiness/quarantine/healing)";

/**
 * Pull the YAML block-scalar list of `data/*.json` paths out of the named
 * step's `path: |` block in `text`, starting the search from `fromIndex`
 * (so the restore step and the save step, which share an identical file
 * list, are each located unambiguously rather than both matching the first
 * `path: |` in the document). Returns `null` if the heading isn't found at
 * all, so a caller can distinguish "the step is missing" from "the step
 * exists with an empty list" rather than treating both as the same failure.
 */
function extractCacheStepPathList(text, stepHeading, fromIndex = 0) {
  const headingIndex = text.indexOf(stepHeading, fromIndex);
  if (headingIndex === -1) return null;

  const afterHeading = text.slice(headingIndex);
  const pathMarker = "path: |";
  const pathIndex = afterHeading.indexOf(pathMarker);
  assert.ok(pathIndex !== -1, `found step heading "${stepHeading}" but no "path: |" block after it`);

  const afterPathMarker = afterHeading.slice(pathIndex + pathMarker.length);
  const lines = afterPathMarker.split("\n");
  const files = [];
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (!trimmed.startsWith("data/")) break; // first non-"data/..." line ends the block-scalar list
    files.push(trimmed);
  }
  return { files, headingIndex };
}

test("AC-54/AC-55: the CI cache restore step's path list is exactly the four approved Falcon state files, and carries the explanatory comment", () => {
  const text = fs.readFileSync(CI_YML_PATH, "utf8");
  const restore = extractCacheStepPathList(text, RESTORE_STEP_HEADING);
  assert.ok(restore, `could not find the "${RESTORE_STEP_HEADING}" step in ci.yml at all`);
  assert.deepEqual(
    restore.files,
    APPROVED_STATE_FILES,
    "the restore step's cached path list must be exactly the four approved state files, in order, nothing added and nothing missing"
  );

  // AC-54: an explicit, explanatory, human-readable policy must actually be
  // present near the step, not just a path list with no stated rationale.
  const commentWindow = text.slice(Math.max(0, restore.headingIndex - 1500), restore.headingIndex);
  assert.match(
    commentWindow,
    /data\/locator_memory\.json[\s\S]{0,400}(deliberately excluded|must not be restored)/i,
    "the explanatory comment documenting the approved persistence policy must be present immediately above the restore step"
  );
});

test("AC-54/AC-55: the CI cache SAVE step's path list is exactly the four approved Falcon state files (restore and save stay in lockstep)", () => {
  const text = fs.readFileSync(CI_YML_PATH, "utf8");
  const restore = extractCacheStepPathList(text, RESTORE_STEP_HEADING);
  const save = extractCacheStepPathList(text, SAVE_STEP_HEADING, restore.headingIndex + 1);
  assert.ok(save, `could not find the "${SAVE_STEP_HEADING}" step in ci.yml at all`);
  assert.deepEqual(
    save.files,
    APPROVED_STATE_FILES,
    "the save step's cached path list must be exactly the four approved state files, in order — a drift between restore and save is itself a bug this test must catch"
  );
});

test("AC-56: data/locator_memory.json (Phase 14's evidence-based store) appears in NEITHER the restore nor the save cache path list", () => {
  const text = fs.readFileSync(CI_YML_PATH, "utf8");
  const restore = extractCacheStepPathList(text, RESTORE_STEP_HEADING);
  const save = extractCacheStepPathList(text, SAVE_STEP_HEADING, restore.headingIndex + 1);

  for (const file of [...restore.files, ...save.files]) {
    assert.notEqual(
      file,
      "data/locator_memory.json",
      "data/locator_memory.json must never be cached — a PR branch could otherwise silently inherit another branch's approved/revoked locator evidence"
    );
  }
  // data/locator_store.json (Phase 8's approved Tier-2 selector cache) is
  // excluded for an older, independently-documented reason and must stay
  // excluded too, though that is not this test's own AC.
  for (const file of [...restore.files, ...save.files]) {
    assert.notEqual(file, "data/locator_store.json");
  }
});

test("AC-56 negative control: the SAME check catches data/locator_memory.json the moment it is added to a scratch copy of the restore list (proves the gate can fail)", () => {
  const realText = fs.readFileSync(CI_YML_PATH, "utf8");

  // Build a scratch copy with the hazard the coordinator described: someone
  // "tidies up" by adding the new store into the restore step's path list.
  const restore = extractCacheStepPathList(realText, RESTORE_STEP_HEADING);
  const headingIndex = restore.headingIndex;
  const pathMarkerIndex = realText.indexOf("path: |", headingIndex);
  const insertAt = realText.indexOf("\n", pathMarkerIndex) + 1;
  const indentMatch = /^( +)data\//.exec(realText.slice(insertAt));
  const indent = indentMatch ? indentMatch[1] : "            ";
  const tampered = realText.slice(0, insertAt) + `${indent}data/locator_memory.json\n` + realText.slice(insertAt);

  const tamperedRestore = extractCacheStepPathList(tampered, RESTORE_STEP_HEADING);
  assert.ok(
    tamperedRestore.files.includes("data/locator_memory.json"),
    "sanity: the scratch copy must actually contain the injected line, or this negative control proves nothing"
  );

  assert.throws(() => {
    for (const file of tamperedRestore.files) {
      assert.notEqual(file, "data/locator_memory.json", "data/locator_memory.json must never be cached");
    }
  }, /data\/locator_memory\.json must never be cached/);

  // And the real, untampered file must still pass the identical check —
  // proving this isn't a gate that merely always fails or always passes.
  assert.doesNotThrow(() => {
    for (const file of restore.files) {
      assert.notEqual(file, "data/locator_memory.json");
    }
  });
});

module.exports = { walkRequireGraph, extractRequireSpecifiers, extractCacheStepPathList };
