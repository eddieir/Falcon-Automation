"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { root } = require("./helpers.cjs");

const HOOK = path.join(root, ".claude", "hooks", "ledger-guard.js");
const { decide } = require(HOOK);
const settings = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"));

const sub = (command) => ({ agent_id: "a1", tool_input: { command } });
const main = (command) => ({ tool_input: { command } });

test("deny rule keeps built-in file tools out of the ledger directory", () => {
  assert.ok(settings.permissions.deny.includes("Edit(/.git/production-cycle/**)"));
});

test("hook is registered for Bash tool calls", () => {
  const entry = settings.hooks.PreToolUse.find((h) => h.matcher === "Bash");
  assert.ok(entry && entry.hooks.some((h) => /ledger-guard\.js/.test(h.command)));
});

test("a subagent cannot append events or write the ledger from Bash", () => {
  for (const cmd of [
    "node scripts/production-cycle/append-event.js --run-id x",
    "npm run production:event -- --run-id x",
    "echo x >> .git/production-cycle/run1/events.jsonl",
    "tee .git/production-cycle/run1/events.jsonl < /dev/null",
    "sed -i '' s/a/b/ .git/production-cycle/run1/events.jsonl",
    "cp /tmp/f .git/production-cycle/run1/",
    "rm -rf .git/production-cycle/run1",
  ]) {
    assert.ok(decide(sub(cmd)), `should deny: ${cmd}`);
  }
});

test("a subagent cannot run the checkpoint tool, but may read it or run its tests", () => {
  for (const cmd of [
    "node scripts/production-cycle/checkpoint.js --run-id x",
    "node scripts/production-cycle/checkpoint.js --run-id x --verify",
    "node --no-warnings ./scripts/production-cycle/checkpoint.js --run-id x",
    "cd scripts/production-cycle && node checkpoint.js --run-id x",
    "npm run production:checkpoint -- --run-id x",
    "node scripts/production-cycle/checkpoint --run-id x",
    "node -e \"require('./scripts/production-cycle/checkpoint').main(['--run-id=x'])\"",
    "node scripts/production-cycle/checkpoint.js --run-id x;echo done",
    "node scripts/production-cycle/checkpoint.js --run-id x|cat",
    "true&&node scripts/production-cycle/checkpoint.js --run-id x",
    "false||node scripts/production-cycle/checkpoint.js --run-id x",
    "nodejs scripts/production-cycle/checkpoint.js --run-id x",
    "bun scripts/production-cycle/checkpoint.js --run-id x",
    "npx ./scripts/production-cycle/checkpoint.js --run-id x",
    "npm --silent run production:checkpoint -- --run-id x",
    "pnpm run production:checkpoint --run-id x",
    "echo $(node scripts/production-cycle/checkpoint.js --run-id x)",
    "echo `node scripts/production-cycle/checkpoint.js --run-id x`",
    "sh -c 'node scripts/production-cycle/checkpoint.js --run-id x'",
    "FOO=1 node scripts/production-cycle/checkpoint.js --run-id x",
    "env FOO=1 node ./scripts/production-cycle/checkpoint.js --run-id x",
    "time node scripts/production-cycle/checkpoint.js --run-id x",
    "exec node scripts/production-cycle/checkpoint.js --run-id x",
    "/usr/local/bin/node scripts/production-cycle/checkpoint.js --run-id x",
    "npm exec -- node scripts/production-cycle/checkpoint.js --run-id x",
    "cd scripts/production-cycle\nnode checkpoint.js --run-id x",
    "cd scripts/production-cycle && node checkpoint --run-id x",
    "timeout 5 node scripts/production-cycle/checkpoint.js --run-id x",
    "nice -n 5 node scripts/production-cycle/checkpoint.js --run-id x",
    "sudo -u nobody node scripts/production-cycle/checkpoint.js --run-id x",
    "env -i node scripts/production-cycle/checkpoint.js --run-id x",
    "/usr/bin/env node scripts/production-cycle/checkpoint.js --run-id x",
    "xargs node scripts/production-cycle/checkpoint.js",
    "find . -name x -exec node scripts/production-cycle/checkpoint.js --run-id x ;",
    "eval node scripts/production-cycle/checkpoint.js --run-id x",
    "node -r ./scripts/production-cycle/checkpoint.js other.js",
    "node scripts/production-cycle/CHECKPOINT.JS --run-id x",
    "node scripts/production-cycle/\\\nchecklist.js; node scripts/production-cycle/checkpoint.js",
    "npm exec -- node scripts/production-cycle/checkpoint.js",
    "npx -y ./scripts/production-cycle/checkpoint.js",
  ]) {
    assert.ok(decide(sub(cmd)), `should deny: ${cmd}`);
    assert.equal(decide(main(cmd)), null, `coordinator may run: ${cmd}`);
  }
  for (const cmd of [
    "node --test tests/regression/p19-checkpoint.check.cjs",
    "grep -n verify scripts/production-cycle/checkpoint.js",
    "grep production:checkpoint package.json",
    "node --test --test-name-pattern checkpoint tests/regression/p19-checkpoint.check.cjs",
    "node -e \"console.log(1)\"",
    "git log --oneline -- scripts/production-cycle/checkpoint.js",
    "ls scripts/production-cycle/ | grep checkpoint",
    "grep -n node scripts/production-cycle/checkpoint.js",
    "node --check scripts/production-cycle/checkpoint.js",
    "node -c scripts/production-cycle/checkpoint.js",
    "npx eslint scripts/production-cycle/checkpoint.js",
    "node tool.js -e checkpoint-notes",
    "node --test --test-name-pattern checkpoint tests/regression/p19-checkpoint.check.cjs",
    "grep -rn checkpoint src tests",
    "cat scripts/production-cycle/checkpoint.js | node -e \"process.stdin.resume()\"",
    "cat .claude/skills/production-cycle/SKILL.md",
  ]) {
    assert.equal(decide(sub(cmd)), null, `should allow: ${cmd}`);
  }
});

