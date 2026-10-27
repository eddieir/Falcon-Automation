'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { decide } = require('../../.claude/hooks/subagent-guard.js');

const sub = (command) => ({ agent_id: 'a1', tool_input: { command } });
const main = (command) => ({ tool_input: { command } });

for (const cmd of [
  'claude -p "hi"', 'cd x && claude --print --agent developer hi', '/usr/local/bin/claude -p hi',
  'gh pr comment 1 --body x --attach ./a.png', 'gh pr create --attach=./v.webm',
  'npm install -g @playwright/cli@latest', 'npm i --global foo', 'pnpm add -g foo', 'yarn global add foo',
  'playwright-cli attach --extension=chrome', 'npx playwright cli attach --cdp=http://localhost:9222'
]) assert(decide(sub(cmd)), `should deny: ${cmd}`);

for (const cmd of [
  'npx --no-install playwright cli open http://127.0.0.1:3000', 'npm install --no-save left-pad', 'npm run test:unit',
  'gh pr view 120 --json state', 'git diff origin/main --stat', 'node tests/unit/AgentCatalog.check.js'
]) assert.strictEqual(decide(sub(cmd)), null, `should allow: ${cmd}`);

// The main session is never blocked by this hook.
assert.strictEqual(decide(main('claude -p hi')), null);
assert.strictEqual(decide(main('npm install -g foo')), null);

const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.claude', 'settings.json'), 'utf8'));
const entry = settings.hooks.PreToolUse.find((h) => h.matcher === 'Bash');
assert(entry && entry.hooks.some((h) => /subagent-guard\.js/.test(h.command)), 'hook must be registered');
console.log('SubagentGuard.check: OK');
