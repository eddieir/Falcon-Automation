"use strict";
/**
 * P16 Runner: the real workers>1 / shard / merge entry paths, in-process (Runner.run, runMerge)
 * and through node falcon.js, against the local fixture on port 0. Repo data/ and reports/ are
 * never touched: children run with cwd = a temp dir and the parallelPaths test seam.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const R = path.join(__dirname, "..", "..");
const FALCON = path.join(R, "falcon.js");
const Runner = require(path.join(R, "src/core/parallel/Runner"));
const Fixture = require(path.join(R, "scripts/fixture/server.js"));

process.env.FALCON_RUN_HISTORY = "off";
process.env.FALCON_LOCATOR_SALT = "fixed";
delete process.env.OPENAI_API_KEY;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p16run-"));
const close = (s) => new Promise((r) => s.close(r));
const SHA = "a".repeat(40);

function failingServer() {
    return new Promise((resolve) => {
        const s = http.createServer((req, res) => {
            if (req.url === "/broken") { res.writeHead(500, { "content-type": "text/html" }); res.end("boom"); return; }
            if (req.url !== "/") { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { "content-type": "text/html" });
            res.end("<!doctype html><title>t</title><h1>Home</h1><a href='/broken'>broken</a><button id='b'>Press</button>");
        });
        s.listen(0, "127.0.0.1", () => resolve(s));
    });
}
const base = (s) => `http://127.0.0.1:${s.address().port}/`;

function setup(root) {
    const dataDir = path.join(root, "data");
    const reportsDir = path.join(root, "reports");
    const preload = path.join(root, "preload.cjs");
    fs.writeFileSync(preload, "globalThis.__FALCON_TEST_SEAMS__ = { parallelPaths: true };\n");
    return { dataDir, reportsDir, preload, paths: JSON.stringify({ dataDir, reportsDir }) };
}

function falcon(root, args, extra = {}) {
    const s = setup(root);
    return new Promise((resolve) => {
        const c = spawn(process.execPath, ["--require", s.preload, FALCON, ...(args[0] === "merge" ? [] : ["--no-dashboard"]), ...args], {
            cwd: root, encoding: "utf8",
            env: { ...process.env, CI: "true", FALCON_RUN_HISTORY: "off", HEADLESS: "true", FALCON_LOCATOR_SALT: "fixed",
                FALCON_TEST_PARALLEL_PATHS: s.paths, ...extra },
        });
        let out = "";
        c.stdout.on("data", (d) => { out += d; });
        c.stderr.on("data", (d) => { out += d; });
        const t = setTimeout(() => c.kill("SIGKILL"), 120000);
        c.on("close", (status) => { clearTimeout(t); resolve({ status, out, ...s }); });
    });
}
const report = (s) => JSON.parse(fs.readFileSync(path.join(s.reportsDir, "test-report.json"), "utf8"));
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);

test("falcon --workers=2 end to end on the fixture: exit 0, one report, history and dashboard off", { timeout: 180000 }, async () => {
    const server = await Fixture.start({ port: 0 });
    try {
        const root = tmp();
        const r = await falcon(root, [`--url=${base(server)}`, "--workers=2", "--max-pages=4"]);
        assert.strictEqual(r.status, 0, r.out);
        assert.deepStrictEqual(ls(r.reportsDir).filter((f) => f === "test-report.json"), ["test-report.json"]);
        assert.ok(report(r).pages.length >= 3);
        assert.ok(!fs.existsSync(path.join(r.dataDir, "run_history.json")), "run history is disabled");
        assert.ok(!/Dashboard|localhost:3000/.test(r.out), "dashboard stays off");
        assert.ok(!/merge: .*code [12]/.test(r.out));
        // the single bundle was consumed by the in-process merge
        const shardsRoot = path.join(r.reportsDir, "shards");
        assert.ok(ls(shardsRoot).length <= 1, "only the one run's bundle root exists");
    } finally { await close(server); }
});

test("falcon --workers=2 with a failing page route exits 1 and the report lists the failed row", { timeout: 180000 }, async () => {
    const server = await failingServer();
    try {
        const r = await falcon(tmp(), [`--url=${base(server)}`, "--workers=2", "--max-pages=4"]);
        assert.strictEqual(r.status, 1, r.out);
        const rep = report(r);
        const broken = rep.pages.find((p) => p.url.endsWith("/broken"));
        assert.ok(broken && broken.status === "failed", JSON.stringify(rep.pages.map((p) => [p.url, p.status])));
    } finally { await close(server); }
});

test("falcon --shard 1/2 and 2/2 then merge with expectations; wrong run id is rejected with no report", { timeout: 240000 }, async () => {
    const server = await Fixture.start({ port: 0 });
    try {
        const root = tmp();
        const runId = "shard-run-001";
        for (const i of [1, 2]) {
            const r = await falcon(root, [`--url=${base(server)}`, `--shard=${i}/2`, `--run-id=${runId}`, "--max-pages=4"]);
            assert.ok(r.status === 0 || r.status === 1, `shard ${i}: ${r.status}\n${r.out}`);
            assert.ok(/bundle written to/.test(r.out));
            assert.ok(!fs.existsSync(path.join(r.reportsDir, "test-report.json")), "a shard never writes the merged report");
        }
        const input = path.join(root, "reports", "shards", runId);
        assert.deepStrictEqual(ls(input).sort(), ["shard-1-of-2", "shard-2-of-2"]);

        const bad = await falcon(root, ["merge", `--input=${input}`, "--expect-total=2", "--expect-run-id=other-run-999"]);
        assert.strictEqual(bad.status, 2, bad.out);
        assert.ok(!fs.existsSync(path.join(bad.reportsDir, "test-report.json")), "no report on rejection");

        const ok = await falcon(root, ["merge", `--input=${input}`, "--expect-total=2", `--expect-run-id=${runId}`]);
        assert.ok(ok.status === 0 || ok.status === 1, ok.out);
        assert.ok(/merge: report/.test(ok.out));
        assert.strictEqual(report(ok).pages.length > 0, true);
    } finally { await close(server); }
});

test("merge --expect-commit mismatch exits 2 and merge on an empty dir exits 2 with a clear message", { timeout: 120000 }, async () => {
    const root = tmp();
    const empty = path.join(root, "empty");
    fs.mkdirSync(empty);
    const r = await falcon(root, ["merge", `--input=${empty}`, "--expect-total=2"]);
    assert.strictEqual(r.status, 2, r.out);
    assert.ok(/merge: [A-Z_]+ /.test(r.out), `diagnostic line expected:\n${r.out}`);
    assert.ok(!fs.existsSync(path.join(r.reportsDir, "test-report.json")));
    const c = await falcon(root, ["merge", `--input=${empty}`, "--expect-total=1", `--expect-commit=${SHA}`]);
    assert.strictEqual(c.status, 2, c.out);
});

test("shard crash path: unreachable base URL leaves no bundle claiming completion", { timeout: 120000 }, async () => {
    const root = tmp();
    const r = await falcon(root, ["--url=http://127.0.0.1:1/", "--shard=1/2", "--run-id=crash-run-01", "--max-pages=2"]);
    assert.notStrictEqual(r.status, 0, r.out);
    const merged = await falcon(root, ["merge", `--input=${path.join(r.reportsDir, "shards", "crash-run-01")}`, "--expect-total=2"]);
    assert.strictEqual(merged.status, 2, `a lone/failed shard must not merge as complete\n${merged.out}`);
    assert.ok(!fs.existsSync(path.join(r.reportsDir, "test-report.json")));
});

test("in-process Runner.run: workers mode and shard mode with real chromium, emits and exit codes", { timeout: 240000 }, async () => {
    const server = await Fixture.start({ port: 0 });
    const root = tmp();
    const s = setup(root);
    const prevCwd = process.cwd();
    const prevSeam = globalThis.__FALCON_TEST_SEAMS__;
    const prevEnv = process.env.FALCON_TEST_PARALLEL_PATHS;
    globalThis.__FALCON_TEST_SEAMS__ = { parallelPaths: true };
    process.env.FALCON_TEST_PARALLEL_PATHS = s.paths;
    process.chdir(root);
    const browser = await chromium.launch({ headless: true });
    try {
        const events = [];
        const emit = (n, p) => events.push([n, p]);
        const sweepOpts = { maxPages: 3, pageTimeoutMs: 15000 };
        const common = { browser, url: base(server), sweepOpts, emit, repoRoot: root, commit: SHA, startedAt: Date.now() };

        const shardCode = await Runner.run({ ...common, parsed: { workers: 1, shard: { index: 1, total: 1 }, runId: "inproc-shard-1" } });
        assert.ok(shardCode === 0 || shardCode === 1);
        const names = events.map((e) => e[0]);
        assert.deepStrictEqual(names, ["workerState", "runPlan", "workerState"]);
        assert.strictEqual(events[1][1].mode, "shard");
        assert.ok(fs.existsSync(path.join(fs.realpathSync(root), "reports", "shards", "inproc-shard-1", "shard-1-of-1", Runner.TIMINGS_FILE)));
        assert.ok(!fs.existsSync(path.join(s.reportsDir, "test-report.json")));

        events.length = 0;
        const code = await Runner.run({ ...common, parsed: { workers: 2, shard: null, runId: null } });
        assert.strictEqual(code, 0);
        assert.strictEqual(events[1][1].mode, "workers");
        assert.strictEqual(events[2][1].active, 0);
        const rep = JSON.parse(fs.readFileSync(path.join(s.reportsDir, "test-report.json"), "utf8"));
        assert.ok(rep.execution && rep.execution.timings && typeof rep.execution.timings.mergeMs === "number", "mergeMs recorded");
    } finally {
        await browser.close();
        process.chdir(prevCwd);
        globalThis.__FALCON_TEST_SEAMS__ = prevSeam;
        if (prevEnv === undefined) delete process.env.FALCON_TEST_PARALLEL_PATHS; else process.env.FALCON_TEST_PARALLEL_PATHS = prevEnv;
        await close(server);
    }
});

test("runMerge returns 3 on an unexpected failure and logs no raw error text; addMergeMs warns on junk", async () => {
    const root = tmp();
    const out = await Runner.runMerge({ merge: { input: path.join(root, "x"), expectTotal: 1 }, paths: { dataDir: null, reportsDir: null } });
    assert.strictEqual(out, 2, "missing input dir is a rejected input");
    assert.strictEqual(await Runner.runMerge({ merge: null, paths: {} }), 3, "an unexpected throw maps to exit 3");
    // unreadable report: best effort only, must not throw
    await Runner.addMergeMs(path.join(root, "missing.json"), 5);
    const bad = path.join(root, "bad.json");
    fs.writeFileSync(bad, "{not json");
    await Runner.addMergeMs(bad, 5);
    assert.strictEqual(fs.readFileSync(bad, "utf8"), "{not json");
    const noTimings = path.join(root, "nt.json");
    fs.writeFileSync(noTimings, JSON.stringify({ execution: {} }));
    await Runner.addMergeMs(noTimings, 5);
    assert.strictEqual(JSON.parse(fs.readFileSync(noTimings, "utf8")).execution.timings, undefined);
});

test("defaultPaths: seam ignored without the preload flag or on malformed JSON", () => {
    const prev = globalThis.__FALCON_TEST_SEAMS__;
    try {
        globalThis.__FALCON_TEST_SEAMS__ = undefined;
        const d = Runner.defaultPaths("/repo", { FALCON_TEST_PARALLEL_PATHS: JSON.stringify({ dataDir: "/x", reportsDir: "/y" }) });
        assert.strictEqual(d.dataDir, path.join("/repo", "data"));
        assert.strictEqual(d.reportsDir, path.join(process.cwd(), "reports"));
        globalThis.__FALCON_TEST_SEAMS__ = { parallelPaths: true };
        assert.strictEqual(Runner.defaultPaths("/repo", { FALCON_TEST_PARALLEL_PATHS: "{bad" }).dataDir, path.join("/repo", "data"));
        assert.strictEqual(Runner.defaultPaths("/repo", { FALCON_TEST_PARALLEL_PATHS: JSON.stringify({ dataDir: "/x", reportsDir: "/y" }) }).dataDir, "/x");
    } finally { globalThis.__FALCON_TEST_SEAMS__ = prev; }
});
