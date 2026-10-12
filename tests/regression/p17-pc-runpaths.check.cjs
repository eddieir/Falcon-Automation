const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, temp } = require("./helpers.cjs");

function loadRunPaths() {
  return load("src/production-cycle/RunPaths.js", {});
}

function makeRoot() {
  const dir = temp();
  const pcDir = path.join(dir, "production-cycle");
  fs.mkdirSync(pcDir);
  return { dir, pcDir };
}

test("valid run id is accepted", () => {
  const { validateRunId } = loadRunPaths();
  assert.equal(validateRunId("p17-20261012T100553Z").ok, true);
  assert.equal(validateRunId("a").ok, true);
});

const BAD_RUN_IDS = {
  "dot segment": ".",
  "dotdot segment": "..",
  "traversal": "../x",
  "encoded traversal": "%2e%2e",
  "encoded slash": "..%2f",
  "absolute": "/abs",
  "windows drive": "C:\\x",
  "backslash": "a\\b",
  "device name": "CON",
  "device name lower": "nul",
  "trailing dot": "run.",
  "leading dash": "-x",
  "too long": "x".repeat(65),
  "unicode lookalike": "\uff50run", // fullwidth 'p' lookalike, not ASCII
  "percent": "run%20",
};

for (const [name, runId] of Object.entries(BAD_RUN_IDS)) {
  test(`path attack rejected: ${name}`, () => {
    const { validateRunId } = loadRunPaths();
    const result = validateRunId(runId);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(runId)}`);
  });
}

test("resolveRunDir happy path returns runDir and eventsPath", () => {
  const { resolveRunDir } = loadRunPaths();
  const { dir, pcDir } = makeRoot();
  const runDir = path.join(pcDir, "run1");
  fs.mkdirSync(runDir);
  fs.writeFileSync(path.join(runDir, "events.jsonl"), "");
  const result = resolveRunDir(dir, "run1");
  assert.equal(result.ok, true);
  assert.equal(result.runDir, runDir);
});

test("resolveRunDir rejects when production-cycle dir is a symlink", () => {
  const { resolveRunDir } = loadRunPaths();
  const dir = temp();
  const realPcDir = path.join(dir, "real-pc");
  fs.mkdirSync(realPcDir);
  fs.symlinkSync(realPcDir, path.join(dir, "production-cycle"));
  const result = resolveRunDir(dir, "run1");
  assert.equal(result.ok, false);
  assert.equal(result.code, "RUNID_ROOT_SYMLINK");
});

test("resolveRunDir rejects a symlinked run directory", () => {
  const { resolveRunDir } = loadRunPaths();
  const { dir, pcDir } = makeRoot();
  const realDir = path.join(dir, "elsewhere");
  fs.mkdirSync(realDir);
  fs.symlinkSync(realDir, path.join(pcDir, "run1"));
  const result = resolveRunDir(dir, "run1");
  assert.equal(result.ok, false);
  assert.equal(result.code, "RUNID_DIR_SYMLINK");
});

test("resolveRunDir rejects events.jsonl symlinked elsewhere", () => {
  const { resolveRunDir } = loadRunPaths();
  const { dir, pcDir } = makeRoot();
  const runDir = path.join(pcDir, "run1");
  fs.mkdirSync(runDir);
  const target = path.join(dir, "target.txt");
  fs.writeFileSync(target, "x");
  fs.symlinkSync(target, path.join(runDir, "events.jsonl"));
  const result = resolveRunDir(dir, "run1");
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVENTS_SYMLINK");
});

test("resolveRunDir rejects a hard-linked events.jsonl (nlink !== 1)", () => {
  const { resolveRunDir } = loadRunPaths();
  const { dir, pcDir } = makeRoot();
  const runDir = path.join(pcDir, "run1");
  fs.mkdirSync(runDir);
  const original = path.join(runDir, "events.jsonl");
  fs.writeFileSync(original, "x");
  fs.linkSync(original, path.join(runDir, "hardlink.jsonl"));
  const result = resolveRunDir(dir, "run1");
  assert.equal(result.ok, false);
  assert.equal(result.code, "EVENTS_HARD_LINKED");
});

test("resolveRunDir rejects run dir replaced by a file instead of a directory", () => {
  const { resolveRunDir } = loadRunPaths();
  const { dir, pcDir } = makeRoot();
  fs.writeFileSync(path.join(pcDir, "run1"), "not a dir");
  const result = resolveRunDir(dir, "run1");
  assert.equal(result.ok, false);
  assert.equal(result.code, "RUNID_DIR_NOT_DIR");
});

test("resolveRunDir propagates run-id validation failure without touching disk", () => {
  const { resolveRunDir } = loadRunPaths();
  const { dir } = makeRoot();
  const result = resolveRunDir(dir, "../escape");
  assert.equal(result.ok, false);
  assert.equal(result.code, "RUNID_TRAVERSAL");
});

test("openLedgerNoFollow opens a plain file and refuses a symlink (O_NOFOLLOW)", () => {
  const { openLedgerNoFollow } = loadRunPaths();
  const dir = temp();
  const plain = path.join(dir, "events.jsonl");
  fs.writeFileSync(plain, "line\n");
  const ok = openLedgerNoFollow(plain);
  assert.equal(ok.ok, true);
  assert.equal(typeof ok.fd, "number");
  fs.closeSync(ok.fd);

  const linkPath = path.join(dir, "link.jsonl");
  fs.symlinkSync(plain, linkPath);
  const refused = openLedgerNoFollow(linkPath);
  assert.equal(refused.ok, false);
});
