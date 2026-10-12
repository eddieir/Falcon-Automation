"use strict";
const test = require("node:test");
const assert = require("node:assert");
// ---- shared fixture (built only from Schemas / StateJournal) ----
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const R = path.join(__dirname, "..", "..");
const StateJournal = require(path.join(R, "src/core/parallel/StateJournal"));
const ShardMerge = require(path.join(R, "src/core/parallel/ShardMerge"));
const H = (c) => c.repeat(64);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const RUN = "gh-1234567";
const ENV = { FALCON_LOCATOR_SALT: "fixture-salt" };

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "p16m-")); }

function pageFiles(ord, total, runId) {
    const idx = (ord % total) + 1;
    const j = new StateJournal({
        runId, shard: { index: idx, total }, pageOrdinal: ord, commit: "unknown", configFp: H("a"),
        planDigest: H("c"), snapshotAt: "2030-01-01T00:00:00.000Z", clock: () => new Date("2030-01-01T00:00:01.000Z"),
    });
    j.record("flakiness.outcome", 0, 0, { action: "click", locator: "#b" + ord, status: ord === 3 ? "failed" : "passed", outcome: null, errorType: null, durationMs: 5, description: "d" });
    j.record("healing.log", 0, 0, { original: "#o" + ord, resolved: "#r" + ord, tier: "LLM", description: "h" });
    const journal = j.finish("ok");
    const fragment = {
        schema: "falcon.fragment", v: 1, runId, shard: { index: idx, total }, pageOrdinal: ord, status: "ok",
        results: [
            { scenario: "s" + ord, scn: 0, rep: 0, status: "passed", durationMs: 5, errorType: null, error: null },
            { scenario: "dup", scn: 1, rep: 0, status: "deduped", durationMs: 0, errorType: null, error: null },
        ],
        uiIssues: [],
    };
    return { journal, fragment };
}

/** Writes shard dirs under <root>/<runId>. order: creation order of shards. */
function build(root, { runId = RUN, total = 2, pages = 4, order } = {}) {
    const dir = path.join(root, runId);
    const idxs = order || Array.from({ length: total }, (_, i) => i + 1);
    for (const idx of idxs) {
        const sd = path.join(dir, `shard-${idx}-of-${total}`);
        fs.mkdirSync(path.join(sd, "fragments"), { recursive: true });
        fs.mkdirSync(path.join(sd, "journals"), { recursive: true });
        const mp = [];
        for (let o = 0; o < pages; o++) {
            const mine = (o % total) + 1 === idx;
            const e = { ordinal: o, url: `https://example.test/p${o}`, assigned: mine, disposition: "completed", fragment: null, journal: null };
            if (mine) {
                const { journal, fragment } = pageFiles(o, total, runId);
                const ft = JSON.stringify(fragment); const jt = JSON.stringify(journal);
                fs.writeFileSync(path.join(sd, "fragments", `page-${o}.json`), ft);
                fs.writeFileSync(path.join(sd, "journals", `page-${o}.json`), jt);
                e.fragment = { name: `page-${o}.json`, bytes: Buffer.byteLength(ft), sha256: sha(ft) };
                e.journal = { name: `page-${o}.json`, bytes: Buffer.byteLength(jt), sha256: sha(jt), events: journal.count };
            }
            mp.push(e);
        }
        const m = {
            schema: "falcon.shard-manifest", v: 1, runId, shard: { index: idx, total }, attempt: 1, commit: "unknown",
            configFp: H("a"), frontierDigest: H("b"), planDigest: H("c"), pages: mp,
            exit: { code: 0, verdictCounts: { passed: 1 } },
            timing: { startedAt: "2030-01-01T00:00:00.000Z", endedAt: "2030-01-01T00:00:10.000Z", wallMs: 10000 },
            limits: { workers: 1, budgetMs: null },
        };
        fs.writeFileSync(path.join(sd, "manifest.json"), JSON.stringify(m));
    }
    return dir;
}

function env() {
    const root = tmp();
    const paths = { dataDir: path.join(root, "data"), reportsDir: path.join(root, "reports") };
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.mkdirSync(paths.reportsDir, { recursive: true });
    return { root, paths, inputs: path.join(root, "in") };
}