test("a subagent may still read the ledger and run ordinary commands", () => {
  for (const cmd of [
    "cat .git/production-cycle/run1/evidence/notes.md",
    "grep -n AC01 .git/production-cycle/run1/evidence/a.md",
    "node --test tests/regression/p17-pc-cli.check.cjs",
    "git status --short",
    "echo hello > /tmp/scratch.txt",
  ]) {
    assert.equal(decide(sub(cmd)), null, `should allow: ${cmd}`);
  }
});

test("the main session (coordinator) is never blocked by the hook", () => {
  assert.equal(decide(main("node scripts/production-cycle/append-event.js --run-id x")), null);
  assert.equal(decide(main("echo x >> .git/production-cycle/run1/dispatches.md")), null);
});

test("the hook process exits 2 for a denied subagent call and 0 otherwise", () => {
  const run = (payload) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
  const denied = run({ agent_id: "a1", tool_input: { command: "echo x >> .git/production-cycle/r/events.jsonl" } });
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /coordinator/);
  assert.equal(run({ agent_id: "a1", tool_input: { command: "git status" } }).status, 0);
  assert.equal(run({ tool_input: { command: "echo x >> .git/production-cycle/r/events.jsonl" } }).status, 0);
  assert.equal(spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" }).status, 0);
});

test("the checkpoint matcher stays fast on very large commands", () => {
  for (const filler of [" ".repeat(10), "x ".repeat(100000), "node ".repeat(40000), "node -e " + "a ".repeat(80000)]) {
    const start = process.hrtime.bigint();
    decide(sub(`node -e ${filler}`));
    decide(sub(`${filler} production-cycle`));
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 500, `matcher took ${ms.toFixed(0)} ms`);
  }
});

test("padding a command cannot hide a checkpoint run", () => {
  const pad = "x".repeat(500000);
  assert.ok(decide(sub(`echo ${pad}; node scripts/production-cycle/checkpoint.js --run-id x`)));
  assert.ok(decide(sub(`echo ${pad}\nnode scripts/production-cycle/checkpoint.js --run-id x`)));
});
