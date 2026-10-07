"use strict";

/**
 * Phase 15 traceability. Run directly with `node --test`.
 *
 * 1. The acceptance-criteria register (docs/phase-15-acceptance-criteria.json):
 *    AC-01..AC-36 present exactly once, every implementation path exists, and
 *    every named test is registered as a live test(...) in the named file.
 * 2. Static checks the plan assigns here (docs/phase-15-plan.md sections 12-13):
 *    no history module reaches a shell (AC-33), and the CI workflow keeps the
 *    ledger cache, the advisory check and the main-only artifact as designed
 *    (AC-28, AC-29, AC-30).
 *
 * The workflow is read as text: js-yaml is not a dependency of this repository.
 * Each check works on whole "- name:" step blocks with comment lines removed.
 * Negative controls prove each checker can fail.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root } = require("./helpers.cjs");

const REGISTER_PATH = path.join(root, "docs", "phase-15-acceptance-criteria.json");
const CI_YML_PATH = path.join(root, ".github", "workflows", "ci.yml");
const VERIFIED_BY = new Set(["test", "platform", "review"]);
const COUNT = 36;

const loadRegister = () => JSON.parse(fs.readFileSync(REGISTER_PATH, "utf8"));
const idOf = (n) => `AC-${String(n).padStart(2, "0")}`;

const fileCache = new Map();
function readFileOrNull(rel) {
  if (!fileCache.has(rel)) {
    const abs = path.join(root, rel);
    fileCache.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null);
  }
  return fileCache.get(rel);
}

/**
 * True when `name` is the first argument of a live `test(` call. A comment, a
 * message string or `test.skip(` does not count. A name containing ${...} is
 * matched as the literal source title of a parameterised test.
 */
function registersLiveTest(contents, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`\btest\s*\(\s*(["'\x60])${escaped}\1`).test(contents);
}

