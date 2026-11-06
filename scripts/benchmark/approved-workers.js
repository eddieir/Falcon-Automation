#!/usr/bin/env node
"use strict";

/**
 * WP-77Q benchmark: approved-contract journeys, sequential (--workers=1)
 * versus in-process workers, on identical local deterministic fixtures.
 *
 *   node scripts/benchmark/approved-workers.js [--journeys=4] [--repeats=5] [--latency-ms=300] [--out=<file>]
 *
 * Loopback fixture server only, real Chromium, no LLM, no network. Reports
 * what was measured; it does not assert any speedup. Each sample is one full
 * `falcon.js` process (browser launch included), so numbers are end-to-end.
 * Results are written to stdout (and --out if given); nothing is committed.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const R = path.join(__dirname, "..", "..");
const FALCON = path.join(R, "falcon.js");
const Contract = require(path.join(R, "src/core/outcome/Contract"));

const argNum = (name, def) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    const n = a ? Number(a.slice(name.length + 3)) : def;
    return Number.isInteger(n) && n >= 1 ? n : def;
};
const JOURNEYS = argNum("journeys", 4);
const REPEATS = argNum("repeats", 5);
const LATENCY = argNum("latency-ms", 300);
const outArg = process.argv.find((x) => x.startsWith("--out="));
const WORKER_SET = [1, 2, 4].filter((w) => w === 1 || w <= JOURNEYS);

const prov = { source: "spec", ref: "plan:bench" };

function run(args, cwd, onSpawn) {
    return new Promise((resolve) => {
        const t0 = process.hrtime.bigint();
        const child = spawn(process.execPath, [FALCON, ...args], { cwd, env: { ...process.env, CI: "1", FALCON_RUN_HISTORY: "off" } });
        let out = "";
        let peakKb = 0;
        const sampler = setInterval(() => {
            try { peakKb = Math.max(peakKb, Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" }).trim()) || 0); } catch { /* exited */ }
        }, 100);
        child.stdout.on("data", (d) => { out += d; });
        child.stderr.on("data", (d) => { out += d; });
        child.on("close", (code) => {
            clearInterval(sampler);
            resolve({ code, out, ms: Number(process.hrtime.bigint() - t0) / 1e6, peakNodeRssMb: peakKb / 1024 });
        });
    });
}

const stats = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
    return { n: s.length, min: s[0], median: s[Math.floor((s.length - 1) / 2)], max: s[s.length - 1], mean, stddev: sd };
};
const r1 = (n) => Math.round(n * 10) / 10;

async function main() {
    const server = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
            if (req.url.split("?")[0].startsWith("/page/")) {
                setTimeout(() => { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><title>b</title><h1>Panel</h1><button id="ping" type="button">Ping</button>`); }, LATENCY);
                return;
            }
            res.writeHead(404); res.end();
        });
        s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-s2-"));
    const store = path.join(dir, "store");
    const plans = [];
    try {
        for (let i = 1; i <= JOURNEYS; i++) {
            const id = `bench-${String(i).padStart(2, "0")}`;
            const c = {
                schemaVersion: 1, journeyId: id, requirementId: `${id}-REQ`, revision: 1,
                assertions: [
                    { id: `${id}-nav`, required: true, check: "pathEquals", locator: "url:pathname", expected: `/page/${id}`, provenance: prov },
                    { id: `${id}-h1`, required: true, check: "textEquals", locator: "h1", expected: "Panel", provenance: prov },
                ],
            };
            const cFile = path.join(dir, `${id}.contract.json`);
            fs.writeFileSync(cFile, JSON.stringify(c));
            const digest = Contract.parse(JSON.stringify(c)).digest;
            for (const args of [[`--contract-propose=${cFile}`], [`--contract-approve=${cFile}`, `--confirm-digest=${digest}`]]) {
                const r = await run([...args, `--store-root=${store}`], dir);
                if (r.code !== 0) throw new Error("fixture approval failed");
            }
            fs.writeFileSync(path.join(dir, `${id}.plan.json`), JSON.stringify({
                format: "falcon-test-plan", version: 1, url: `${base}/page/${id}`, journey: true,
                scenarios: [{ action: "click", locator: "#ping", description: "Open" }, { action: "verify", description: "Verify" }],
                contract: `${id}.contract.json`, journeyId: id,
            }));
            plans.push(`${id}.plan.json`);
        }

        const results = {};
        let reference = null;
        let equivalent = true;
        // Warm-up (not recorded): first Chromium launch is slower than steady state.
        await run([...plans.map((p) => `--plan=${p}`), "--no-dashboard", `--store-root=${store}`, "--workers=1"], dir);
        // Interleave worker settings across repeats so drift affects all settings alike.
        for (let rep = 0; rep < REPEATS; rep++) {
            for (const w of WORKER_SET) {
                fs.rmSync(path.join(dir, "reports"), { recursive: true, force: true });
                const r = await run([...plans.map((p) => `--plan=${p}`), "--no-dashboard", `--store-root=${store}`, `--workers=${w}`], dir);
                const report = JSON.parse(fs.readFileSync(path.join(dir, "reports", "test-report.json"), "utf8"));
                const fingerprint = JSON.stringify({ code: r.code, result: report.result, v: report.verification });
                if (reference === null) reference = fingerprint;
                if (fingerprint !== reference) equivalent = false;
                (results[w] = results[w] || { ms: [], rss: [], exit: new Set() });
                results[w].ms.push(r.ms); results[w].rss.push(r.peakNodeRssMb); results[w].exit.add(r.code);
            }
        }
        const base1 = stats(results[1].ms).median;
        const summary = {
            fixture: { journeys: JOURNEYS, pageLatencyMs: LATENCY, repeats: REPEATS, assertionsPerJourney: 2 },
            host: { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length },
            resultEquivalence: equivalent ? "identical exit code, result and verification block for every sample and worker count" : "MISMATCH",
            byWorkers: Object.fromEntries(Object.entries(results).map(([w, v]) => {
                const st = stats(v.ms);
                return [w, {
                    durationMs: { min: r1(st.min), median: r1(st.median), max: r1(st.max), mean: r1(st.mean), stddev: r1(st.stddev) },
                    medianVsSequential: r1(st.median / base1),
                    peakNodeRssMb: r1(Math.max(...v.rss)),
                    exitCodes: [...v.exit],
                }];
            })),
            limitations: [
                "Samples are whole falcon.js processes (Chromium launch included); small repeat counts give wide variance.",
                "peakNodeRssMb is the falcon.js node process only (ps sampling every 100 ms); Chromium child processes are not included.",
                "The fixture has an artificial per-page latency; real sites differ. No speedup target is asserted.",
                "Single machine, single run of this script; not a statistical claim.",
            ],
        };
        const text = JSON.stringify(summary, null, 2);
        console.log(text);
        if (outArg) fs.writeFileSync(outArg.slice("--out=".length), text + "\n");
        if (!equivalent) process.exitCode = 1;
    } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().catch((e) => { console.error(`benchmark failed: ${e && e.message}`); process.exit(1); });
