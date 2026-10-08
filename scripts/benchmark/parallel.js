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
    'workerId', 'executionMode', 'screenshot', 'screenshotPath', 'path', 'time', 'date']);

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
    fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
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
            resolve({ code, ms: Number(process.hrtime.bigint() - t0) / 1e6, peakRssKb: peak, output: out, reports: readReports(dir) });
        });
    });
}

const UNSUPPORTED = /unknown (option|argument|flag)|unrecognized|unsupported|invalid (option|argument)/i;

async function main() {
    const o = parseArgs(process.argv.slice(2));
    const dir = prepareWorkdir();
    const fixture = await startFixture(o.delayMs);
    const results = {}; let reference = null; let equivalent = true; let blocked = null;
    try {
        for (const w of o.workers) {
            const times = []; const rss = [];
            for (let i = 0; i < o.warmup + o.runs; i++) {
                const r = await runOnce(dir, fixture.url, w, o.timeoutMs);
                if (r.code !== 0 && UNSUPPORTED.test(r.output)) { blocked = `falcon.js rejected --workers=${w}`; break; }
                if (i < o.warmup) continue;
                times.push(r.ms); if (r.peakRssKb !== null) rss.push(r.peakRssKb);
                const key = JSON.stringify({ code: r.code, reports: r.reports });
                if (reference === null) reference = key; else if (key !== reference) equivalent = false;
            }
            if (blocked) break;
            results[w] = { wallMs: summarize(times), peakRssKb: rss.length ? Math.max(...rss) : 'UNKNOWN' };
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
    const verdict = (ok) => (ok === null ? 'UNKNOWN' : ok ? 'PASS' : 'MISS');
    const thresholds = {
        '2w>=1.5x': results[2] ? verdict(results[2].speedup >= 1.5) : 'UNKNOWN',
        '4w>=2.3x': results[4] ? verdict(results[4].speedup >= 2.3) : 'UNKNOWN',
        '1w regression<=10% vs baseline': o.baseline ? verdict(base <= o.baseline * 1.1) : 'UNKNOWN (no --baseline-1w-ms)'
    };
    const doc = {
        host: { os: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length, node: process.version },
        config: { runs: o.runs, warmup: o.warmup, delayMs: o.delayMs, baseline1wMs: o.baseline },
        results, thresholds, semanticEquivalence: equivalent,
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

module.exports = { median, percentile, summarize, speedup, efficiency, normalize, parseArgs };

if (require.main === module) {
    main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
