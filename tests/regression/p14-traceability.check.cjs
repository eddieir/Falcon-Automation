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

module.exports = { walkRequireGraph, extractRequireSpecifiers };
