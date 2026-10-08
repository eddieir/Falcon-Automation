'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { start, parseDelay } = require('../../scripts/fixture/server.js');
const bench = require('../../scripts/benchmark/parallel.js');

function get(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            const c = []; res.on('data', (d) => c.push(d));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
        }).on('error', reject);
    });
}

test('serves index and 10 pages deterministically on loopback', async () => {
    const s = await start({ port: 0 });
    try {
        const addr = s.address();
        assert.strictEqual(addr.address, '127.0.0.1');
        const base = `http://127.0.0.1:${addr.port}`;
        const idx = await get(`${base}/`);
        const html = idx.body.toString();
        for (let i = 1; i <= 10; i++) {
            assert.ok(html.includes(`href="/p/${i}"`), `index links /p/${i}`);
            const a = await get(`${base}/p/${i}`); const b = await get(`${base}/p/${i}`);
            assert.strictEqual(a.status, 200);
            assert.ok(a.body.equals(b.body), `page ${i} deterministic`);
            assert.ok(a.body.toString().includes(`id="toggle-${i}"`));
        }
        assert.ok((await get(`${base}/`)).body.equals(idx.body));
        assert.strictEqual((await get(`${base}/health`)).status, 200);
        assert.strictEqual((await get(`${base}/p/11`)).status, 404);
        assert.strictEqual((await get(`${base}/p/01`)).status, 404);
        assert.strictEqual((await get(`${base}/api/ping`)).status, 200);
    } finally { s.close(); s.closeAllConnections(); }
});

test('delay validation rejects bad values', () => {
    for (const bad of ['-1', 'abc', 'NaN', '5001', '1.5']) assert.throws(() => parseDelay(bad), undefined, bad);
    assert.strictEqual(parseDelay(undefined), 0);
    assert.strictEqual(parseDelay('5000'), 5000);
});

test('delay is applied to pages and ping but not health', async () => {
    const s = await start({ port: 0, delayMs: 150 });
    try {
        const base = `http://127.0.0.1:${s.address().port}`;
        for (const p of ['/p/1', '/api/ping']) {
            const t = Date.now(); await get(base + p);
            assert.ok(Date.now() - t >= 140, `${p} delayed`);
        }
    } finally { s.close(); s.closeAllConnections(); }
});

test('CLI prints FIXTURE_URL, rejects bad delay, stops on SIGTERM', async () => {
    const script = path.join(__dirname, '..', '..', 'scripts', 'fixture', 'server.js');
    const bad = spawn(process.execPath, [script, '--delay-ms=6000'], { stdio: 'ignore' });
    assert.strictEqual(await new Promise((r) => bad.once('exit', r)), 2);

    const p = spawn(process.execPath, [script, '--port=0'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const line = await new Promise((resolve) => { let b = ''; p.stdout.on('data', (d) => { b += d; if (b.includes('\n')) resolve(b); }); });
    assert.match(line, /^FIXTURE_URL=http:\/\/127\.0\.0\.1:\d+\n$/);
    const exit = new Promise((r) => p.once('exit', (c, sig) => r({ c, sig })));
    p.kill('SIGTERM');
    const r = await exit;
    assert.strictEqual(r.c, 0);
});

test('benchmark stats helpers', () => {
    assert.strictEqual(bench.median([3, 1, 2]), 2);
    assert.strictEqual(bench.median([4, 1, 2, 3]), 2.5);
    assert.strictEqual(bench.median([]), null);
    const s = bench.summarize([5, 1, 3]);
    assert.deepStrictEqual([s.min, s.max, s.median, s.p95], [1, 5, 3, null]);
    assert.match(s.note, /range only/);
    assert.strictEqual(bench.summarize(Array.from({ length: 20 }, (_, i) => i + 1)).p95, 19);
    assert.strictEqual(bench.speedup(100, 50), 2);
    assert.strictEqual(bench.efficiency(2, 4), 0.5);
    assert.strictEqual(bench.speedup(100, 0), null);
    assert.deepStrictEqual(bench.normalize({ b: 1, duration: 9, a: [{ timestamp: 1, x: 2 }] }), { a: [{ x: 2 }], b: 1 });
    assert.throws(() => bench.parseArgs(['--runs=0']));
    assert.throws(() => bench.parseArgs(['--bogus']));
});
