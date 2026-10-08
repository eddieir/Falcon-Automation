#!/usr/bin/env node
'use strict';
// Parallel-worker benchmark. Informational thresholds never affect the exit code.
// Isolation: runs in a temp copy of falcon.js, src/, package.json (+ node_modules symlink),
// so the repository's data/ and reports/ are never touched.
//   node scripts/benchmark/parallel.js [--workers=1,2,4] [--runs=5] [--warmup=1]
//        [--delay-ms=0] [--baseline-1w-ms=N] [--write] [--timeout-ms=600000]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT = path.join(ROOT, 'docs', 'benchmarks', 'phase-16-parallel-benchmark.json');
// Fields stripped before comparing reports across worker counts.
const VOLATILE_KEYS = new Set(['timestamp', 'startTime', 'endTime', 'startedAt', 'finishedAt', 'generatedAt',
    'duration', 'durationMs', 'totalDuration', 'elapsed', 'elapsedMs', 'runId', 'id', 'workers', 'shard',
    'workerId', 'executionMode', 'execution', 'screenshot', 'screenshotPath', 'path', 'time', 'date']);

function sorted(a) { return [...a].sort((x, y) => x - y); }
function median(a) {
    if (!a.length) return null;
    const s = sorted(a); const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(a, p) {
    if (!a.length) return null;
    const s = sorted(a); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}
function summarize(a) {
    if (!a.length) return { n: 0, median: null, min: null, max: null, p95: null, note: 'no samples' };
    const s = sorted(a);
    const out = { n: a.length, median: median(a), min: s[0], max: s[s.length - 1] };
    if (a.length >= 20) out.p95 = percentile(a, 0.95); else { out.p95 = null; out.note = 'range only (n<20, no p95)'; }
    return out;
}
function speedup(base, t) { return base && t ? base / t : null; }
function efficiency(sp, workers) { return sp === null ? null : sp / workers; }

function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
        const o = {};
        for (const k of Object.keys(value).sort()) if (!VOLATILE_KEYS.has(k)) o[k] = normalize(value[k]);
        return o;
    }
    return value;
}

function parseArgs(argv) {
    const o = { workers: [1, 2, 4], runs: 5, warmup: 1, delayMs: 0, baseline: null, write: false, timeoutMs: 600000 };
    const int = (k, v, min) => { if (!/^\d+$/.test(v) || Number(v) < min) throw new Error(`Invalid --${k}: ${v}`); return Number(v); };
    for (const a of argv) {
        if (a === '--write') { o.write = true; continue; }
        const m = /^--([a-z0-9-]+)=(.*)$/.exec(a);
        if (!m) throw new Error(`Unknown argument: ${a}`);
        const [, k, v] = m;
        if (k === 'workers') o.workers = v.split(',').map((x) => int(k, x, 1));
        else if (k === 'runs') o.runs = int(k, v, 1);
        else if (k === 'warmup') o.warmup = int(k, v, 0);
        else if (k === 'delay-ms') o.delayMs = int(k, v, 0);
        else if (k === 'baseline-1w-ms') o.baseline = int(k, v, 1);
        else if (k === 'timeout-ms') o.timeoutMs = int(k, v, 1000);
        else throw new Error(`Unknown argument: ${a}`);
    }
    if (!o.workers.includes(1)) o.workers.unshift(1);
    return o;
}

function treeRss(rootPid) {
    const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) return null;
    const rows = r.stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    const kids = new Map();
    for (const [pid, ppid, rss] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push([pid, rss]); }
    const self = rows.find((r2) => r2[0] === rootPid);
    let total = self ? self[2] : 0; const q = [rootPid];
    while (q.length) for (const [pid, rss] of kids.get(q.shift()) || []) { total += rss; q.push(pid); }
    return total;
}

function prepareWorkdir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-bench-'));
    for (const f of ['falcon.js', 'package.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    for (const d of ['src', 'utils']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    return dir;
}

function startFixture(delayMs) {
    return new Promise((resolve, reject) => {
        const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'fixture', 'server.js'), '--port=0', `--delay-ms=${delayMs}`], { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        p.once('error', reject);
        p.stdout.on('data', (d) => { buf += d; const m = /FIXTURE_URL=(\S+)/.exec(buf); if (m) resolve({ url: m[1], proc: p }); });
        p.once('exit', (c) => reject(new Error(`fixture exited early (${c})`)));
    });
}

