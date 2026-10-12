"use strict";
/**
 * P16 end to end: real shard bundles (ParallelSweep + ShardBundle.write) against a local
 * http fixture, merged with ShardMerge in temp dirs. Canonical repo state is never touched.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const R = path.join(__dirname, "..", "..");
const ParallelSweep = require(path.join(R, "src/core/parallel/ParallelSweep"));
const ParallelMode = require(path.join(R, "src/core/parallel/ParallelMode"));
const ShardMerge = require(path.join(R, "src/core/parallel/ShardMerge"));

process.env.FALCON_RUN_HISTORY = "off";
process.env.FALCON_LOCATOR_SALT = process.env.FALCON_LOCATOR_SALT || "e2e-salt";
delete process.env.OPENAI_API_KEY;

const PAGES = ["/", "/a", "/b", "/c", "/d", "/e", "/broken"];
const page = (p) => `<!doctype html><html><head><title>${p}</title></head><body><h1>Page ${p}</h1>` +
    PAGES.map((q) => `<a href="${q}">link ${q}</a>`).join(" ") +
    `<button id="b${p.replace("/", "x")}">Press ${p}</button></body></html>`;

function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url === "/broken") { res.writeHead(500, { "content-type": "text/html" }); res.end("boom"); return; }
            if (!PAGES.includes(req.url)) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { "content-type": "text/html" });
            res.end(page(req.url));
        });
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p16e2e-"));
const VOLATILE = new Set(["duration", "durationMs", "timestamp", "generatedAt", "startedAt", "endedAt", "date", "wallMs"]);
const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
        const o = {};
        for (const k of Object.keys(v).sort()) if (!VOLATILE.has(k)) o[k] = strip(v[k]);
        return o;
    }
    return v;
};
const paths = (root) => ({ dataDir: path.join(root, "data"), reportsDir: path.join(root, "reports") });

async function bundles(browser, url, runId, total, root) {
    ParallelMode.setActive(true);
    try {
        for (let i = 1; i <= total; i++) {
            const context = await browser.newContext();
            try {
                await ParallelSweep.run({
                    context, browser, entryUrl: url, runId, commit: "unknown", shard: { index: i, total },
                    workers: 2, maxPages: 20, bundleDir: path.join(root, `shard-${i}-of-${total}`), pageTimeoutMs: 15000,
                });
            } finally { await context.close(); }
        }
    } finally { ParallelMode.setActive(false); }
}

const readReport = (p) => JSON.parse(fs.readFileSync(path.join(p.reportsDir, "test-report.json"), "utf8"));

test("p16 e2e: N=1 and N=3 merge to the same semantic report; shuffle, missing shard, crash-rerun", { timeout: 240000 }, async () => {
    const server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({ headless: true });
    try {
        // N=1 (sequential equivalent)
        const r1 = tmp(); const in1 = path.join(r1, "in"); const p1 = paths(r1);
        await bundles(browser, url, "e2e-run-one", 1, in1);
        const m1 = await ShardMerge.merge({ inputDir: in1, expectTotal: 1, paths: p1, env: process.env });
        assert.ok(m1.code === 0 || m1.code === 1, `N=1 merge code ${m1.code}`);
        const rep1 = readReport(p1);
        assert.ok(rep1.tests.length > 0);
        assert.ok(rep1.pages.length >= 6, "fixture has at least 6 pages");
        const broken = rep1.pages.find((p) => p.url.endsWith("/broken"));
        assert.ok(broken && broken.status === "failed", "the 500 route is reported as failed");
        assert.strictEqual(m1.code, 1, "a failing page makes the run not PASSED");

        // N=3
        const r3 = tmp(); const in3 = path.join(r3, "in"); const p3 = paths(r3);
        await bundles(browser, url, "e2e-run-one", 3, in3);
        const m3 = await ShardMerge.merge({ inputDir: in3, expectTotal: 3, paths: p3, env: process.env });
        assert.strictEqual(m3.code, m1.code);
        const rep3 = readReport(p3);
        const semantic = (r) => strip({ tests: r.tests.map((t) => ({ ...t, url: undefined })), pages: r.pages, coverage: r.coverage, result: r.result, uiIssues: r.uiIssues });
        const urlless = (s) => JSON.stringify(s).split(url).join("<origin>/");
        assert.strictEqual(urlless(semantic(rep3)), urlless(semantic(rep1)), "N=3 equals the sequential-equivalent N=1");

        // shuffled shard order: byte-identical report
        // the first merge consumed its bundle files, so build a fresh set and merge it in two shard orders
        const r3c = tmp(); const in3c = path.join(r3c, "in"); const p3c = paths(r3c);
        await bundles(browser, url, "e2e-run-one", 3, in3c);
        const r3d = tmp(); const in3d = path.join(r3d, "in"); const p3d = paths(r3d);
        fs.mkdirSync(in3d, { recursive: true });
        for (const n of ["shard-3-of-3", "shard-1-of-3", "shard-2-of-3"]) fs.cpSync(path.join(in3c, n), path.join(in3d, n), { recursive: true });
        await ShardMerge.merge({ inputDir: in3c, expectTotal: 3, paths: p3c, env: process.env });
        await ShardMerge.merge({ inputDir: in3d, expectTotal: 3, paths: p3d, env: process.env });
        const bc = fs.readFileSync(path.join(p3c.reportsDir, "test-report.json"), "utf8");
        const bd = fs.readFileSync(path.join(p3d.reportsDir, "test-report.json"), "utf8");
        assert.strictEqual(bc, bd, "report bytes do not depend on shard directory order or location");

        // deleting one shard bundle: code 2, no report, canonical untouched
        const r4 = tmp(); const in4 = path.join(r4, "in"); const p4 = paths(r4);
        await bundles(browser, url, "e2e-run-two", 3, in4);
        fs.rmSync(path.join(in4, "shard-2-of-3"), { recursive: true, force: true });
        const m4 = await ShardMerge.merge({ inputDir: in4, expectTotal: 3, paths: p4, env: process.env });
        assert.strictEqual(m4.code, 2);
        assert.strictEqual(m4.reportPath, null);
        assert.ok(!fs.existsSync(path.join(p4.reportsDir, "test-report.json")));
        assert.ok(!fs.existsSync(p4.dataDir), "canonical data dir untouched");

        // tampered fragment bytes: sha is over raw file bytes, mismatch -> code 2
        const r5 = tmp(); const in5 = path.join(r5, "in"); const p5 = paths(r5);
        await bundles(browser, url, "e2e-run-three", 3, in5);
        const frag = path.join(in5, "shard-1-of-3", "fragments", fs.readdirSync(path.join(in5, "shard-1-of-3", "fragments"))[0]);
        fs.writeFileSync(frag, fs.readFileSync(frag, "utf8").replace(/"status":"/, '"status": "'));
        const m5 = await ShardMerge.merge({ inputDir: in5, expectTotal: 3, paths: p5, env: process.env });
        assert.strictEqual(m5.code, 2);
        assert.ok(!fs.existsSync(path.join(p5.reportsDir, "test-report.json")));

        // plan digest mismatch against analysis.json -> code 2
        const r6 = tmp(); const in6 = path.join(r6, "in"); const p6 = paths(r6);
        await bundles(browser, url, "e2e-run-four", 1, in6);
        const af = path.join(in6, "shard-1-of-1", "analysis.json");
        const an = JSON.parse(fs.readFileSync(af, "utf8"));
        an.pages[0].signatures = [...an.pages[0].signatures, "forged-signature"];
        fs.writeFileSync(af, JSON.stringify(an));
        const m6 = await ShardMerge.merge({ inputDir: in6, expectTotal: 1, paths: p6, env: process.env });
        assert.strictEqual(m6.code, 2);
        assert.strictEqual(m6.diagnostics[0].code, "PLAN_DIGEST_MISMATCH");

        // crash during merge after a partial apply, then rerun: identical report bytes and conflicts
        const r7 = tmp(); const in7 = path.join(r7, "in"); const p7 = paths(r7);
        await bundles(browser, url, "e2e-run-five", 3, in7);
        const r8 = tmp(); const in8 = path.join(r8, "in"); const p8 = paths(r8);
        fs.cpSync(in7, in8, { recursive: true });
        await ShardMerge.merge({ inputDir: in8, expectTotal: 3, paths: p8, env: process.env });
        const clean = fs.readFileSync(path.join(p8.reportsDir, "test-report.json"), "utf8");
        await assert.rejects(ShardMerge.merge({
            inputDir: in7, expectTotal: 3, paths: p7, env: process.env,
            beforeStep: async (n) => { if (n === "locator_store") throw new Error("simulated crash"); },
        }), /simulated crash/);
        assert.ok(!fs.existsSync(path.join(p7.reportsDir, "test-report.json")));
        const again = await ShardMerge.merge({ inputDir: in7, expectTotal: 3, paths: p7, env: process.env });
        assert.strictEqual(again.code, m1.code);
        assert.strictEqual(fs.readFileSync(path.join(p7.reportsDir, "test-report.json"), "utf8"), clean,
            "a rerun after a partial apply yields identical report bytes");
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
    }
});