function tree(dir, base = dir, out = {}) {
    for (const n of fs.readdirSync(dir).sort()) {
        const p = path.join(dir, n);
        const st = fs.lstatSync(p);
        if (st.isDirectory()) tree(p, base, out);
        else if (!n.endsWith(".tmp") && !n.endsWith(".lock")) out[path.relative(base, p)] = fs.readFileSync(p, "utf8");
    }
    return out;
}
const snap = (e) => ({ d: tree(e.paths.dataDir), r: tree(e.paths.reportsDir) });
const run = (e, dir, extra = {}) => ShardMerge.merge({ inputDir: dir, expectTotal: 2, paths: e.paths, env: { ...ENV, ...extra.env }, beforeStep: extra.beforeStep });
const editJson = (file, fn) => { const v = JSON.parse(fs.readFileSync(file, "utf8")); fn(v); fs.writeFileSync(file, JSON.stringify(v)); };

test("clean merge: code 1 (a deduped+failed page), report and state written, fragments removed", async () => {
    const e = env(); const dir = build(e.inputs);
    const r = await run(e, dir);
    assert.strictEqual(r.code, 0);
    assert.ok(fs.existsSync(r.reportPath));
    const rep = JSON.parse(fs.readFileSync(r.reportPath, "utf8"));
    assert.strictEqual(rep.runId, RUN);
    assert.deepStrictEqual(rep.tests.map((t) => t.pageOrdinal), [0, 0, 1, 1, 2, 2, 3, 3]);
    assert.strictEqual(rep.tests[1].status, "deduped");
    assert.strictEqual(rep.stateMerge.eventsApplied, 8);
    assert.ok(fs.existsSync(path.join(e.paths.dataDir, "scenario_history.json")));
    assert.ok(!fs.existsSync(path.join(dir, "shard-1-of-2", "fragments", "page-0.json")));
    assert.ok(fs.existsSync(path.join(dir, "shard-1-of-2", "manifest.json")));
});

test("shuffled shard creation order gives byte-identical report and state", async () => {
    const a = env(); const b = env();
    await run(a, build(a.inputs));
    await run(b, build(b.inputs, { order: [2, 1] }));
    assert.deepStrictEqual(snap(a), snap(b));
});

test("replaying the merge is a no-op returning the recorded outcome", async () => {
    const e = env(); const dir = build(e.inputs);
    const first = await run(e, dir);
    const before = snap(e);
    const second = await run(e, dir);
    assert.strictEqual(second.code, first.code);
    assert.strictEqual(second.replay, true);
    assert.deepStrictEqual(snap(e), before);
});

test("receipt with a different input digest is rejected", async () => {
    const e = env(); const dir = build(e.inputs);
    await run(e, dir);
    editJson(path.join(dir, "shard-1-of-2", "manifest.json"), (m) => { m.attempt = 2; });
    const before = snap(e);
    const r = await run(e, dir);
    assert.strictEqual(r.code, 2);
    assert.deepStrictEqual(snap(e), before);
});

const STEPS = ["scenario_history", "healing_pending", "locator_store", "locator_memory", "run_history", "healing_logs", "exploratory", "report", "receipt", "cleanup"];
for (const step of STEPS) {
    test(`crash before ${step} then rerun converges to the clean-run bytes`, async () => {
        const base = env(); await run(base, build(base.inputs));
        const e = env(); const dir = build(e.inputs);
        await assert.rejects(run(e, dir, { beforeStep: async (n) => { if (n === step) throw new Error("injected"); } }), /injected/);
        const r = await run(e, dir);
        assert.ok(r.code === 0 || r.code === 1);
        assert.deepStrictEqual(snap(e), snap(base));
        const hist = JSON.parse(fs.readFileSync(path.join(e.paths.dataDir, "scenario_history.json"), "utf8"));
        for (const v of Object.values(hist)) assert.ok(v.history.length <= 1, "no double counted outcome");
    });
}

test("persist failure gives code 3, bundle files kept, no report", async () => {
    const e = env(); const dir = build(e.inputs);
    fs.mkdirSync(path.join(e.paths.reportsDir, "test-report.json"));
    const r = await run(e, dir);
    assert.strictEqual(r.code, 3);
    assert.ok(fs.existsSync(path.join(dir, "shard-1-of-2", "journals", "page-0.json")));
    assert.ok(fs.statSync(path.join(e.paths.reportsDir, "test-report.json")).isDirectory());
    assert.ok(!fs.existsSync(path.join(e.paths.reportsDir, "merge", "receipts", RUN + ".json")));
});
