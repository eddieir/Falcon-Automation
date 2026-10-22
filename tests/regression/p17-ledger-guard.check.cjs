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
  ]) {
    assert.ok(decide(sub(cmd)), `should deny: ${cmd}`);
    assert.equal(decide(main(cmd)), null, `coordinator may run: ${cmd}`);
  }
  for (const cmd of [
    "node --test tests/regression/p19-checkpoint.check.cjs",
    "grep -n verify scripts/production-cycle/checkpoint.js",
    "grep production:checkpoint package.json",
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
