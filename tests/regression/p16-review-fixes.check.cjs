"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const R = path.join(__dirname, "..", "..");
const P = (n) => require(path.join(R, "src/core/parallel", n));
const StateJournal = P("StateJournal");
const ShardBundle = P("ShardBundle");
const ShardMerge = P("ShardMerge");
const Planning = P("Planning");
const Schemas = P("Schemas");
const SafeFs = P("SafeFs");
const Limits = P("Limits");
const Runner = P("Runner");

const RUN = "gh-review-01";
const ENV = { FALCON_LOCATOR_SALT: "fixture-salt" };
const H = (c) => c.repeat(64);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p16rf-"));

function nest(depth, leaf) { let v = leaf; for (let i = 0; i < depth; i++) v = { n: v }; return v; }

function journalFor(events, opts = {}) {
    const runId = RUN;
    const j = new StateJournal({
        runId, shard: { index: 1, total: 1 }, pageOrdinal: 0, commit: opts.commit || "unknown", configFp: H("a"),
        planDigest: Planning.planDigest(Array.from({ length: opts.pages || 1 }, () => [])), snapshotAt: "2030-01-01T00:00:00.000Z", clock: () => new Date("2030-01-01T00:00:01.000Z"),
    });
    for (const [type, scn, rep, p] of events) j.record(type, scn, rep, p);
    return j.finish("ok");
}

function pageOf(over = {}) {
    return {
        ordinal: 0, url: "https://example.test/p0", assigned: true, disposition: "completed", status: "tested",
        results: [{ name: "s0", status: "passed", duration: 1 }], uiIssues: [], signatures: [], scenarioNames: ["s0"], journal: null, ...over,
    };
}

/** Real ShardBundle.write of a single-shard run. Returns the input dir (parent of shard-1-of-1). */
async function bundle(root, pages, over = {}) {
    const runId = over.runId || RUN;
    const input = path.join(root, "in", runId);
    const stored = pages.map((p) => Schemas.storedUrl(p.url));
    await ShardBundle.write({
        dir: path.join(input, "shard-1-of-1"), runId, shard: { index: 1, total: 1 }, commit: over.commit || "unknown", configFp: H("a"),
        frontierDigest: Planning.frontierDigest(stored), planDigest: Planning.planDigest(pages.map((p) => p.signatures || [])),
        pages, startedAt: Date.parse("2030-01-01T00:00:00Z"), endedAt: Date.parse("2030-01-01T00:00:10Z"), limits: { workers: 1, budgetMs: null },
    });
    return input;
}

function paths(root) {
    const p = { dataDir: path.join(root, "data"), reportsDir: path.join(root, "reports") };
    fs.mkdirSync(p.dataDir, { recursive: true }); fs.mkdirSync(p.reportsDir, { recursive: true });
    return p;
}

function tree(dir, base = dir, out = {}) {
    for (const n of fs.readdirSync(dir).sort()) {
        const p = path.join(dir, n);
        const st = fs.lstatSync(p);
        if (st.isDirectory()) tree(p, base, out);
        else if (st.isFile() && !n.endsWith(".tmp") && !n.endsWith(".lock")) out[path.relative(base, p)] = fs.readFileSync(p, "utf8");
    }
    return out;
}
const merge = (input, ps, extra = {}) => ShardMerge.merge({ inputDir: input, expectTotal: 1, paths: ps, env: ENV, ...extra });

const candidate = (depth) => ["locatorMemory.candidate", 0, 0, { identity: { k: "v" }, candidate: nest(depth, "x"), baseRevision: null }];

// ---------------------------------------------------------------- F1

test("F1: a real locatorMemory.candidate journal (deep payload) merges", async () => {
    const root = tmp(); const ps = paths(root);
    // 5 nested levels under candidate => payload depth 6 (the schema maximum)
    const journal = journalFor([candidate(5)]);
    const input = await bundle(root, [pageOf({ journal })]);
    const r = await merge(input, ps);
    assert.ok(r.code === 0 || r.code === 1, `code ${r.code} ${JSON.stringify(r.diagnostics)}`);
});

