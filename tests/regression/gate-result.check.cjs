"use strict";
// gate-run: argument handling, exit codes, the working-directory boundary, and
// the gate-result.json document (versioned, sanitized, atomic).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const gate = require("../../scripts/demo/lib/gate");
const R = require("../../scripts/demo/lib/result");
const { main, parseArgs } = require("../../scripts/demo/gate-run");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "falcon-gate-result-"));
const sink = () => { const chunks = []; return { write: (s) => chunks.push(s), text: () => chunks.join("") }; };

test("arguments: only the two modes, and never a root, home or repository directory", () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(["nope", "/x/y"]), null);
  assert.equal(parseArgs(["structural"]), null);
  assert.ok(parseArgs(["hook-rename", path.join(tmp(), "w")]).workDir);
  for (const bad of [path.parse(os.homedir()).root, os.homedir(), path.join(__dirname, "..", ".."), path.join(__dirname, "..", "..", "src")]) {
    assert.ok(parseArgs(["hook-rename", bad]).error, bad);
  }
});

test("the working directory is only emptied when absent, empty or marked as the gate's own", async () => {
  const root = tmp();
  const dir = path.join(root, "w");
  await gate.resetWorkDir(dir);
  assert.ok(fs.existsSync(path.join(dir, gate.MARKER)));
  fs.writeFileSync(path.join(dir, "old.txt"), "x");
  await gate.resetWorkDir(dir);
  assert.deepEqual(fs.readdirSync(dir), [gate.MARKER]);

  const foreign = path.join(root, "foreign");
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, "precious.txt"), "keep");
  await assert.rejects(gate.resetWorkDir(foreign), /did not create/);
  assert.ok(fs.existsSync(path.join(foreign, "precious.txt")));

  const link = path.join(root, "link");
  fs.symlinkSync(foreign, link);
  await assert.rejects(gate.resetWorkDir(link), /real directory/);
  await assert.rejects(gate.resetWorkDir(path.join(foreign, "precious.txt")), /real directory/);
  assert.ok(fs.existsSync(path.join(foreign, "precious.txt")));
});

test("sanitization removes paths, timestamps, ports and credentials; validation rejects what remains", () => {
  const secret = "s3cr3t-" + "v".repeat(12);
  const saved = process.env.FALCON_TEST_API_TOKEN;
  process.env.FALCON_TEST_API_TOKEN = secret;
  try {
    const workDir = path.join(os.tmpdir(), "falcon-w");
    const raw = JSON.stringify({
      a: `${workDir}/agency/x.js`, b: `${os.homedir()}/project`, c: "/Users/someone/else/file", d: "at 2026-10-14T16:57:16.601Z",
      e: "listening 127.0.0.1:5173 and [::1]:43123", f: `token ${secret}`, g: "C:\\Users\\a\\b",
    });
    const clean = R.sanitize(raw, { workDir, agencySource: "/Users/someone/ai-agency" });
    assert.deepEqual(R.problems(clean), []);
    assert.doesNotMatch(clean, /Users|falcon-w|2026-10|:5173|43123/);
    assert.ok(!clean.includes(secret));
    assert.match(clean, /<workDir>/);
    assert.match(clean, /<timestamp>/);
    assert.match(clean, /127\.0\.0\.1:<port>/);
  } finally {
    if (saved === undefined) delete process.env.FALCON_TEST_API_TOKEN; else process.env.FALCON_TEST_API_TOKEN = saved;
  }
  assert.ok(R.problems("path /Users/x/y").includes("absolute path"));
  assert.ok(R.problems("sk-" + "a".repeat(30)).includes("credential-shaped value"));
});

