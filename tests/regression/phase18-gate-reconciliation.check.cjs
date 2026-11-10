'use strict';
/**
 * Phase 18 / issue #80 gate-reconciliation checks. Static, deterministic, no browser, no network.
 *
 * These enforce documentary consistency only. A passing run does not show that any security
 * control works; SATISFIED claims still need independent review of the referenced evidence.
 * Project status (which gates are open, whether src/core/pilot exists) is deliberately NOT
 * asserted, so legitimate M2 progress does not fail the suite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'security', 'm2-issue80-gate-reconciliation.md');
const GATES = ['C1', 'C2', 'C3', 'C4', 'C5', 'T1', 'T2', 'T3'];
const RISKS = ['T1', 'T2', 'T3'];
const STATUSES = new Set(['SATISFIED', 'BLOCKED', 'UNVERIFIED', 'DEFERRED_BY_OWNER', 'NOT_APPLICABLE']);
const OPEN_OK = new Set(['BLOCKED', 'UNVERIFIED']);
const RESOLVED_OK = new Set(['SATISFIED', 'DEFERRED_BY_OWNER', 'NOT_APPLICABLE']);
const PATH_RE = /\b((?:docs|tests|src|scripts|\.github)\/[\w./-]*[\w-])/g;

function parseMatrix(markdown) {
  const rows = {};
  for (const line of markdown.split('\n')) {
    const c = line.split('|').map((x) => x.trim());
    if (c.length > 4 && GATES.includes(c[1])) rows[c[1]] = { status: c[3], evidence: c[4] };
  }
  return rows;
}

// "## C2 approval record" section: `key: value` lines.
function parseC2Record(markdown) {
  const m = markdown.match(/## C2 approval record\n([\s\S]*?)(?:\n## |\n?$)/);
  const rec = {};
  if (m) for (const l of m[1].split('\n')) { const k = l.match(/^([a-z-]+):\s*(.*)$/); if (k) rec[k[1]] = k[2].trim(); }
  return rec;
}

// Residual-risk record state: 'open' while "NOT ACCEPTED"/"OPEN" appears in its Status line,
// 'resolved' for any other parseable status, null if the status line cannot be found.
function riskState(recordText) {
  const m = recordText.match(/\*\*Status:\s*([^*]+?)\.?\*\*/);
  if (!m) return null;
  return /OPEN|NOT ACCEPTED/i.test(m[1]) ? 'open' : 'resolved';
}

const NOT_HUMAN = /\b(agent|claude|ai|bot|llm|model)\b/i;
const MISSING = /^(|not recorded|none|tbd|n\/a|unknown|pending)$/i;
const normaliseName = (v) => v.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * deps: { readRecord(gate) -> text, pathExists(relPath) -> bool }
 * Returns a list of error strings; empty means documentary consistency holds.
 */
function validateGates(markdown, deps) {
  const errors = [];
  const rows = parseMatrix(markdown);
  for (const g of GATES) {
    const r = rows[g];
    if (!r) { errors.push(`${g} missing`); continue; }
    if (!STATUSES.has(r.status)) { errors.push(`${g} has unrecognised status "${r.status}"`); continue; }
    if (r.status === 'SATISFIED') {
      const refs = [...r.evidence.matchAll(PATH_RE)].map((m) => m[1]);
      if (refs.length === 0) errors.push(`${g} SATISFIED without a repository evidence path`);
      for (const p of refs) if (!deps.pathExists(p)) errors.push(`${g} evidence path does not exist: ${p}`);
    }
  }
  if (rows.C2 && rows.C2.status === 'SATISFIED') {
    const rec = parseC2Record(markdown);
    const reviewer = rec.reviewer || '';
    const author = rec.author || '';
    const reviewerNamed = !MISSING.test(reviewer);
    const authorNamed = !MISSING.test(author);
    if (!reviewerNamed) errors.push('C2 SATISFIED without a named independent reviewer');
    else if (NOT_HUMAN.test(reviewer)) errors.push('C2 reviewer must be a human, not an agent or model');
    if (!authorNamed) errors.push('C2 SATISFIED without a named author');
    else if (reviewerNamed && normaliseName(author) === normaliseName(reviewer)) errors.push('C2 reviewer must not be the author');
    for (const key of ['approval-record', 'effectiveness-evidence']) {
      const v = rec[key] || '';
      if (MISSING.test(v)) errors.push(`C2 SATISFIED without ${key}`);
      else if (!deps.pathExists(v)) errors.push(`C2 ${key} path does not exist: ${v}`);
    }
  }
  for (const t of RISKS) {
    const rows_t = rows[t];
    if (!rows_t || !STATUSES.has(rows_t.status)) continue;
    const state = riskState(deps.readRecord(t));
    if (state === null) errors.push(`${t} record status cannot be parsed`);
    else if (state === 'open' && !OPEN_OK.has(rows_t.status)) errors.push(`${t} is ${rows_t.status} but its record is still open`);
    else if (state === 'resolved' && !RESOLVED_OK.has(rows_t.status)) errors.push(`${t} record is resolved but the matrix says ${rows_t.status}`);
  }
  return errors;
}

