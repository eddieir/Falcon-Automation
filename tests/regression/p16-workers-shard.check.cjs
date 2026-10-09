"use strict";
/**
 * P16 --workers combined with --shard: each shard runs its own pages with N lanes. The bundle,
 * the page ownership and the merged result must not depend on the lane count. Runs through node falcon.js against the local fixture. Repo data/ and reports/ are
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
const Fixture = require(path.join(R, "scripts/fixture/server.js"));

process.env.FALCON_RUN_HISTORY = "off";
process.env.FALCON_LOCATOR_SALT = "fixed";
delete process.env.OPENAI_API_KEY;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p16run-"));
const close = (s) => new Promise((r) => s.close(r));

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


const manifest = (root, runId, i) => JSON.parse(fs.readFileSync(path.join(root, "reports", "shards", runId, `shard-${i}-of-2`, "manifest.json"), "utf8"));
const owned = (m) => m.pages.filter((p) => p.assigned).map((p) => p.url).sort();
const rows = (m) => m.pages.map((p) => `${p.ordinal} ${p.url} ${p.assigned} ${p.disposition}`);

async function shardRun(server, workers) {
    const root = tmp();
    const runId = `lanes-run-${workers}`;
    const out = [];
    for (const i of [1, 2]) {
        const r = await falcon(root, [`--url=${base(server)}`, `--shard=${i}/2`, `--run-id=${runId}`, `--workers=${workers}`, "--max-pages=6"]);
        assert.ok(r.status === 0 || r.status === 1, `workers=${workers} shard ${i}: ${r.status}\n${r.out}`);
        assert.ok(/bundle written to/.test(r.out), r.out);
        assert.ok(!fs.existsSync(path.join(r.reportsDir, "test-report.json")), "a shard never writes the merged report");
        out.push(manifest(root, runId, i));
    }
    const merged = await falcon(root, ["merge", `--input=${path.join(root, "reports", "shards", runId)}`, "--expect-total=2", `--expect-run-id=${runId}`]);
    assert.ok(merged.status === 0 || merged.status === 1, merged.out);
    return { manifests: out, report: report(merged), mergeOut: merged.out };
}

test("--shard with --workers: the bundle, page ownership and merged result do not depend on the lane count", { timeout: 360000 }, async () => {
    const server = await Fixture.start({ port: 0 });
    try {
        const one = await shardRun(server, 1);
        const three = await shardRun(server, 3);
        for (let i = 0; i < 2; i++) {
            assert.deepStrictEqual(rows(three.manifests[i]), rows(one.manifests[i]), `shard ${i + 1} manifest pages`);
            assert.deepStrictEqual(owned(three.manifests[i]), owned(one.manifests[i]));
            assert.strictEqual(three.manifests[i].shard.index, i + 1);
        }
        const all = [...owned(three.manifests[0]), ...owned(three.manifests[1])];
        assert.strictEqual(new Set(all).size, all.length, "every page is owned by exactly one shard");
        assert.ok(all.length >= 4, "pages were assigned");
        const names = (r) => r.pages.map((p) => `${p.url}`).sort();
        assert.deepStrictEqual(names(three.report), names(one.report));
    } finally { await close(server); }
});

test("--shard with --workers is accepted, and --run-id without --shard is rejected", { timeout: 240000 }, async () => {
    const server = await Fixture.start({ port: 0 });
    try {
        const root = tmp();
        const r = await falcon(root, [`--url=${base(server)}`, "--shard=1/2", "--run-id=lanes-plan", "--workers=2", "--max-pages=4"]);
        assert.ok(r.status === 0 || r.status === 1, r.out);
        const bad = await falcon(root, [`--url=${base(server)}`, "--workers=2", "--run-id=x"]);
        assert.strictEqual(bad.status, 1, "--run-id without --shard is rejected");
    } finally { await close(server); }
});