/** Every "register row -> missing test" problem for the given criteria. */
function findMissingTests(criteria) {
  const missing = [];
  for (const c of criteria) {
    if (c.verifiedBy !== "test") continue;
    for (const ref of c.tests || []) {
      const contents = readFileOrNull(ref.file);
      if (contents === null) missing.push(`${c.id}: test file does not exist - ${ref.file}`);
      else if (!registersLiveTest(contents, ref.name)) missing.push(`${c.id}: no such live test in ${ref.file} - "${ref.name}"`);
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

test("AC-36: all 36 criteria are present exactly once, numbered AC-01 to AC-36 with no gaps", () => {
  const reg = loadRegister();
  assert.equal(reg.phase, 15);
  assert.equal(reg.criteriaSource, "docs/phase-15-plan.md section 12");
  assert.deepEqual(reg.criteria.map((c) => c.id), Array.from({ length: COUNT }, (_, i) => idOf(i + 1)));
  for (const c of reg.criteria) {
    assert.ok(c.text && c.text.trim().length > 10, `${c.id} must carry the criterion text`);
    assert.ok(c.section && c.section.trim(), `${c.id} must name its plan section`);
    assert.ok(c.priority === "Must" || c.priority === "Should", `${c.id} priority: ${c.priority}`);
    assert.ok(VERIFIED_BY.has(c.verifiedBy), `${c.id} has an unknown verifiedBy: ${c.verifiedBy}`);
  }
});

test("AC-36: every implementation path a criterion points at exists on disk", () => {
  for (const c of loadRegister().criteria) {
    assert.ok(Array.isArray(c.implementation) && c.implementation.length > 0, `${c.id} names no implementation`);
    for (const rel of c.implementation) {
      assert.ok(fs.existsSync(path.join(root, rel)), `${c.id} points at a missing implementation path: ${rel}`);
    }
  }
});

test("AC-36: every test-verified criterion names tests that are registered live, and platform/review rows justify themselves", () => {
  const { criteria } = loadRegister();
  for (const c of criteria) {
    if (c.verifiedBy === "test") {
      assert.ok(Array.isArray(c.tests) && c.tests.length > 0, `${c.id} claims verifiedBy "test" but names no test`);
    } else {
      assert.ok(c.justification && c.justification.trim().length > 80, `${c.id} needs a substantive justification`);
      assert.deepEqual(c.tests, [], `${c.id} must not claim test coverage`);
    }
  }
  const missing = findMissingTests(criteria);
  assert.deepEqual(missing, [], `register rows point at tests that do not exist:\n  ${missing.join("\n  ")}`);
  const modes = Object.fromEntries(criteria.map((c) => [c.id, c.verifiedBy]));
  assert.equal(modes["AC-31"], "platform");
  assert.equal(modes["AC-34"], "review");
  assert.equal(criteria.filter((c) => c.verifiedBy === "test").length, COUNT - 2);
});

test("AC-36 negative control: a missing test name, a comment, a skip and a missing file are all reported (the gate can fail)", () => {
  const tampered = JSON.parse(JSON.stringify(loadRegister()));
  tampered.criteria.find((c) => c.id === "AC-04").tests = [
    { file: "tests/regression/p15-ledger.check.cjs", name: "a test that was never written anywhere" },
  ];
  tampered.criteria.find((c) => c.id === "AC-05").tests = [{ file: "tests/regression/no-such-file.cjs", name: "x" }];
  const missing = findMissingTests(tampered.criteria);
  assert.equal(missing.length, 2);
  assert.match(missing[0], /^AC-04: no such live test/);
  assert.match(missing[1], /^AC-05: test file does not exist/);

  const name = "AC-99: a criterion whose test is not really there";
  for (const contents of [`// ${name}\n`, `/*\n * ${name}\n */\n`, `test.skip("${name}", () => {});\n`, `assert.ok(true, "see ${name}");\n`]) {
    assert.equal(registersLiveTest(contents, name), false);
  }
  assert.equal(registersLiveTest(`test(\n  "${name}",\n  () => {}\n);`, name), true);
  assert.equal(registersLiveTest("test(`${mode}: a loop title`, () => {});", "${mode}: a loop title"), true);
  assert.deepEqual(findMissingTests(loadRegister().criteria), []);
});

// ---------------------------------------------------------------------------
// AC-33 static half: no shell in the history code
// ---------------------------------------------------------------------------

function historySourceFiles() {
  const dir = path.join(root, "src", "core", "history");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => path.join("src", "core", "history", f));
  files.push(path.join("scripts", "history.js"));
  return files;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Shell-capable child_process usage in `source`, as a list of findings. */
function findShellUse(rel, source) {
  const code = stripComments(source);
  const findings = [];
  if (/\bshell\s*:\s*(true|["'`])/.test(code)) findings.push("shell option");
  if (/(?<![\w.])(exec|execSync|spawn|spawnSync|fork)\s*\(/.test(code)) findings.push("bare exec/spawn call");
  if (/\.(exec|execSync|spawn|spawnSync|fork)\s*\(/.test(code.replace(/\/[^/\n]*\/[a-z]*\.exec\(/g, "").replace(/\b(re|regex|RE|\w*Re)\.exec\(/g, "")) &&
      /child_process/.test(code)) findings.push("child_process method call");
  if (/child_process/.test(code) && path.basename(rel) !== "GitInfo.js") findings.push("child_process outside GitInfo.js");
  return findings;
}

test("AC-33: no history module or scripts/history.js reaches a shell; only GitInfo.js uses child_process, via execFileSync", () => {
  for (const rel of historySourceFiles()) {
    const source = fs.readFileSync(path.join(root, rel), "utf8");
    assert.deepEqual(findShellUse(rel, source), [], `${rel} may reach a shell`);
  }
  const git = stripComments(fs.readFileSync(path.join(root, "src", "core", "history", "GitInfo.js"), "utf8"));
  assert.match(git, /childProcess\.execFileSync/);
  assert.ok(!/execSync/.test(git));
});

test("AC-33 negative control: the shell scan catches exec, execSync, spawn with shell:true and a stray child_process", () => {
  assert.ok(findShellUse("x/GitInfo.js", 'const { execSync } = require("child_process");\nexecSync("git status");').length > 0);
  assert.ok(findShellUse("x/GitInfo.js", 'cp.exec("git status", cb);\nconst cp = require("child_process");').length > 0);
  assert.ok(findShellUse("x/GitInfo.js", 'spawn("git", ["x"], { shell: true });').length > 0);
  assert.ok(findShellUse("x/RunLedger.js", 'const cp = require("node:child_process");').length > 0);
  assert.deepEqual(findShellUse("x/GitInfo.js", 'const cp = require("node:child_process");\ncp.execFileSync("git", ["a"]);'), []);
  assert.deepEqual(findShellUse("x/Other.js", "// execSync(x) and child_process in a comment\nconst y = /a/.exec(s);"), []);
});

// ---------------------------------------------------------------------------
// CI workflow (AC-28, AC-29, AC-30)
// ---------------------------------------------------------------------------

/** Split the workflow text into "- name:" step blocks with comment lines removed. */
function ciSteps(text) {
  const lines = text.split("\n").filter((l) => !/^\s*#/.test(l));
  const steps = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^(\s*)- name:\s*(.*)$/);
    if (m) {
      current = { name: m[2].trim(), body: line };
      steps.push(current);
    } else if (current) {
      current.body += "\n" + line;
    }
  }
  return steps;
}

/** The value of a single-line `key:` inside a step body, or null. */
function stepField(step, key) {
  const m = step.body.match(new RegExp(`^\\s+${key}:[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

/** The text of a step's `path:` (inline or block scalar), whitespace-normalised. */
function stepPath(step) {
  const m = step.body.match(/^(\s+)path:[ \t]*(.*)$/m);
  if (!m) return null;
  if (!/^[|>]/.test(m[2].trim())) return m[2].trim();
  const after = step.body.slice(step.body.indexOf(m[0]) + m[0].length).split("\n").slice(1);
  const indent = m[1].length;
  const out = [];
  for (const l of after) {
    if (l.trim() === "") continue;
    if (l.search(/\S/) <= indent) break;
    out.push(l.trim());
  }
  return out.join("\n");
}

const isCacheStep = (s) => /uses:\s*actions\/cache(\/(restore|save))?@/.test(s.body);

/** Problems with the history cache wiring, as a list. */
function checkHistoryCache(text) {
  const problems = [];
  const caches = ciSteps(text).filter(isCacheStep);
  const history = caches.filter((s) => stepPath(s) === "data/run_history.json");
  const kinds = new Set(history.map((s) => (s.body.match(/actions\/cache\/(restore|save)@/) || [])[1]));
  if (!kinds.has("restore") || !kinds.has("save")) problems.push("need a restore and a save entry whose path is exactly data/run_history.json");
  for (const s of history) {
    const key = stepField(s, "key");
    if (!key || !key.startsWith("falcon-history-")) problems.push(`history cache key must start with falcon-history-: ${key}`);
  }
  for (const s of caches) {
    const p = stepPath(s) || "";
    if (/locator_memory|locator_store/.test(p)) problems.push(`cache step "${s.name}" mentions locator memory/store`);
    if (/run_history/.test(p) && p !== "data/run_history.json") problems.push(`cache step "${s.name}" mixes run_history with other paths`);
    const key = stepField(s, "key") || "";
    if (/^falcon-state-/.test(key) && /run_history/.test(p)) problems.push("the state cache must not carry the ledger");
  }
  return problems;
}

function checkAdvisoryExport(text) {
  const problems = [];
  const steps = ciSteps(text);
  const exp = steps.find((s) => /^Export run history/.test(s.name));
  const check = steps.find((s) => /^Run history trend check/.test(s.name));
  if (!exp) problems.push("missing the Export run history step");
  else {
    if (!/reports\/history\/run_history\.\$fmt|reports\/history\/run_history\./.test(exp.body)) problems.push("export does not land in reports/history/");
    if (!/history:export/.test(exp.body)) problems.push("export does not use history:export");
    if (stepField(exp, "if") !== "always()") problems.push("export step must run if: always()");
    if (/--strict/.test(exp.body)) problems.push("export step contains --strict");
  }
  if (!check) problems.push("missing the history check step");
  else {
    if (/--strict/.test(check.body)) problems.push("history check step contains --strict");
    if (!/GITHUB_STEP_SUMMARY/.test(check.body)) problems.push("history check does not reach the step summary");
    if (!/history\.js check|history:check/.test(check.body)) problems.push("history check step does not run the check");
    if (!/\|\|\s*rc=\$\?/.test(check.body)) problems.push("history check must capture a non-zero exit instead of failing");
    if (/^\s*(exit\b|set -e)/m.test(check.body)) problems.push("history check step may fail the job");
    if (stepField(check, "continue-on-error") === "false") problems.push("continue-on-error must not be false");
  }
  return problems;
}

function checkMainOnlyUpload(text) {
  const problems = [];
  const up = ciSteps(text).find((s) => /^Upload run history ledger/.test(s.name));
  if (!up) return ["missing the Upload run history ledger step"];
  if (!/uses:\s*actions\/upload-artifact@/.test(up.body)) problems.push("not an upload-artifact step");
  const cond = stepField(up, "if") || "";
  if (!/github\.ref\s*==\s*'refs\/heads\/main'/.test(cond)) problems.push(`upload condition is not main-only: ${cond}`);
  if (stepField(up, "retention-days") !== "90") problems.push(`retention-days is ${stepField(up, "retention-days")}, not 90`);
  if (stepPath(up) !== "data/run_history.json") problems.push(`upload path is ${stepPath(up)}`);
  return problems;
}

test("AC-28: the history cache entries use exactly data/run_history.json under a falcon-history- key, apart from the state cache", () => {
  const text = fs.readFileSync(CI_YML_PATH, "utf8");
  assert.deepEqual(checkHistoryCache(text), []);
  const state = ciSteps(text).filter((s) => isCacheStep(s) && /falcon-state-/.test(s.body));
  assert.ok(state.length >= 2, "the state-file cache entries must still exist");
  for (const s of state) assert.ok(!/run_history/.test(stepPath(s)), `${s.name} must not carry the ledger`);
  for (const s of ciSteps(text).filter(isCacheStep)) assert.ok(!/locator_memory|locator_store/.test(stepPath(s)));
});

test("AC-28 negative control: the cache check fails on a mixed path, a wrong key, and a locator path", () => {
  const text = fs.readFileSync(CI_YML_PATH, "utf8");
  const mixed = text.replace(/path: data\/run_history\.json\n(\s+)key: falcon-history-/, "path: |\n$1  data/run_history.json\n$1  data/locator_memory.json\n$1key: falcon-history-");
  assert.notEqual(mixed, text);
  assert.ok(checkHistoryCache(mixed).length > 0);
  const badKey = text.replace(/key: falcon-history-/g, "key: other-");
  assert.ok(checkHistoryCache(badKey).some((p) => /falcon-history-/.test(p)));
  const locator = text.replace(/(path: \|\n\s+data\/scenario_history\.json)/, "$1\n            data/locator_store.json");
  assert.notEqual(locator, text);
  assert.ok(checkHistoryCache(locator).some((p) => /locator/.test(p)));
});

test("AC-29: exports land in reports/history/ and the advisory check reaches the step summary without --strict", () => {
  assert.deepEqual(checkAdvisoryExport(fs.readFileSync(CI_YML_PATH, "utf8")), []);
});

test("AC-29 negative control: the advisory check fails when --strict is added, the summary dropped, or the export moved", () => {
  const text = fs.readFileSync(CI_YML_PATH, "utf8");
  const strict = text.replace("history.js check >", "history.js check --strict >");
  assert.notEqual(strict, text);
  assert.ok(checkAdvisoryExport(strict).some((p) => /--strict/.test(p)));
  const noSummary = text.replace(/GITHUB_STEP_SUMMARY/g, "SOMEWHERE_ELSE");
  assert.ok(checkAdvisoryExport(noSummary).some((p) => /step summary/.test(p)));
  const moved = text.replace(/reports\/history\/run_history\./g, "elsewhere/run_history.");
  assert.ok(checkAdvisoryExport(moved).some((p) => /reports\/history/.test(p)));
});

test("AC-30: the run-history upload is main-only with retention-days 90", () => {
  assert.deepEqual(checkMainOnlyUpload(fs.readFileSync(CI_YML_PATH, "utf8")), []);
});

test("AC-30 negative control: the upload check fails without the main condition or with another retention", () => {
  const text = fs.readFileSync(CI_YML_PATH, "utf8");
  const anyRef = text.replace("if: always() && github.ref == 'refs/heads/main'", "if: always()");
  assert.notEqual(anyRef, text);
  assert.ok(checkMainOnlyUpload(anyRef).some((p) => /main-only/.test(p)));
  const retention = text.replace("retention-days: 90", "retention-days: 14");
  assert.ok(checkMainOnlyUpload(retention).some((p) => /retention/.test(p)));
});

module.exports = { registersLiveTest, findMissingTests, findShellUse, ciSteps };