function readReports(dir) {
    const rd = path.join(dir, 'reports');
    if (!fs.existsSync(rd)) return {};
    const out = {};
    for (const f of fs.readdirSync(rd).filter((n) => n.endsWith('.json')).sort()) {
        try { out[f] = normalize(JSON.parse(fs.readFileSync(path.join(rd, f), 'utf8'))); } catch { out[f] = 'UNPARSEABLE'; }
    }
    return out;
}

const LOG_TS = /^\[[A-Z]+\]\s+(\d{4}-\d\d-\d\dT[\d:.]+Z)\s+-\s(.*)$/;

/**
 * Sequential (workers=1) stage split derived from execution.log timestamps, approximate:
 * discovery = "Sweeping" line -> first PageAnalyser line; rest = first PageAnalyser line -> last log line.
 * Returns null (reported as UNKNOWN) if the markers are not found.
 */
function stagesFromLog(dir) {
    let text;
    try { text = fs.readFileSync(path.join(dir, 'reports', 'execution.log'), 'utf8'); } catch { return null; }
    let sweepAt = null; let analyseAt = null; let lastAt = null;
    for (const line of text.split('\n')) {
        const m = LOG_TS.exec(line);
        if (!m) continue;
        const t = Date.parse(m[1]);
        if (!Number.isFinite(t)) continue;
        lastAt = t;
        if (sweepAt === null && m[2].includes('Sweeping ')) sweepAt = t;
        else if (sweepAt !== null && analyseAt === null && m[2].includes('[PageAnalyser]')) analyseAt = t;
    }
    if (sweepAt === null || analyseAt === null || lastAt === null) return null;
    return { discoveryMs: analyseAt - sweepAt, parallelizableMs: lastAt - analyseAt };
}

/** Stage timings from the merged report (parallel runs): execution.timings, VOLATILE. */
function stagesFromReport(dir) {
    try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, 'reports', 'test-report.json'), 'utf8')).execution.timings;
        const ok = ['discoveryMs', 'analysisMs', 'executionMs'].every((k) => Number.isFinite(t[k]));
        if (!ok) return null;
        return { discoveryMs: t.discoveryMs, analysisMs: t.analysisMs, executionMs: t.executionMs,
            mergeMs: Number.isFinite(t.mergeMs) ? t.mergeMs : null, parallelizableMs: t.analysisMs + t.executionMs };
    } catch { return null; }
}