// Forbidden production mechanisms (owner decisions OWNER-12, OWNER-13 and the SharedWorker refusal).
// PILOT_APPROVAL_RUN_TOKEN is not listed: the plan requires rejecting it on presence.
const FORBIDDEN = [
  { name: '--approve-action', re: /--approve-action/ },
  { name: '--emit-token-to', re: /--emit-token-to/ },
  { name: 'disable-features SharedWorker', re: /disable-features[^\n]*SharedWorker/ },
];
function findForbidden(files, read) {
  const hits = [];
  for (const f of files) {
    const text = read(f);
    for (const { name, re } of FORBIDDEN) if (re.test(text)) hits.push(`${path.relative(ROOT, f)}: ${name}`);
  }
  return hits;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const realDeps = {
  readRecord: (g) => fs.readFileSync(path.join(ROOT, 'docs', 'security', `phase-18-residual-risk-${g}.md`), 'utf8'),
  pathExists: (p) => fs.existsSync(path.join(ROOT, p)),
};

// ---- fixtures -------------------------------------------------------------------------------
const OPEN_REC = '**Status: OPEN - NOT ACCEPTED.** x';
const ACCEPTED_REC = '**Status: ACCEPTED by owner on 2027-01-01.** x';
const fixtureDeps = (rec = OPEN_REC, existing = ['docs/a.md']) => ({ readRecord: () => rec, pathExists: (p) => existing.includes(p) });
function matrix(over = {}, c2Record = '') {
  const rows = GATES.map((g) => {
    const o = over[g] || {};
    return `| ${g} | req | ${o.status || 'BLOCKED'} | ${o.evidence || 'text'} |`;
  }).join('\n');
  return `${rows}\n${c2Record}`;
}
const GOOD_C2 = '\n## C2 approval record\nreviewer: Jane Doe\nauthor: Alex Roe\napproval-record: docs/a.md\neffectiveness-evidence: docs/a.md\n';

// ---- repository checks ----------------------------------------------------------------------
test('repository: the committed matrix is documentarily consistent with the T1 to T3 records', () => {
  assert.deepEqual(validateGates(fs.readFileSync(DOC, 'utf8'), realDeps), []);
});

test('repository: no approval flag or SharedWorker-disabling flag in the production surface', () => {
  const files = [path.join(ROOT, 'falcon.js'), path.join(ROOT, 'package.json')]
    .concat(walk(path.join(ROOT, 'src')), walk(path.join(ROOT, 'scripts')), walk(path.join(ROOT, '.github')))
    .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  assert.deepEqual(findForbidden(files, (f) => fs.readFileSync(f, 'utf8')), []);
});

test('repository: the plan still rejects the SharedWorker-disabling flag as a product mechanism', () => {
  const plan = fs.readFileSync(path.join(ROOT, 'docs', 'phase-18-plan.md'), 'utf8');
  assert.match(plan, /`--disable-features=SharedWorker` is NOT accepted as a product mechanism/);
});

test('repository: .env.example keeps every pilot key genuinely blank or absent', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8').split('\n');
  for (const l of lines.filter((x) => /^PILOT_/.test(x))) assert.match(l, /^PILOT_[A-Z_*]+=\s*$/);
});

// ---- validator behaviour on fixtures --------------------------------------------------------
test('validator: a complete matrix of open gates passes', () => {
  assert.deepEqual(validateGates(matrix(), fixtureDeps()), []);
});

test('validator: a missing gate fails', () => {
  const m = matrix().split('\n').filter((l) => !l.startsWith('| T3 |')).join('\n');
  assert.deepEqual(validateGates(m, fixtureDeps()), ['T3 missing']);
});

test('validator: an invalid status fails', () => {
  const errs = validateGates(matrix({ C4: { status: 'DONE' } }), fixtureDeps());
  assert.deepEqual(errs, ['C4 has unrecognised status "DONE"']);
});

test('validator: SATISFIED with no evidence path, or a nonexistent path, fails', () => {
  assert.deepEqual(validateGates(matrix({ C3: { status: 'SATISFIED', evidence: 'trust me' } }), fixtureDeps()),
    ['C3 SATISFIED without a repository evidence path']);
  assert.deepEqual(validateGates(matrix({ C3: { status: 'SATISFIED', evidence: 'see docs/missing.md' } }), fixtureDeps()),
    ['C3 evidence path does not exist: docs/missing.md']);
});

