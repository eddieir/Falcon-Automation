"use strict";

/**
 * ProductionPacket.check.js - deterministic coverage for
 * scripts/production-cycle/packet.js. Uses a throwaway git repository in the OS
 * temp directory; no network, no real repository state is read.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const Packet = require("../../scripts/production-cycle/packet");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "production-cycle", "packet.js");
let failures = 0;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`ok - ${name}\n`);
  } catch (err) {
    failures += 1;
    process.stdout.write(`not ok - ${name}\n  ${err.stack.split("\n").slice(0, 3).join("\n  ")}\n`);
  }
}

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "packet-test-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.invalid");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  fs.writeFileSync(path.join(repo, "t.check.js"), "console.log('# pass 3');\nconsole.log('# fail 0');\n");
  fs.writeFileSync(path.join(repo, "bad.check.js"), "console.log('# pass 1');\nconsole.log('# fail 2');\nprocess.exit(1);\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  git(repo, "commit", "-qam", "change");
  return { repo, base, head: git(repo, "rev-parse", "HEAD") };
}

function errCode(fn) {
  try { fn(); } catch (err) { return err.exitCode; }
  return undefined;
}

const { repo, base, head } = makeRepo();

test("packet records exact head and base, changed files, diff and no-test notice", () => {
  const p = Packet.buildPacket({ repo, base, head, tests: [] });
  assert.ok(p.text.includes(`Head: ${head}`));
  assert.ok(p.text.includes(`Base: ${base}`));
  assert.ok(p.text.includes("- a.txt"));
  assert.ok(p.text.includes("+two"));
  assert.ok(p.text.includes("No test file was run for this packet."));
  assert.strictEqual(p.truncated, false);
});

test("a passing and a failing test file are reported with exact exit and counts", () => {
  const p = Packet.buildPacket({ repo, base, head, tests: ["t.check.js", "bad.check.js"] });
  assert.deepStrictEqual(p.tests.map((t) => [t.file, t.exit, t.pass, t.fail]), [
    ["t.check.js", 0, 3, 0],
    ["bad.check.js", 1, 1, 2],
  ]);
  assert.ok(p.text.includes("- bad.check.js: exit 1, pass 1, fail 2"));
});

test("the diff is capped with an explicit truncation marker", () => {
  fs.writeFileSync(path.join(repo, "big.txt"), `${"x".repeat(80)}\n`.repeat(400));
  git(repo, "add", "big.txt");
  git(repo, "commit", "-qm", "big");
  const big = git(repo, "rev-parse", "HEAD");
  const p = Packet.buildPacket({ repo, base, head: big, tests: [], maxDiffBytes: 2000 });
  assert.strictEqual(p.truncated, true);
  assert.ok(p.text.includes("TRUNCATED at 2000 bytes"));
  assert.ok(p.text.length < 6000);
});

test("role adds a response contract; an unknown role is rejected with exit 2", () => {
  const p = Packet.buildPacket({ repo, base, head, tests: [], role: "qa" });
  assert.ok(p.text.includes("## Response contract"));
  assert.ok(p.text.includes("BLOCKED - INSUFFICIENT EVIDENCE"));
  assert.strictEqual(errCode(() => Packet.buildPacket({ repo, base, head, tests: [], role: "ceo" })), 2);
});

test("option-looking, unknown and malformed revisions are rejected before git runs", () => {
  assert.strictEqual(errCode(() => Packet.buildPacket({ repo, base: "--output=x", head, tests: [] })), 2);
  assert.strictEqual(errCode(() => Packet.buildPacket({ repo, base: "no-such-rev", head, tests: [] })), 3);
  assert.strictEqual(errCode(() => Packet.buildPacket({ repo, base: "a b", head, tests: [] })), 2);
});

test("test paths outside the repository, missing or non-js files are rejected", () => {
  assert.strictEqual(errCode(() => Packet.buildPacket({ repo, base, head, tests: ["../escape.js"] })), 2);
  assert.strictEqual(errCode(() => Packet.buildPacket({ repo, base, head, tests: ["missing.js"] })), 2);
  assert.strictEqual(errCode(() => Packet.buildPacket({ repo, base, head, tests: ["a.txt"] })), 2);
});

test("a full commit SHA and a long non-secret token in a diff do not refuse the packet", () => {
  fs.writeFileSync(path.join(repo, "sha.txt"), "- Base: 229816e1d60757d2b888f1bb539c9e7078f0eab3\nx".repeat(1) + "y".repeat(80) + "\n");
  git(repo, "add", "sha.txt");
  git(repo, "commit", "-qm", "sha");
  const withSha = git(repo, "rev-parse", "HEAD");
  const p = Packet.buildPacket({ repo, base, head: withSha, tests: [] });
  assert.ok(p.text.includes("229816e1d60757d2b888f1bb539c9e7078f0eab3"));
});

test("a secret-shaped added line refuses the packet and the value is never printed", () => {
  const secret = `sk-${"A1b2C3d4".repeat(6)}`;
  fs.writeFileSync(path.join(repo, "leak.txt"), `token=${secret}\n`);
  git(repo, "add", "leak.txt");
  git(repo, "commit", "-qm", "leak");
  const leaked = git(repo, "rev-parse", "HEAD");
  const out = path.join(repo, "packet.md");
  const res = spawnSync(process.execPath, [SCRIPT, `--base=${base}`, `--head=${leaked}`, `--out=${out}`], { cwd: repo, encoding: "utf8" });
  assert.strictEqual(res.status, 4);
  assert.ok(!`${res.stdout}${res.stderr}`.includes(secret));
  assert.ok(!fs.existsSync(out));
});

test("CLI writes the file once, refuses to overwrite without --force, and rejects bad arguments", () => {
  const out = path.join(os.tmpdir(), `packet-out-${process.pid}.md`);
  fs.rmSync(out, { force: true });
  const args = [SCRIPT, `--base=${base}`, `--head=${head}`, `--out=${out}`, "--role=release", "--test=t.check.js"];
  assert.strictEqual(spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8" }).status, 0);
  assert.ok(fs.readFileSync(out, "utf8").includes("t.check.js: exit 0, pass 3, fail 0"));
  assert.strictEqual(spawnSync(process.execPath, args, { cwd: repo, encoding: "utf8" }).status, 2);
  assert.strictEqual(spawnSync(process.execPath, [...args, "--force"], { cwd: repo, encoding: "utf8" }).status, 0);
  assert.strictEqual(spawnSync(process.execPath, [SCRIPT, "--bogus=1"], { cwd: repo, encoding: "utf8" }).status, 2);
  assert.strictEqual(spawnSync(process.execPath, [SCRIPT, `--base=${base}`], { cwd: repo, encoding: "utf8" }).status, 2);
  fs.rmSync(out, { force: true });
});

fs.rmSync(repo, { recursive: true, force: true });
process.stdout.write(`# pass ${passed}\n# fail ${failures}\n`);
process.exitCode = failures === 0 ? 0 : 1;