function runOnce(dir, url, workers, timeoutMs) {
    fs.rmSync(path.join(dir, 'reports'), { recursive: true, force: true });
    return new Promise((resolve) => {
        const t0 = process.hrtime.bigint();
        const env = { ...process.env, CI: 'true', FALCON_RUN_HISTORY: 'off', HEADLESS: 'true' };
        const p = spawn(process.execPath, ['falcon.js', '--no-dashboard', `--url=${url}`, `--workers=${workers}`], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; let peak = null;
        p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
        const sampler = setInterval(() => { const r = treeRss(p.pid); if (r !== null && (peak === null || r > peak)) peak = r; }, 500);
        const killer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
        p.once('close', (code) => {
            clearInterval(sampler); clearTimeout(killer);
            const stages = workers === 1 ? stagesFromLog(dir) : stagesFromReport(dir);
            resolve({ code, ms: Number(process.hrtime.bigint() - t0) / 1e6, peakRssKb: peak, output: out, stages, reports: readReports(dir) });
        });
    });
}

/**
 * Semantic digest: exit code, summary, result, the sorted (name,status) multiset and the explored URL set.
 * Row-level bookkeeping (page/pageOrdinal/scn/rep vs repetition), explored-URL order and the extra
 * parallel-only files are representation differences and are excluded.
 */
function semanticKey(r) {
    const rep = r.reports['test-report.json'] || {};
    const exp = r.reports['exploratory_test_results.json'] || {};
    const tests = (Array.isArray(rep.tests) ? rep.tests : []).map((t) => `${t.name}|${t.status}`).sort();
    const pages = (Array.isArray(exp.exploredPages) ? [...exp.exploredPages] : []).sort();
    return JSON.stringify({ code: r.code, summary: rep.summary, result: rep.result, tests, pages });
}

const UNSUPPORTED = /unknown (option|argument|flag)|unrecognized|unsupported|invalid (option|argument)/i;

async function main() {
    const o = parseArgs(process.argv.slice(2));
    const dir = prepareWorkdir();
    const fixture = await startFixture(o.delayMs);
    const results = {}; let reference = null; let rawReference = null; let rawIdentical = true; let equivalent = true; let blocked = null;
    try {
        for (const w of o.workers) {
            const times = []; const rss = []; const stg = { discoveryMs: [], parallelizableMs: [], analysisMs: [], executionMs: [], mergeMs: [] };
            for (let i = 0; i < o.warmup + o.runs; i++) {
                const r = await runOnce(dir, fixture.url, w, o.timeoutMs);
                if (r.code !== 0 && UNSUPPORTED.test(r.output)) { blocked = `falcon.js rejected --workers=${w}`; break; }
                if (i < o.warmup) continue;
                times.push(r.ms);
                if (r.stages) for (const k of Object.keys(stg)) if (Number.isFinite(r.stages[k])) stg[k].push(r.stages[k]);
                if (r.peakRssKb !== null) rss.push(r.peakRssKb);
                const key = semanticKey(r);
                if (reference === null) reference = key; else if (key !== reference) equivalent = false;
                const raw = JSON.stringify({ code: r.code, reports: r.reports });
                if (rawReference === null) rawReference = raw; else if (raw !== rawReference) rawIdentical = false;
            }
            if (blocked) break;
            const stages = {};
            for (const [k, v] of Object.entries(stg)) stages[k] = v.length ? summarize(v) : 'UNKNOWN';
            results[w] = { wallMs: summarize(times), stages, stageSource: w === 1 ? 'execution.log timestamps (approximate)' : 'report execution.timings (monotonic)',
                peakRssKb: rss.length ? Math.max(...rss) : 'UNKNOWN' };
        }
    } finally {
        fixture.proc.removeAllListeners('exit'); fixture.proc.kill('SIGTERM');
        fs.rmSync(dir, { recursive: true, force: true });
    }
    if (blocked) { process.stdout.write(`BLOCKED: ${blocked}; no numbers recorded\n`); process.exit(3); }

    const base = results[1].wallMs.median;
    for (const w of Object.keys(results)) {
        const sp = speedup(base, results[w].wallMs.median);
        results[w].speedup = sp; results[w].efficiency = efficiency(sp, Number(w));
    }
    // Parallelizable stages (analysis + execution) and Amdahl serial fraction (discovery share at 1 worker).
    const med = (x) => (x && x.median !== undefined ? x.median : null);
    const d1 = med(results[1].stages.discoveryMs); const p1 = med(results[1].stages.parallelizableMs);
    const serialFraction = d1 !== null && p1 !== null ? d1 / (d1 + p1) : null;
    const amdahl = {
        serialFractionAt1w: serialFraction,
        maxEndToEndSpeedup: serialFraction ? 1 / serialFraction : null,
        note: 'serial fraction = discovery / (discovery + analysis + execution) at 1 worker; startup/teardown ignored',
    };
    for (const w of Object.keys(results)) {
        const pw = med(results[w].stages.parallelizableMs);
        const sp = speedup(p1, pw);
        results[w].parallelizableSpeedup = sp; results[w].parallelizableEfficiency = efficiency(sp, Number(w));
        const S = results[w].speedup; const n = Number(w);
        results[w].karpFlattSerialFraction = S && n > 1 ? (1 / S - 1 / n) / (1 - 1 / n) : null;
    }
    const verdict = (ok) => (ok === null ? 'UNKNOWN' : ok ? 'PASS' : 'MISS');
    const thresholds = {
        '2w>=1.5x': results[2] ? verdict(results[2].speedup >= 1.5) : 'UNKNOWN',
        '4w>=2.3x': results[4] ? verdict(results[4].speedup >= 2.3) : 'UNKNOWN',
        '1w regression<=10% vs baseline': o.baseline ? verdict(base <= o.baseline * 1.1) : 'UNKNOWN (no --baseline-1w-ms)'
    };
    const doc = {
        host: { os: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length, node: process.version },
        config: { fixtureServer: 'scripts/fixture/server.js', runs: o.runs, warmup: o.warmup, delayMs: o.delayMs, baseline1wMs: o.baseline },
        results, amdahl, thresholds, semanticEquivalence: equivalent, rawReportsIdentical: rawIdentical,
        volatileFieldsStripped: [...VOLATILE_KEYS].sort()
    };
    process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
    for (const [k, v] of Object.entries(thresholds)) process.stdout.write(`THRESHOLD ${k}: ${v} (informational)\n`);
    if (o.write) {
        fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
        fs.writeFileSync(OUTPUT, `${JSON.stringify(doc, null, 2)}\n`);
        process.stdout.write(`WROTE ${OUTPUT}\n`);
    }
    if (!equivalent) { process.stderr.write('NON-EQUIVALENT reports across worker counts\n'); process.exit(1); }
}

module.exports = { stagesFromLog, median, percentile, summarize, speedup, efficiency, normalize, parseArgs };

if (require.main === module) {
    main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