test('validator: SATISFIED with an existing evidence path is accepted (gate progress is not rejected)', () => {
  assert.deepEqual(validateGates(matrix({ C3: { status: 'SATISFIED', evidence: 'docs/a.md' } }), fixtureDeps()), []);
});

test('validator: C2 SATISFIED needs a named, human, non-author reviewer and existing evidence', () => {
  const sat = { C2: { status: 'SATISFIED', evidence: 'docs/a.md' } };
  const errs = (rec) => validateGates(matrix(sat, rec), fixtureDeps());
  assert.deepEqual(errs(''), [
    'C2 SATISFIED without a named independent reviewer',
    'C2 SATISFIED without a named author',
    'C2 SATISFIED without approval-record',
    'C2 SATISFIED without effectiveness-evidence',
  ]);
  assert.deepEqual(errs(GOOD_C2.replace('Jane Doe', 'NOT RECORDED')), ['C2 SATISFIED without a named independent reviewer']);
  assert.deepEqual(errs(GOOD_C2.replace('Jane Doe', 'Claude Security agent')), ['C2 reviewer must be a human, not an agent or model']);
  assert.deepEqual(errs(GOOD_C2.replace('Jane Doe', 'alex roe')), ['C2 reviewer must not be the author']);
  assert.deepEqual(errs(GOOD_C2.replace('approval-record: docs/a.md', 'approval-record: docs/nope.md')), ['C2 approval-record path does not exist: docs/nope.md']);
  assert.deepEqual(errs(GOOD_C2.replace('effectiveness-evidence: docs/a.md', 'effectiveness-evidence: ')), ['C2 SATISFIED without effectiveness-evidence']);
  assert.deepEqual(errs(GOOD_C2), []);
});

test('validator: C2 SATISFIED without a named author is rejected (reviewer independence is unprovable)', () => {
  const sat = { C2: { status: 'SATISFIED', evidence: 'docs/a.md' } };
  const errs = (rec) => validateGates(matrix(sat, rec), fixtureDeps());
  const noAuthor = ['C2 SATISFIED without a named author'];
  assert.deepEqual(errs(GOOD_C2.replace('author: Alex Roe\n', '')), noAuthor);
  assert.deepEqual(errs(GOOD_C2.replace('author: Alex Roe', 'author:')), noAuthor);
  for (const placeholder of ['NOT RECORDED', 'none', 'TBD', 'n/a', 'unknown', 'pending', '   ']) {
    assert.deepEqual(errs(GOOD_C2.replace('Alex Roe', placeholder)), noAuthor, `author placeholder "${placeholder}"`);
  }
});

test('validator: C2 reviewer placeholders and whitespace/case variants of the author are rejected', () => {
  const sat = { C2: { status: 'SATISFIED', evidence: 'docs/a.md' } };
  const errs = (rec) => validateGates(matrix(sat, rec), fixtureDeps());
  for (const placeholder of ['unknown', 'pending', 'TBD', 'n/a', 'none']) {
    assert.deepEqual(errs(GOOD_C2.replace('Jane Doe', placeholder)), ['C2 SATISFIED without a named independent reviewer'], `reviewer placeholder "${placeholder}"`);
  }
  assert.deepEqual(errs(GOOD_C2.replace('Jane Doe', '  ALEX   roe ')), ['C2 reviewer must not be the author']);
});

test('validator: T1 to T3 are reconciled against their records in both directions', () => {
  const sat = { T1: { status: 'SATISFIED', evidence: 'docs/a.md' } };
  assert.deepEqual(validateGates(matrix(sat), fixtureDeps(OPEN_REC)), ['T1 is SATISFIED but its record is still open']);
  assert.deepEqual(validateGates(matrix(), fixtureDeps(ACCEPTED_REC)), RISKS.map((t) => `${t} record is resolved but the matrix says BLOCKED`));
  assert.deepEqual(validateGates(matrix({ T1: { status: 'DEFERRED_BY_OWNER' }, T2: { status: 'DEFERRED_BY_OWNER' }, T3: { status: 'DEFERRED_BY_OWNER' } }), fixtureDeps(ACCEPTED_REC)), []);
  assert.deepEqual(validateGates(matrix(), fixtureDeps('no status here')), RISKS.map((t) => `${t} record status cannot be parsed`));
});

test('forbidden scan: detects planted approval and SharedWorker-flag mechanisms, ignores clean files', () => {
  const fake = {
    'a.js': 'ok',
    'b.js': "program.option('--approve-action')",
    'c.js': "args: ['--disable-features=Foo,SharedWorker']",
    'd.js': "if (process.env.PILOT_APPROVAL_RUN_TOKEN !== undefined) refuse()",
  };
  const hits = findForbidden(Object.keys(fake).map((n) => path.join(ROOT, n)), (f) => fake[path.basename(f)]);
  assert.deepEqual(hits, ['b.js: --approve-action', 'c.js: disable-features SharedWorker']);
});
