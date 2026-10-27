'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', '..', '.claude', 'hooks', 'subagent-guard.js');
const { decide, PROFILES } = require(HOOK);

const sub = (command, extra) => ({ agent_id: 'a1', agent_type: 'qa-engineer', tool_input: { command }, ...extra });
const as = (agentType, command, toolInput) => ({ agent_id: 'a1', agent_type: agentType, tool_input: { command, ...toolInput } });
const run = (stdin) => spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });

// --- Best-effort denylist for ordinary subagents (advisory; bypassable) ---
for (const cmd of [
  'claude -p "hi"', 'cd x && claude --print --agent developer hi', '/usr/local/bin/claude -p hi',
  'FOO=1 claude -p hi', 'bash -c "claude -p x"', 'timeout 60 claude -p x', 'sudo -u root claude -p x', 'claude --print=x',
  'npx @anthropic-ai/claude-code -p x', 'npm i --location=global foo', 'npx -y @playwright/cli@latest open', 'xargs claude -p',
  'gh pr comment 1 --body x --attach ./a.png', 'gh pr create --attach=./v.webm',
  'npm install -g @playwright/cli@latest', 'npm i --global foo', 'pnpm add -g foo', 'yarn global add foo',
  'gh issue comment 1 --body "x" --attach ./f.png', 'playwright-cli attach --extension=chrome',
  'npx playwright cli attach --cdp=http://localhost:9222'
]) assert(decide(sub(cmd)), `should deny: ${cmd}`);

for (const cmd of [
  'npx --no-install playwright cli open http://127.0.0.1:3000', 'npm install --no-save left-pad', 'npm run test:unit',
  'gh pr view 120 --json state', 'git diff origin/main --stat', 'git commit -m "feat: claude -p support"',
  'echo "run claude --print later"', 'node tests/unit/AgentCatalog.check.js'
]) assert.strictEqual(decide(sub(cmd)), null, `should allow: ${cmd}`);

// Nesting is capped: deep `bash -c` chains are denied instead of recursing without bound.
assert(decide(sub('bash -c '.repeat(50) + 'ls')), 'deeply nested shells must be denied');

// --- Enforced allowlist for the three Bash roles (deny by default) ---
assert.deepStrictEqual(Object.keys(PROFILES).sort(),
  ['benchmark-evaluation-engineer', 'developer-experience-engineer', 'performance-reliability-engineer']);

const bench = 'benchmark-evaluation-engineer', dx = 'developer-experience-engineer', perf = 'performance-reliability-engineer';
const allowed = [
  [bench, 'git status --short'], [bench, 'git -C /Users/x/Falcon-Org diff origin/main --stat'], [bench, 'git log --oneline -5'],
  [bench, 'node scripts/benchmark/competitive-score.js --in docs/research/x.json'], [bench, 'node tests/unit/CiWait.check.js'], [bench, 'npm run test:unit'],
  [dx, 'npx --no-install playwright --version'], [dx, 'npx --no-install playwright cli open http://127.0.0.1:3000'], [dx, 'git show HEAD'],
  [perf, 'npx --no-install playwright trace actions trace.zip'], [perf, 'node scripts/benchmark/parallel.js'], [perf, 'git rev-parse HEAD']
];
for (const [a, c] of allowed) assert.strictEqual(decide(as(a, c)), null, `${a} should allow: ${c}`);

const denied = [
  [bench, 'echo hi > /tmp/x'], [bench, 'git status; rm -rf x'], [bench, 'git status | tee f'], [bench, 'git status $(id)'], [bench, 'node -e "1"'],
  [bench, 'node scripts/benchmark/../../x.js'], [bench, 'node scripts/other/x.js'], [bench, 'git diff --output=out.txt'], [bench, 'git -c core.pager=x log'],
  [bench, 'git push origin main'], [bench, 'git commit -m x'], [bench, 'npm run test:regression'], [bench, 'npm install -g foo'], [bench, 'curl http://x'],
  [bench, 'claude -p hi'], [bench, 'bash -c ls'], [bench, 'ls'], [bench, ''], [bench, 'git status\nls'], [bench, 'FOO=1 git status'],
  [dx, 'npx --no-install playwright cli attach --cdp=chrome'], [dx, 'npx --no-install playwright cli cookie-get a'], [dx, 'npx --no-install playwright cli eval 1'],
  [dx, 'npx --no-install playwright cli run-code x'], [dx, 'npx playwright cli open'], [dx, 'npx --no-install other-pkg'], [dx, 'node scripts/benchmark/competitive-score.js'],
  [perf, 'npx --no-install playwright trace attachment 1 -o out.png'], [perf, 'npx --no-install playwright test']
];
for (const [a, c] of denied) assert(decide(as(a, c)), `${a} should deny: ${JSON.stringify(c)}`);
assert(decide(as(bench, 'git status --short', { dangerouslyDisableSandbox: true })), 'sandbox bypass flag must be denied');
// The allowlist is keyed by agent_type: other roles are not narrowed by it (they keep the Bash tool as granted).
assert.strictEqual(decide(as('qa-engineer', 'node -e "1"')), null);
// A subagent call without agent_type cannot be matched to a profile; it falls back to the denylist only.
assert.strictEqual(decide({ agent_id: 'a1', tool_input: { command: 'ls' } }), null);

// --- Main session is never restricted by this hook ---
for (const p of [{ tool_input: { command: 'claude -p hi' } }, { tool_input: { command: 'npm install -g foo' } }, { agent_id: '', agent_type: bench, tool_input: { command: 'ls' } }]) {
  assert.strictEqual(decide(p), null);
}

// --- Fail-closed policy for the actual process (exit code 2 = block) ---
for (const bad of ['', 'not json', '{', 'null', '42', '"str"', '[]x']) {
  const r = run(bad);
  assert.strictEqual(r.status, 2, `malformed input ${JSON.stringify(bad)} must block (exit 2), got ${r.status}`);
  assert(/blocked/.test(r.stderr), 'a reason must be written to stderr');
}
assert.strictEqual(run(JSON.stringify({ tool_input: { command: 'ls' } })).status, 0, 'valid main-session input must pass');
assert.strictEqual(run(JSON.stringify(sub('git status'))).status, 0, 'allowed subagent command must pass');
assert.strictEqual(run(JSON.stringify(sub('claude -p x'))).status, 2, 'denied subagent command must block');
assert.strictEqual(run(JSON.stringify(as(bench, 'ls'))).status, 2, 'off-allowlist command must block');

// --- Registration: second Bash hook, fail-closed on crash/timeout, with a short timeout ---
const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.claude', 'settings.json'), 'utf8'));
const entry = settings.hooks.PreToolUse.find((h) => h.matcher === 'Bash');
const hook = entry && entry.hooks.find((h) => /subagent-guard\.js/.test(h.command));
assert(hook, 'hook must be registered');
assert.strictEqual(hook.onFailure, 'block', 'hook must fail closed on crash or timeout');
assert(hook.timeout > 0 && hook.timeout <= 30, 'hook needs a bounded timeout');
console.log('SubagentGuard.check: OK');