test("F1: journal file depth cap is exactly envelope + payload depth (max accepted, max+1 rejected)", async () => {
    const f = path.join(tmp(), "d.json");
    const deep = (n) => "[".repeat(n) + "]".repeat(n);
    fs.writeFileSync(f, deep(Limits.JOURNAL_FILE_MAX_DEPTH));
    assert.equal((await SafeFs.readBoundedJson(f, { maxBytes: 1e6, maxDepth: Limits.JOURNAL_FILE_MAX_DEPTH })).ok, true);
    fs.writeFileSync(f, deep(Limits.JOURNAL_FILE_MAX_DEPTH + 1));
    assert.equal((await SafeFs.readBoundedJson(f, { maxBytes: 1e6, maxDepth: Limits.JOURNAL_FILE_MAX_DEPTH })).code, "READ_TOO_DEEP");
    assert.equal(Limits.JOURNAL_FILE_MAX_DEPTH, Limits.JOURNAL_MAX_DEPTH + 3);
});

test("F1: payload depth max+1 is still refused by the schema, and an over-deep journal file is rejected at merge", async () => {
    assert.throws(() => journalFor([candidate(6)]), /JOURNAL_PAYLOAD_INVALID:TOO_DEEP/);
    const root = tmp(); const ps = paths(root);
    const input = await bundle(root, [pageOf({ journal: journalFor([candidate(5)]) })]);
    const jf = path.join(input, "shard-1-of-1", "journals", "page-0.json");
    const j = JSON.parse(fs.readFileSync(jf, "utf8"));
    j.events[0].p.candidate = nest(6, "x");
    fs.writeFileSync(jf, JSON.stringify(j));
    const r = await merge(input, ps);
    assert.equal(r.code, 2);
    assert.equal(r.diagnostics[0].code, "READ_TOO_DEEP");
});

// ---------------------------------------------------------------- F2

test("F2: query/fragment/token canaries never reach bundle files or the merged report; urlIds stay unique", async () => {
    const root = tmp(); const ps = paths(root);
    const pages = [
        pageOf({
            ordinal: 0, url: "https://example.test/p?token=CANARY123&a=1#CANARYFRAG",
            results: [{ name: "Load https://example.test/p?token=CANARY123", status: "failed", error: "boom at https://example.test/p?token=CANARY123 Bearer CANARYBEARER.abc password=CANARYPW Authorization: Basic CANARYAUTH " + "A".repeat(40) }],
            uiIssues: [{ type: "x", message: "see https://example.test/p?access_token=CANARY123" }], taskFailed: true,
            reason: "net error access_token=CANARY123", status: "tested", scenarioNames: [],
        }),
        pageOf({ ordinal: 1, url: "https://example.test/p?token=OTHER456", results: [], scenarioNames: [], taskFailed: true }),
    ];
    const input = await bundle(root, pages);
    const files = tree(input);
    assert.ok(Object.keys(files).length >= 4);
    const m = JSON.parse(files[path.join("shard-1-of-1", "manifest.json")]);
    assert.equal(m.pages[0].url, "https://example.test/p");
    assert.equal(m.pages[1].url, "https://example.test/p");
    assert.notEqual(m.pages[0].urlId, m.pages[1].urlId);
    for (const [name, text] of Object.entries(files)) {
        for (const c of ["CANARY", "OTHER456", "hunter"]) assert.ok(!text.includes(c), `${c} leaked into ${name}`);
        assert.ok(!text.includes("A".repeat(32)), `long run leaked into ${name}`);
    }
    // identity digests were computed on the stored form: the bundle reads back and merges
    await ShardBundle.read(path.join(input, "shard-1-of-1"));
    const r = await merge(input, ps);
    assert.ok(r.code === 0 || r.code === 1, JSON.stringify(r.diagnostics));
    const out = tree(root);
    for (const [name, text] of Object.entries(out)) assert.ok(!text.includes("CANARY") && !text.includes("OTHER456"), `leak in ${name}`);
});

test("F2: a manifest with duplicate urlId is rejected", async () => {
    const root = tmp(); const ps = paths(root);
    const input = await bundle(root, [pageOf({ ordinal: 0, url: "https://example.test/a", results: [], scenarioNames: [] }), pageOf({ ordinal: 1, url: "https://example.test/b", results: [], scenarioNames: [] })]);
    const mf = path.join(input, "shard-1-of-1", "manifest.json");
    const m = JSON.parse(fs.readFileSync(mf, "utf8"));
    m.pages[1].urlId = m.pages[0].urlId;
    fs.writeFileSync(mf, JSON.stringify(m));
    const r = await merge(input, ps);
    assert.equal(r.code, 2);
    assert.match(r.diagnostics[0].code, /DUPLICATE_URL_ID/);
});

test("F2: redactText covers the token families", () => {
    for (const s of ["token=ABC", "access_token: ABC", "Bearer ABCDEF", "password=ABC", "Authorization: Basic ABC", "x".repeat(32), "https://a.test/p?k=SECRETVAL#frag"]) {
        const out = Schemas.redactText(s);
        assert.ok(!/ABC|SECRETVAL|frag|x{32}/.test(out), `${s} -> ${out}`);
    }
    assert.equal(Schemas.redactText("plain failure"), "plain failure");
});

