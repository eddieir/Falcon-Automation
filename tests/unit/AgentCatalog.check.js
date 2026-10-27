'use strict';
// Static validation of the agent catalog, CLAUDE.md model table and organization docs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const agentsDir = path.join(root, '.claude', 'agents');
const allowedKeys = new Set(['name', 'description', 'tools', 'model', 'effort', 'maxTurns']);
const allowedTools = new Set(['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebSearch', 'WebFetch', 'Agent']);
const modelIds = new Set([
  'claude-haiku-4-5', 'claude-haiku-5-5', 'claude-sonnet-4-5', 'claude-sonnet-4-6',
  'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5'
]);

function parse(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert(m, `${file}: missing front matter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const k = line.match(/^([A-Za-z-]+): ?(.*)$/);
    assert(k, `${file}: bad front-matter line "${line}"`);
    meta[k[1]] = k[2].replace(/^"(.*)"$/, '$1');
  }
  return { meta, body: m[2] };
}

const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).sort();
assert.strictEqual(files.length, 27, `expected 27 agents, found ${files.length}`);

const names = new Set();
const agents = {};
for (const f of files) {
  const { meta, body } = parse(path.join(agentsDir, f));
  for (const k of Object.keys(meta)) assert(allowedKeys.has(k), `${f}: unsupported key ${k}`);
  assert(meta.name && meta.description, `${f}: name and description required`);
  assert.strictEqual(meta.name + '.md', f, `${f}: name must match filename`);
  assert(!names.has(meta.name), `${f}: duplicate name`);
  names.add(meta.name);
  assert(modelIds.has(meta.model), `${f}: model ${meta.model} not in the approved ID set`);
  assert(!/fable|inherit|\[1m\]/i.test(meta.model), `${f}: prohibited model`);
  // Organization policy: bounded turns (existing agents use 8-12; new agents use 8).
  assert(Number(meta.maxTurns) >= 1 && Number(meta.maxTurns) <= 12, `${f}: maxTurns out of range`);
  assert(meta.tools, `${f}: tools allowlist required`);
  for (const t of meta.tools.split(',').map(x => x.trim())) assert(allowedTools.has(t), `${f}: unknown tool ${t}`);
  assert(/nested agents|nested subagents/i.test(body), `${f}: no-nested-agent rule missing`);
  assert(body.includes('docs/organization/ADVISOR-POLICY.md'), `${f}: Advisor policy reference missing`);
  assert(body.includes('docs/organization/AGENT-SKILL-MATRIX.md'), `${f}: Skill profile reference missing`);
  agents[meta.name] = meta;
}

// Only the Production Director may spawn agents; no AI CTO; one director.
for (const [n, m] of Object.entries(agents)) {
  if (n !== 'production-director') assert(!m.tools.split(',').map(x => x.trim()).includes('Agent'), `${n}: must not have Agent tool`);
}
assert(!names.has('cto') && !names.has('chief-technology-officer') && ![...names].some(n => /(^|-)cto(-|$)/.test(n)), 'AI CTO must not exist');
assert.strictEqual([...names].filter(n => /director/.test(n) && /production/.test(n)).length, 1);

// Opus reserved for Security Engineer; Developer, QA, Reviewer distinct.
for (const [n, m] of Object.entries(agents)) if (m.model === 'claude-opus-5-5') assert.strictEqual(n, 'security-engineer');
assert.strictEqual(agents['security-engineer'].model, 'claude-opus-5-5');
const trio = ['developer', 'qa-engineer', 'code-reviewer'].map(n => agents[n].model);
assert.strictEqual(new Set(trio).size, 3, 'Developer, QA and Code Reviewer must use distinct models');
assert(agents['code-reviewer'].tools.split(',').every(t => !/Edit|Write/.test(t)), 'Code Reviewer must stay read-only');

// CLAUDE.md model table matches front matter exactly.
const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
const rows = [...claude.matchAll(/^\| ([^|]+) \| `([^`]+)` \|$/gm)].map(r => [r[1].trim(), r[2]]);
const display = {
  'Product Manager': 'product-manager', 'Product Owner': 'product-owner', 'Project Manager': 'project-manager',
  'Solution Architect': 'solution-architect', 'Developer': 'developer', 'QA Engineer': 'qa-engineer',
  'Code Reviewer': 'code-reviewer', 'Security Engineer': 'security-engineer', 'DevOps Engineer': 'devops-engineer',
  'Technical Writer': 'technical-writer', 'Release Manager': 'release-manager',
  'Market Competitive Intelligence': 'market-competitive-intelligence', 'Chief of Staff': 'chief-of-staff',
  'Product Director': 'product-director', 'Chief Architect': 'chief-architect', 'Solution Designer': 'solution-designer',
  'UX / Product Designer': 'ux-product-designer', 'AI / Agentic Systems Engineer': 'ai-agentic-systems-engineer',
  'Developer Experience Engineer': 'developer-experience-engineer', 'Data & Analytics Engineer': 'data-analytics-engineer',
  'Benchmark & Evaluation Engineer': 'benchmark-evaluation-engineer', 'Privacy & Compliance Specialist': 'privacy-compliance-specialist',
  'Performance & Reliability Engineer': 'performance-reliability-engineer', 'Site Reliability Engineer': 'site-reliability-engineer',
  'Customer Validation Strategist': 'customer-validation-strategist', 'Technical Product Marketing': 'technical-product-marketing'
};
const tableModels = {};
for (const [d, id] of rows) if (d === 'Production Director (main session)') tableModels['production-director'] = id; else if (display[d]) tableModels[display[d]] = id;
assert.strictEqual(Object.keys(tableModels).length, 27, 'CLAUDE.md table must list all 27 roles');
for (const n of names) assert.strictEqual(tableModels[n], agents[n].model, `${n}: CLAUDE.md table disagrees with front matter`);

// Docs and skills exist; catalog covers every agent.
const docs = ['AGENT-ORGANIZATION', 'AGENT-CATALOG', 'DECISION-RIGHTS', 'AGENT-ROUTING', 'ADVISOR-POLICY', 'AGENT-SKILL-MATRIX',
  'SKILLS-RESEARCH', 'SKILLS-REGISTRY', 'SKILL-SECURITY-AUDIT', 'SKILL-MAINTENANCE', 'CLAUDE-PRO-EFFICIENCY', 'IMPLEMENTATION-CHECKPOINT'];
for (const d of docs) assert(fs.existsSync(path.join(root, 'docs', 'organization', d + '.md')), `missing docs/organization/${d}.md`);
const catalog = fs.readFileSync(path.join(root, 'docs/organization/AGENT-CATALOG.md'), 'utf8');
const matrix = fs.readFileSync(path.join(root, 'docs/organization/AGENT-SKILL-MATRIX.md'), 'utf8');
for (const n of names) {
  assert(catalog.includes('`' + n + '.md`'), `${n}: missing from catalog`);
  assert(catalog.includes('`' + agents[n].model + '`'), `${n}: model missing in catalog`);
}
assert.strictEqual((matrix.match(/^\| (?!Agent|---)/gm) || []).length, 27, 'skill matrix must have 27 rows');

const skillsDir = path.join(root, '.claude', 'skills');
for (const s of fs.readdirSync(skillsDir)) {
  const { meta } = parse(path.join(skillsDir, s, 'SKILL.md'));
  assert.strictEqual(meta.name, s, `skill ${s}: name must match directory`);
  assert(meta.description, `skill ${s}: description required`);
  assert(!fs.existsSync(path.join(skillsDir, s, 'scripts')), `skill ${s}: scripts need security review`);
}
const registry = fs.readFileSync(path.join(root, 'docs/organization/SKILLS-REGISTRY.md'), 'utf8');
for (const s of fs.readdirSync(skillsDir)) assert(registry.includes('`' + s + '`'), `skill ${s}: not in registry`);

// Router keeps the single-coordinator and gate language.
const cycle = fs.readFileSync(path.join(skillsDir, 'production-cycle', 'SKILL.md'), 'utf8');
assert(cycle.includes('sole coordinator') && cycle.includes('Decision router'));
for (const n of names) assert(fs.existsSync(path.join(agentsDir, n + '.md')));
console.log('AgentCatalog.check: OK (27 agents)');
