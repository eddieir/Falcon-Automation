"use strict";
/** P16 stage timings: execution.timings is VOLATILE, parallel-only, additive; sequential reports are unchanged. */
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
const Runner = require(path.join(R, "src/core/parallel/Runner"));
const ReportManager = require(path.join(R, "src/core/ReportManager"));

process.env.FALCON_RUN_HISTORY = "off";
process.env.FALCON_LOCATOR_SALT = process.env.FALCON_LOCATOR_SALT || "timings-salt";
delete process.env.OPENAI_API_KEY;

const PAGES = ["/", "/a", "/b"];
const html = (p) => `<!doctype html><html><head><title>${p}</title></head><body><h1>${p}</h1>` +
    PAGES.map((q) => `<a href="${q}">l${q}</a>`).join(" ") + `<button id="b${p.replace("/", "x")}">Press</button></body></html>`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p16tim-"));
const paths = (r) => ({ dataDir: path.join(r, "data"), reportsDir: path.join(r, "reports") });
const VOLATILE = new Set(["duration", "durationMs", "timestamp", "generatedAt", "startedAt", "endedAt", "wallMs", "execution"]);
const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) if (!VOLATILE.has(k)) o[k] = strip(v[k]); return o; }
    return v;
};
const readReport = (p) => JSON.parse(fs.readFileSync(path.join(p.reportsDir, "test-report.json"), "utf8"));
const num = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;

test("sequential buildReport has no execution block; parallel passthrough is additive", () => {
    const seq = ReportManager.buildReport({ tests: [], runId: "r", duration: "1s" });
    assert.ok(!("execution" in seq));
    const par = ReportManager.buildReport({ tests: [], runId: "r", duration: "1s", timings: { discoveryMs: 1 } });
    assert.deepStrictEqual(par.execution, { timings: { discoveryMs: 1 } });
    assert.deepStrictEqual(strip(par), strip(seq));
});

test("parallel sweep records numeric stage timings; merge carries them; volatile stripping keeps comparison stable", { timeout: 120000 }, async () => {
    const server = http.createServer((req, res) => {
        if (!PAGES.includes(req.url)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "content-type": "text/html" }); res.end(html(req.url));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch({ headless: true });
    try {
        const run = async (root, withSidecar) => {
            const bundle = path.join(root, "in", "shard-1-of-1");
            ParallelMode.setActive(true);
            let result;
            try {
                const context = await browser.newContext();
                try {
                    result = await ParallelSweep.run({ context, browser, entryUrl: url, runId: "timings-run", commit: "unknown", shard: { index: 1, total: 1 }, workers: 2, bundleDir: bundle, pageTimeoutMs: 15000 });
                } finally { await context.close(); }
            } finally { ParallelMode.setActive(false); }
            if (withSidecar) fs.writeFileSync(path.join(bundle, Runner.TIMINGS_FILE), JSON.stringify(result.timings));
            return result;
        };
        const a = tmp(); const pa = paths(a);
        const ra = await run(a, true);
        for (const k of ["discoveryMs", "analysisMs", "executionMs"]) assert.ok(num(ra.timings[k]), `sweep ${k}`);
        // manifest schema untouched
        const manifest = JSON.parse(fs.readFileSync(path.join(a, "in", "shard-1-of-1", "manifest.json"), "utf8"));
        assert.deepStrictEqual(Object.keys(manifest.timing).sort(), ["endedAt", "startedAt", "wallMs"]);
        const mp = { ...pa };
        const code = (await Runner.runMerge({ merge: { input: path.join(a, "in"), expectTotal: 1 }, paths: mp }));
        assert.ok(code === 0 || code === 1);
        const repA = readReport(pa);
        const t = repA.execution.timings;
        for (const k of ["discoveryMs", "analysisMs", "executionMs", "mergeMs"]) assert.ok(num(t[k]), `report ${k}`);

        // same bundle without sidecar: no execution block, same stripped report
        const b = tmp(); const pb = paths(b);
        await run(b, false);
        const mb = await ShardMerge.merge({ inputDir: path.join(b, "in"), expectTotal: 1, paths: pb, env: process.env });
        assert.ok(mb.code === 0 || mb.code === 1);
        const repB = readReport(pb);
        assert.ok(!("execution" in repB));
        assert.deepStrictEqual(strip(repA), strip(repB));

        // corrupt sidecar is ignored, not fatal
        const c = tmp(); const pc = paths(c);
        await run(c, false);
        fs.writeFileSync(path.join(c, "in", "shard-1-of-1", Runner.TIMINGS_FILE), JSON.stringify({ discoveryMs: "x", analysisMs: -1, executionMs: 1 }));
        const mc = await ShardMerge.merge({ inputDir: path.join(c, "in"), expectTotal: 1, paths: pc, env: process.env });
        assert.ok(mc.code === 0 || mc.code === 1);
        assert.ok(!("execution" in readReport(pc)));
    } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