// ---------------------------------------------------------------- F3

test("F3: expect-run-id / expect-commit: match, mismatch (nothing written), absent", async () => {
    const commit = "a".repeat(40);
    const mk = async () => { const root = tmp(); const ps = paths(root); return { root, ps, input: await bundle(root, [pageOf({ journal: journalFor([candidate(1)], { commit }) })], { commit }) }; };
    let e = await mk();
    assert.equal((await merge(e.input, e.ps, { expectRunId: RUN, expectCommit: commit })).code, 0);
    e = await mk();
    assert.equal((await merge(e.input, e.ps)).code, 0);
    for (const bad of [{ expectRunId: "gh-other-99" }, { expectCommit: "b".repeat(40) }]) {
        e = await mk();
        const before = tree(e.root);
        const r = await merge(e.input, e.ps, bad);
        assert.equal(r.code, 2);
        assert.match(r.diagnostics[0].code, /UNEXPECTED/);
        assert.deepEqual(tree(e.root), before);
    }
});

test("F3: strict flag parsing: duplicates, empty and malformed values are rejected", () => {
    const ok = Runner.parseMergeExpect(["merge", "--input=x", "--expect-run-id=gh-review-01", "--expect-commit=" + "a".repeat(40)]);
    assert.deepEqual([ok.ok, ok.expectRunId, ok.expectCommit], [true, RUN, "a".repeat(40)]);
    assert.equal(Runner.parseMergeExpect(["merge", "--input=x"]).ok, true);
    for (const bad of ["--expect-run-id=", "--expect-commit=", "--expect-commit=abc", "--expect-run-id=BAD ID"]) assert.equal(Runner.parseMergeExpect(["merge", "--input=x", bad]).ok, false, bad);
    assert.equal(Runner.parseMergeExpect(["merge", "--expect-run-id=gh-review-01", "--expect-run-id=gh-review-01"]).ok, false);
    assert.equal(Runner.checkMergeArgv(["merge", "--input=x", "--expect-run-id=gh-review-01"]), null);
    assert.notEqual(Runner.checkMergeArgv(["merge", "--input=x", "--expect-run-id"]), null);
    const r = spawnSync(process.execPath, [path.join(R, "falcon.js"), "merge", "--input=" + os.tmpdir(), "--expect-commit="], { cwd: R, encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 2);
});

// ---------------------------------------------------------------- F4

test("F4: bundle files are hashed from the same buffer that is parsed (swap between reads cannot pass)", async () => {
    const root = tmp(); const ps = paths(root);
    const input = await bundle(root, [pageOf({ journal: journalFor([candidate(1)]) })]);
    const ff = path.join(input, "shard-1-of-1", "fragments", "page-0.json");
    const good = fs.readFileSync(ff, "utf8");
    const evil = JSON.parse(good);
    evil.results[0].scenario = "s1";
    fs.writeFileSync(ff, JSON.stringify(evil).padEnd(Buffer.byteLength(good), " "));
    const orig = fs.promises.readFile;
    fs.promises.readFile = async function (f, ...rest) {
        if (String(f) === ff) fs.writeFileSync(ff, good); // a second read would now see the good bytes
        return orig.call(this, f, ...rest);
    };
    try {
        const r = await merge(input, ps);
        assert.equal(r.code, 2);
        assert.equal(r.diagnostics[0].code, "SHA_MISMATCH");
    } finally { fs.promises.readFile = orig; }
    const raw = await SafeFs.readBoundedJson(ff, { maxBytes: 1e6, maxDepth: 6 });
    assert.equal(typeof raw.sha256, "string");
    assert.equal(raw.bytes, Buffer.byteLength(fs.readFileSync(ff)));
});

// ---------------------------------------------------------------- F5

test("F5: merge-time rewrites use the private atomic writer (0600, no stray temp)", async () => {
    const src = fs.readFileSync(path.join(R, "src/core/parallel/Runner.js"), "utf8");
    assert.ok(!/fs\.promises\.writeFile|fs\.writeFile/.test(src));
    const dir = tmp();
    const rp = path.join(dir, "test-report.json");
    fs.writeFileSync(rp, JSON.stringify({ execution: { timings: {} } }), { mode: 0o644 });
    await Runner.addMergeMs(rp, 5);
    assert.equal(JSON.parse(fs.readFileSync(rp, "utf8")).execution.timings.mergeMs, 5);
    assert.equal(fs.statSync(rp).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(dir), ["test-report.json"]);
});

// ---------------------------------------------------------------- F6

test("F6: oversize or symlinked canonical state fails closed (code 3, untouched); missing file is empty", async () => {
    const mk = async () => { const root = tmp(); return { root, ps: paths(root), input: await bundle(root, [pageOf({ journal: journalFor([candidate(1)]) })]) }; };
    let e = await mk();
    const big = path.join(e.ps.dataDir, "scenario_history.json");
    fs.writeFileSync(big, " ".repeat(9 * 1024 * 1024));
    let before = fs.readFileSync(big);
    let r = await merge(e.input, e.ps);
    assert.equal(r.code, 3);
    assert.ok(before.equals(fs.readFileSync(big)));
    assert.ok(!fs.existsSync(path.join(e.ps.reportsDir, "test-report.json")));

    e = await mk();
    const target = path.join(e.root, "elsewhere.json");
    fs.writeFileSync(target, "{}");
    fs.symlinkSync(target, path.join(e.ps.dataDir, "healing_pending.json"));
    r = await merge(e.input, e.ps);
    assert.equal(r.code, 3);
    assert.equal(fs.readFileSync(target, "utf8"), "{}");
    assert.ok(fs.lstatSync(path.join(e.ps.dataDir, "healing_pending.json")).isSymbolicLink());

    e = await mk();
    assert.equal((await merge(e.input, e.ps)).code, 0);
});

// ---------------------------------------------------------------- CR-b

test("CR-b: a failed receipt write leaves no PASSED report and exits 3", async () => {
    const root = tmp(); const ps = paths(root);
    const input = await bundle(root, [pageOf({ journal: journalFor([candidate(1)]) })]);
    const r = await merge(input, ps, {
        beforeStep: async (n) => { if (n === "receipt") fs.mkdirSync(path.join(ps.reportsDir, "merge", "receipts", `${RUN}.json`), { recursive: true }); },
    });
    assert.equal(r.code, 3);
    assert.ok(!fs.existsSync(path.join(ps.reportsDir, "test-report.json")));
    assert.ok(fs.existsSync(path.join(input, "shard-1-of-1", "fragments", "page-0.json")), "inputs kept");
});

// ---------------------------------------------------------------- P3 budget flag

test("P3: merged coverage.budgetExhausted reflects budget-exhausted pages, not max-pages", async () => {
    const skipped = (reason, ordinal = 1) => pageOf({ ordinal, url: `https://example.test/s${ordinal}`, disposition: "skipped", status: "skipped", reason, results: [], scenarioNames: [] });
    const flag = async (reason) => {
        const root = tmp(); const ps = paths(root);
        const input = await bundle(root, [pageOf({ journal: journalFor([candidate(1)], { pages: 2 }) }), skipped(reason)]);
        const r = await merge(input, ps);
        assert.ok(r.code === 0 || r.code === 1, JSON.stringify(r.diagnostics));
        return JSON.parse(fs.readFileSync(r.reportPath, "utf8")).coverage.budgetExhausted;
    };
    assert.equal(await flag("budget-exhausted"), true);
    assert.equal(await flag("max-pages"), false);
});

// ---------------------------------------------------------------- P3 analysis deadline gate

test("P3: analysis honours the deadline: no page is analysed after it and none is dropped", async (t) => {
    const { chromium } = require("playwright");
    const http = require("node:http");
    const ParallelSweep = P("ParallelSweep");
    const server = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end('<html><body><a href="/a">a</a><a href="/b">b</a><button id="x" type="button">x</button></body></html>');
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch();
    t.after(async () => { await browser.close(); server.close(); });
    const context = await browser.newContext();
    let created = 0;
    const spy = { newContext: async (o) => { created++; return browser.newContext(o); } };
    const base = `http://127.0.0.1:${server.address().port}`;
    const r = await ParallelSweep.run({
        context, browser: spy, entryUrl: base + "/", runId: "run-test-0002", workers: 2, shard: null, maxPages: 20,
        budgetMs: 5000, startedAt: Date.now() - 10000, dedupe: true, sameOriginOnly: true, repeat: 1, pageTimeoutMs: 8000, commit: "unknown",
    });
    assert.equal(created, 0, "no analysis context after the deadline");
    assert.ok(r.pages.length >= 3);
    for (const p of r.pages) { assert.equal(p.reason, "budget-exhausted"); assert.equal(p.disposition, "skipped"); }
    assert.equal(r.budgetExhausted, true);
});
