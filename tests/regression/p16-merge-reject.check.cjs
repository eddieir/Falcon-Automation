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

const S1 = (d, ...p) => path.join(d, "shard-1-of-2", ...p);
const S2 = (d, ...p) => path.join(d, "shard-2-of-2", ...p);
function resign(sd, sub, name, mutateText) {
    const f = path.join(sd, sub, name);
    const t = mutateText(fs.readFileSync(f, "utf8"));
    fs.writeFileSync(f, t);
    editJson(path.join(sd, "manifest.json"), (m) => {
        const pg = m.pages.find((p) => p.assigned && p[sub === "journals" ? "journal" : "fragment"]);
        const ref = pg[sub === "journals" ? "journal" : "fragment"];
        ref.bytes = Buffer.byteLength(t); ref.sha256 = sha(t);
    });
}
const CASES = {
    "missing shard": (d) => fs.rmSync(S2(d), { recursive: true }),
    "duplicate shard index": (d) => editJson(S2(d, "manifest.json"), (m) => { m.shard.index = 1; }),
    "mixed runId": (d) => editJson(S2(d, "manifest.json"), (m) => { m.runId = "gh-7654321"; }),
    "mixed total": (d) => editJson(S2(d, "manifest.json"), (m) => { m.shard.total = 3; }),
    "mixed configFp": (d) => editJson(S2(d, "manifest.json"), (m) => { m.configFp = H("f"); }),
    "mixed planDigest": (d) => editJson(S2(d, "manifest.json"), (m) => { m.planDigest = H("f"); }),
    "mixed frontierDigest": (d) => editJson(S2(d, "manifest.json"), (m) => { m.frontierDigest = H("f"); }),
    "bad ordinal": (d) => editJson(S1(d, "manifest.json"), (m) => { m.pages[1].ordinal = 9; }),
    "not-run disposition": (d) => editJson(S1(d, "manifest.json"), (m) => { m.pages[0].disposition = "not-run"; }),
    "duplicate page ownership": (d) => editJson(S2(d, "manifest.json"), (m) => { m.pages[0].assigned = true; }),
    "sha mismatch": (d) => { const f = S1(d, "fragments", "page-0.json"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("s0", "s9")); },
    "traversal name": (d) => editJson(S1(d, "manifest.json"), (m) => { m.pages[0].fragment.name = "../../x.json"; }),
    "symlink fragment": (d) => { const f = S1(d, "fragments", "page-0.json"); const c = f + ".real"; fs.renameSync(f, c); fs.symlinkSync(c, f); },
    "oversized fragment": (d) => resign(S1(d), "fragments", "page-0.json", (t) => t + " ".repeat(1024 * 1024 + 10)),
    "future manifest schema": (d) => editJson(S1(d, "manifest.json"), (m) => { m.v = 2; }),
    "future journal schema": (d) => resign(S1(d), "journals", "page-0.json", (t) => t.replace('"v":1', '"v":2')),
    "truncated journal": (d) => resign(S1(d), "journals", "page-0.json", (t) => { const j = JSON.parse(t); j.events.pop(); j.count = j.events.length; return JSON.stringify(j); }),
    "malformed fragment": (d) => resign(S1(d), "fragments", "page-0.json", () => "{not json"),
};
for (const [name, mutate] of Object.entries(CASES)) {
    test(`reject: ${name} -> code 2, canonical files unchanged, inputs kept`, async () => {
        const e = env(); const dir = build(e.inputs);
        fs.writeFileSync(path.join(e.paths.dataDir, "scenario_history.json"), "{}\n");
        mutate(dir);
        const before = snap(e);
        const inputsBefore = tree(e.inputs);
        const r = await run(e, dir);
        assert.strictEqual(r.code, 2, JSON.stringify(r.diagnostics));
        assert.ok(Array.isArray(r.diagnostics) && r.diagnostics.length <= 20);
        assert.strictEqual(r.reportPath, null);
        assert.deepStrictEqual(snap(e), before);
        assert.deepStrictEqual(tree(e.inputs), inputsBefore);
    });
}

test("same event id with a different payload is rejected by the guard", () => {
    const ev = (p) => ({ pageOrdinal: 0, seq: 1, id: "a".repeat(32), type: "healing.log", scn: 0, rep: 0, at: "2030-01-01T00:00:00.000Z", p });
    const a = ev({ original: "#a", resolved: null, tier: "LLM", description: "" });
    const b = ev({ original: "#b", resolved: null, tier: "LLM", description: "" });
    assert.throws(() => ShardMerge.checkEvents([a, b]), (x) => x.rejectCode === "EVENT_ID_CONFLICT");
    assert.strictEqual(ShardMerge.checkEvents([a, { ...a }]).length, 1);
});

test("expectTotal mismatch is rejected", async () => {
    const e = env(); const dir = build(e.inputs);
    const r = await ShardMerge.merge({ inputDir: dir, expectTotal: 3, paths: e.paths, env: ENV });
    assert.strictEqual(r.code, 2);
});