test("a result is versioned, deterministic and contains no machine-specific data", () => {
  const workDir = path.join(os.tmpdir(), "gate-det");
  const raw = () => ({
    mode: "hook-rename", agencySha: "f".repeat(40), steps: { one: { ok: true, detail: `${workDir}/agency` } },
    evidence: { at: new Date().toISOString(), listening: ["127.0.0.1:" + (5000 + Math.floor(Math.random() * 999))] },
    log: [{ t: Math.random(), label: "agency", stream: "stdout", line: `ready ${workDir}` }],
  });
  const opts = { workDir, agencySource: "/Users/x/src", expected: "e", gatePassed: true };
  const a = R.buildResult(raw(), opts);
  const b = R.buildResult(raw(), opts);
  assert.equal(a, b, "the same run produces the same bytes apart from timing");
  const doc = JSON.parse(a);
  assert.equal(doc.format, "falcon-demo-gate-result");
  assert.equal(doc.version, 1);
  assert.deepEqual(Object.keys(doc), ["format", "version", "mode", "expected", "gatePassed", "agencySha", "failedStep", "steps", "evidence", "log"]);
  assert.deepEqual(Object.keys(doc.log[0]), ["label", "stream", "line"]);
  assert.deepEqual(R.problems(a), []);
  assert.throws(() => R.buildResult({ ...raw(), evidence: { key: "sk-" + "z".repeat(30) } }, opts), /not safe to write/);
});

test("writes are atomic: a failed write leaves the previous result and no temporary file", async () => {
  const dir = tmp();
  const file = path.join(dir, "gate-result.json");
  await R.writeAtomic(file, "one\n");
  assert.equal(fs.readFileSync(file, "utf8"), "one\n");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await R.writeAtomic(file, "two\n");
  assert.equal(fs.readFileSync(file, "utf8"), "two\n");
  assert.deepEqual(fs.readdirSync(dir), ["gate-result.json"]);
  const blocker = path.join(dir, "dir-in-the-way");
  fs.mkdirSync(blocker);
  await assert.rejects(R.writeAtomic(blocker, "x"));
  assert.deepEqual(fs.readdirSync(dir).sort(), ["dir-in-the-way", "gate-result.json"]);
  assert.equal(fs.readFileSync(file, "utf8"), "two\n");
});

test("exit codes: pass is 0, a failed step 1, bad arguments 2, and the result file is written", async () => {
  const dir = path.join(tmp(), "w");
  const runWith = (scenario) => main({ argv: ["structural", dir], env: { AGENCY_SOURCE: "/Users/x/src" }, runScenario: scenario, out: sink(), err: sink() });
  const passing = async ({ workDir }) => { await gate.resetWorkDir(workDir); return { mode: "structural", ok: true, steps: { refused: { ok: true } }, evidence: { path: `${workDir}/f` }, log: [] }; };
  assert.equal(await runWith(passing), 0);
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "gate-result.json"), "utf8"));
  assert.equal(doc.gatePassed, true);
  assert.deepEqual(R.problems(JSON.stringify(doc)), []);

  const failing = async ({ workDir }) => {
    await gate.resetWorkDir(workDir);
    throw Object.assign(new Error("gate step failed: x"), { out: { mode: "structural", steps: { x: { ok: false } }, evidence: {} }, log: { lines: [] } });
  };
  assert.equal(await runWith(failing), 1);
  const bad = JSON.parse(fs.readFileSync(path.join(dir, "gate-result.json"), "utf8"));
  assert.equal(bad.gatePassed, false);
  assert.equal(bad.failedStep, "gate step failed: x");

  assert.equal(await main({ argv: [], out: sink(), err: sink() }), 2);
});

test("a refused working directory receives no result file", async () => {
  const foreign = tmp();
  fs.writeFileSync(path.join(foreign, "precious.txt"), "keep");
  const code = await main({ argv: ["hook-rename", foreign], env: {}, runScenario: gate.runScenario, out: sink(), err: sink() });
  assert.equal(code, 2);
  assert.deepEqual(fs.readdirSync(foreign), ["precious.txt"]);
});

test("process launcher: no option injection, patches stay in the demo directory, credentials are not inherited", async () => {
  const E = require("../../scripts/demo/lib/env");
  await assert.rejects(E.prepareAgency(path.join(tmp(), "a"), { source: "--upload-pack=touch /tmp/x", install: false }), /path or URL/);
  await assert.rejects(E.applyPatch(tmp(), "../../package.json"), /not a demo patch/);
  await assert.rejects(E.applyPatch(tmp(), "/etc/hosts"), /not a demo patch/);
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "not-a-real-key-value";
  try {
    const env = E.childEnv({ DASHBOARD_PORT: "1" });
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.DASHBOARD_PORT, "1");
    assert.ok(env.PATH);
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
  }
});
