'use strict';
/**
 * Phase 18 / issue #80 gate-reconciliation checks. Static and deterministic: no browser,
 * no network. They pin what is true on main today so the reconciliation document cannot
 * drift into claiming that a gate is satisfied or that protected execution exists.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'security', 'm2-issue80-gate-reconciliation.md');
const GATES = ['C1', 'C2', 'C3', 'C4', 'C5', 'T1', 'T2', 'T3'];
const STATUSES = new Set(['SATISFIED', 'BLOCKED', 'UNVERIFIED', 'DEFERRED_BY_OWNER', 'NOT_APPLICABLE']);

// Parse the gate matrix: rows of the form "| C1 | ... | STATUS | ..." where column 3 is the status.
function parseMatrix(markdown) {
  const rows = {};
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length > 4 && GATES.includes(cells[1])) rows[cells[1]] = cells[3];
  }
  return rows;
}

// Invariant: every gate has a recognised status, and none may be SATISFIED while the
// independent human review (C2) and the unbuilt controls remain open.
function validateMatrix(markdown) {
  const rows = parseMatrix(markdown);
  const errors = [];
  for (const g of GATES) {
    if (!(g in rows)) errors.push(`${g} missing`);
    else if (!STATUSES.has(rows[g])) errors.push(`${g} has unrecognised status "${rows[g]}"`);
    else if (rows[g] === 'SATISFIED') errors.push(`${g} must not be SATISFIED`);
  }
  return errors;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Production surface that must not exist while Phase 18 is unimplemented and the owner
// has deferred protected execution (OWNER-12, OWNER-13).
const FORBIDDEN = [
  '--approve-action', '--emit-token-to', 'PILOT_APPROVAL_RUN_TOKEN', 'disable-features=SharedWorker',
];
function findForbidden(files, read) {
  const hits = [];
  for (const f of files) {
    const text = read(f);
    for (const token of FORBIDDEN) if (text.includes(token)) hits.push(`${path.relative(ROOT, f)}: ${token}`);
  }
  return hits;
}

test('matrix: committed reconciliation document has a valid status for every gate and none SATISFIED', () => {
  const errors = validateMatrix(fs.readFileSync(DOC, 'utf8'));
  assert.deepEqual(errors, []);
});

test('matrix: C2 is never marked SATISFIED (independent human review unmet)', () => {
  assert.notEqual(parseMatrix(fs.readFileSync(DOC, 'utf8')).C2, 'SATISFIED');
});

test('matrix validator rejects a SATISFIED C2, a missing gate and an invented status', () => {
  const good = GATES.map((g) => `| ${g} | req | BLOCKED | ev |`).join('\n');
  assert.deepEqual(validateMatrix(good), []);
  assert.ok(validateMatrix(good.replace('| C2 | req | BLOCKED', '| C2 | req | SATISFIED')).some((e) => e.startsWith('C2')));
  assert.ok(validateMatrix(good.split('\n').filter((l) => !l.includes('| T3 |')).join('\n')).includes('T3 missing'));
  assert.ok(validateMatrix(good.replace('| C4 | req | BLOCKED', '| C4 | req | DONE')).some((e) => e.includes('unrecognised')));
});

test('fail-closed: no Phase 18 pilot module exists on main', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'core', 'pilot')), false);
});

test('fail-closed: no approval flag, run-token key or SharedWorker-disabling flag ships in production surface', () => {
  const files = [path.join(ROOT, 'falcon.js'), path.join(ROOT, 'package.json'), path.join(ROOT, '.env.example')]
    .concat(walk(path.join(ROOT, 'src')), walk(path.join(ROOT, 'scripts')), walk(path.join(ROOT, '.github')))
    .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  assert.deepEqual(findForbidden(files, (f) => fs.readFileSync(f, 'utf8')), []);
});

test('forbidden-token scan detects a planted occurrence', () => {
  const fake = { 'a.js': 'ok', 'b.js': "program.option('--approve-action')", 'c.js': 'x: --disable-features=SharedWorker' };
  const hits = findForbidden(Object.keys(fake).map((n) => path.join(ROOT, n)), (f) => fake[path.basename(f)]);
  assert.equal(hits.length, 2);
});

test('residual-risk records T1 to T3 remain OPEN and not accepted by the owner', () => {
  for (const t of ['T1', 'T2', 'T3']) {
    const text = fs.readFileSync(path.join(ROOT, 'docs', 'security', `phase-18-residual-risk-${t}.md`), 'utf8');
    assert.match(text, /\*\*Status: OPEN - NOT ACCEPTED\.\*\*/, `${t} status changed; update the reconciliation document`);
  }
});

test('plan keeps the SharedWorker refusal: no armed execute path and the flag workaround is not accepted', () => {
  const plan = fs.readFileSync(path.join(ROOT, 'docs', 'phase-18-plan.md'), 'utf8');
  assert.match(plan, /Phase 18 cannot arm execute mode on the current pinned Chromium build/);
  assert.match(plan, /`--disable-features=SharedWorker` is NOT accepted as a product mechanism/);
});

test('.env.example keeps every pilot key genuinely blank or absent', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8').split('\n');
  for (const l of lines.filter((x) => /^PILOT_/.test(x))) assert.match(l, /^PILOT_[A-Z_*]+=\s*$/);
});
