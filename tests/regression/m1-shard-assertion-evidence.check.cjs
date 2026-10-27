"use strict";
/**
 * WP-79s — assertion evidence must survive shard serialization, schema
 * validation and merge, so a merged report classifies exactly like the
 * unsharded one (`verification` block equality).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const R = path.join(__dirname, "..", "..");
const StateJournal = require(path.join(R, "src/core/parallel/StateJournal"));
const ShardMerge = require(path.join(R, "src/core/parallel/ShardMerge"));
const ShardBundle = require(path.join(R, "src/core/parallel/ShardBundle"));
const Schemas = require(path.join(R, "src/core/parallel/Schemas"));
const Limits = require(path.join(R, "src/core/parallel/Limits"));
const ReportManager = require(path.join(R, "src/core/ReportManager"));

const H = (c) => c.repeat(64);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const RUN = "gh-7900001";
const ENV = { FALCON_LOCATOR_SALT: "fixture-salt" };
const EV = { check: "visible", locator: "#ok" };

// Executed-result shape emitted by TestRunner.runExpect.
const exec = (status, extra = {}) => ({
    name: "a", status, duration: 5, repetition: 1,
    assertion: { check: "visible", locator: "#ok", timeoutMs: 5000, outcome: status, matches: 1, ...extra },
});
const plain = (name, status = "passed") => ({ name, status, duration: 5, repetition: 1 });

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "wp79s-")); }

function fragmentFor(ord, total, rows, runId = RUN) {
    const idx = (ord % total) + 1;
    return ShardBundle.buildFragment({
        runId, shard: { index: idx, total },
        page: { ordinal: ord, results: rows, scenarioNames: rows.map((r) => r.name), disposition: "completed", status: "ok", uiIssues: [] },
    });
}

function journalFor(ord, total, runId = RUN) {
    const idx = (ord % total) + 1;
    const j = new StateJournal({
        runId, shard: { index: idx, total }, pageOrdinal: ord, commit: "unknown", configFp: H("a"),
        planDigest: H("c"), snapshotAt: "2030-01-01T00:00:00.000Z", clock: () => new Date("2030-01-01T00:00:01.000Z"),
    });
    j.record("flakiness.outcome", 0, 0, { action: "click", locator: "#b" + ord, status: "passed", outcome: null, errorType: null, durationMs: 5, description: "d" });
    return j.finish("ok");
}

/** pagesRows[ord] = rows (already-built fragment objects may be passed via fragOverride). */
function build(root, pagesRows, { total = 2, order, fragOverride = {}, runId = RUN } = {}) {
    const dir = path.join(root, runId);
    const idxs = order || Array.from({ length: total }, (_, i) => i + 1);
    for (const idx of idxs) {
        const sd = path.join(dir, `shard-${idx}-of-${total}`);
        fs.mkdirSync(path.join(sd, "fragments"), { recursive: true });
        fs.mkdirSync(path.join(sd, "journals"), { recursive: true });
        const mp = [];
        pagesRows.forEach((rows, o) => {
            const mine = (o % total) + 1 === idx;
            const e = { ordinal: o, url: `https://example.test/p${o}`, assigned: mine, disposition: "completed", fragment: null, journal: null };
            if (mine) {
                const fragment = fragOverride[o] || fragmentFor(o, total, rows, runId);
                const journal = journalFor(o, total, runId);
                const ft = JSON.stringify(fragment); const jt = JSON.stringify(journal);
                fs.writeFileSync(path.join(sd, "fragments", `page-${o}.json`), ft);
                fs.writeFileSync(path.join(sd, "journals", `page-${o}.json`), jt);
                e.fragment = { name: `page-${o}.json`, bytes: Buffer.byteLength(ft), sha256: sha(ft) };
                e.journal = { name: `page-${o}.json`, bytes: Buffer.byteLength(jt), sha256: sha(jt), events: journal.count };
            }
            mp.push(e);
        });
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

async function mergeReport(pagesRows, opts = {}) {
    const e = env();
    const dir = build(e.inputs, pagesRows, opts);
    const r = await ShardMerge.merge({ inputDir: dir, expectTotal: opts.total || 2, paths: e.paths, env: ENV });
    return { r, e, dir, report: r.reportPath ? JSON.parse(fs.readFileSync(r.reportPath, "utf8")) : null };
}

const unsharded = (pagesRows) => ReportManager.buildReport({ tests: pagesRows.flat(), runId: "R", duration: "1s" }).verification;

// ------------------------------------------------------------ A: serialization

test("A1 valid assertion evidence reaches the fragment row", () => {
    const f = fragmentFor(0, 2, [exec("passed")]);
    assert.deepStrictEqual(f.results[0].assertion, EV);
    assert.ok(Schemas.validateFragment(f).ok);
});

test("A2/A3 non-assertion rows carry no assertion/journeyId/required keys", () => {
    const f = fragmentFor(0, 2, [plain("x")]);
    for (const k of ["assertion", "journeyId", "required"]) assert.ok(!(k in f.results[0]), k);
});

test("A4/A5 journeyId and required survive serialization when valid", () => {
    const f = fragmentFor(0, 2, [{ ...exec("passed"), journeyId: "checkout-1", required: true }]);
    assert.strictEqual(f.results[0].journeyId, "checkout-1");
    assert.strictEqual(f.results[0].required, true);
    assert.ok(Schemas.validateFragment(f).ok);
});

test("A6 malformed source assertion is never a valid PASS", () => {
    for (const bad of ["nope", 7, [], null]) {
        const f = fragmentFor(0, 2, [{ name: "a", status: "passed", assertion: bad }]);
        assert.strictEqual(f.results[0].assertion, null);
        assert.ok(Schemas.validateFragment(f).ok);
    }
    const f = fragmentFor(0, 2, [{ name: "a", status: "passed", assertion: { check: "", locator: "#x" } }]);
    assert.ok(!("check" in f.results[0].assertion));
});

test("A6b invalid journeyId/required are dropped without changing the assertion outcome", () => {
    for (const extra of [{ journeyId: "__proto__" }, { journeyId: "a b" }, { journeyId: "x".repeat(65) }, { required: "yes" }]) {
        const f = fragmentFor(0, 2, [{ ...exec("failed"), ...extra }]);
        assert.deepStrictEqual(f.results[0].assertion, EV, JSON.stringify(extra));
        assert.ok(!("journeyId" in f.results[0]) && !("required" in f.results[0]));
        assert.ok(Schemas.validateFragment(f).ok);
    }
});

test("A6c a long hostile locator is bounded before redaction", () => {
    const t0 = Date.now();
    const f = fragmentFor(0, 2, [{ name: "a", status: "passed", assertion: { check: "visible", locator: "http://".repeat(40000) } }]);
    assert.ok(Date.now() - t0 < 500);
    assert.ok(f.results[0].assertion.locator.length <= Limits.SELECTOR_MAX);
});

test("A6d cutting a long locator never leaks a split secret or empties the evidence", () => {
    const secret = "S3cr3tTokenValue0123456789abcdefXYZ";
    const split = fragmentFor(0, 2, [{ name: "a", status: "passed", assertion: { check: "visible", locator: "Z".repeat(1170) + " " + secret + " tail" + "x ".repeat(200) } }]);
    assert.ok(!JSON.stringify(split).includes(secret.slice(0, 20)));
    const cutAtBoundary = fragmentFor(0, 2, [{ name: "a", status: "passed", assertion: { check: "visible", locator: "a ".repeat(585) + " " + secret } }]);
    assert.ok(!JSON.stringify(cutAtBoundary).includes(secret.slice(0, 20)));
    const oneToken = fragmentFor(0, 2, [{ name: "a", status: "passed", assertion: { check: "visible", locator: "q".repeat(5000) } }]);
    assert.ok(oneToken.results[0].assertion.locator.length > 0);
    assert.ok(Schemas.validateFragment(oneToken).ok);
});

test("A7 oversize metadata stays within existing limits (locator truncated, fragment cap still enforced)", () => {
    const f = fragmentFor(0, 2, [{ name: "a", status: "passed", assertion: { check: "visible", locator: "#" + "x".repeat(5000) } }]);
    assert.ok(f.results[0].assertion.locator.length <= Limits.SELECTOR_MAX);
    const many = Array.from({ length: Limits.FRAGMENT_MAX_ROWS }, (_, i) => ({
        name: "n".repeat(190) + i, status: "passed", assertion: { check: "visible", locator: "div > span ".repeat(27) },
    }));
    const v = Schemas.validateFragment(fragmentFor(0, 2, many));
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, "TOO_LARGE");
});

test("A8 secrets in locators are redacted; expected/actual page text is not persisted", () => {
    const f = fragmentFor(0, 2, [exec("passed", { actual: "private page text", expected: "secret value" })]);
    const g = fragmentFor(0, 2, [{ name: "a", status: "passed", assertion: { check: "visible", locator: "input[value='password=hunter2']" } }]);
    assert.ok(!JSON.stringify(g).includes("hunter2"));
    const s = JSON.stringify(f);
    assert.ok(!s.includes("private page text") && !s.includes("secret value") && !s.includes("timeoutMs"));
});

test("A9 deduped rows never carry assertion metadata", () => {
    const f = fragmentFor(0, 2, [{ ...exec("passed"), status: "deduped", firstRunOn: "u" }]);
    assert.ok(!("assertion" in f.results[0]));
});

// ------------------------------------------------------------ B: schema

const baseFrag = () => fragmentFor(0, 2, [plain("x")]);
const withRow = (patch) => { const f = baseFrag(); Object.assign(f.results[0], patch); return Schemas.validateFragment(f); };

test("B1 legacy v1 row accepted", () => assert.ok(Schemas.validateFragment(baseFrag()).ok));

test("B2 extended row accepted", () => assert.ok(withRow({ assertion: EV, journeyId: "j.1", required: true }).ok));

test("B3-B8 malformed metadata rejected", () => {
    const bad = [
        [{ assertion: { ...EV, extra: 1 } }, "UNKNOWN_KEY"],
        [{ assertion: { check: "visible", locator: { a: 1 } } }, "TYPE_INVALID"],
        [{ assertion: [] }, "TYPE_INVALID"],
        [{ assertion: 5 }, "TYPE_INVALID"],
        [{ assertion: "x" }, "TYPE_INVALID"],
        [{ assertion: { check: "vis\u0000ible", locator: "#a" } }, "CONTROL_CHAR"],
        [{ assertion: { check: "visible", locator: "#" + "a".repeat(301) } }, "STRING_TOO_LONG"],
        [{ assertion: { check: "a".repeat(41), locator: "#a" } }, "STRING_TOO_LONG"],
        [{ assertion: { check: "has space", locator: "#a" } }, "PATTERN"],
        [{ assertion: { check: "", locator: "#a" } }, "STRING_TOO_SHORT"],
        [{ required: "true", assertion: EV }, "TYPE_INVALID"],
        [{ required: 1, assertion: EV }, "TYPE_INVALID"],
        [{ journeyId: 5 }, "TYPE_INVALID"],
        [{ journeyId: "a b" }, "PATTERN"],
        [{ journeyId: "" }, "STRING_TOO_SHORT"],
        [{ journeyId: "x".repeat(65) }, "STRING_TOO_LONG"],
        [{ journeyId: "__proto__" }, "PATTERN"],
        [{ journeyId: "constructor" }, "FORBIDDEN_VALUE"],
        [{ required: true }, "CONTRADICTION"],
        [{ status: "deduped", assertion: EV }, "CONTRADICTION"],
        [{ extraField: 1 }, "UNKNOWN_KEY"],
    ];
    for (const [patch, code] of bad) {
        const v = withRow(patch);
        assert.strictEqual(v.ok, false, JSON.stringify(patch));
        assert.strictEqual(v.code, code, JSON.stringify(patch));
    }
});

test("B7 prototype-pollution payload and nesting rejected", () => {
    const f = baseFrag();
    f.results[0].assertion = JSON.parse('{"check":"visible","locator":"#a","__proto__":{"x":1}}');
    assert.strictEqual(Schemas.validateFragment(f).ok, false);
    const g = baseFrag();
    g.results[0].assertion = { check: "visible", locator: "#a", n: { a: { b: { c: 1 } } } };
    assert.strictEqual(Schemas.validateFragment(g).ok, false);
});

test("B9/B10 schema version is unchanged (v1) and assertion:null is the only non-object form", () => {
    assert.strictEqual(baseFrag().v, 1);
    assert.ok(withRow({ assertion: null }).ok);
    assert.ok(withRow({ assertion: {} }).ok); // schema-valid, but classifier treats a passed {} as INCONCLUSIVE
});

// ------------------------------------------------------------ C/D/E: merge + equivalence

const FIXTURES = {
    c1_onePassSingleShard: [[exec("passed")]],
    c2_twoShardPass: [[exec("passed")], [exec("passed")]],
    c3_passAndFail: [[exec("passed")], [exec("failed", { actual: "x" })]],
    c4_failOnly: [[exec("failed")]],
    c5_unavailable: [[exec("unavailable")], [exec("passed")]],
    c6_skipped: [[exec("skipped")], [exec("passed")]],
    e1_interactionOnly: [[plain("click")], [plain("type")]],
    e2_verified: [[plain("click"), exec("passed")], [plain("go")]],
    e4_noCheck: [[{ name: "a", status: "passed", assertion: { locator: "#x" } }]],
    e5_noLocator: [[{ name: "a", status: "passed", assertion: { check: "visible" } }]],
    e5b_emptyObject: [[{ name: "a", status: "passed", assertion: {} }]],
    e5c_malformed: [[{ name: "a", status: "passed", assertion: "nope" }], [exec("passed")]],
    e8_dedupe: [[exec("passed"), { ...exec("passed"), status: "deduped", firstRunOn: "u" }], [exec("passed")]],
    e9_mixedFailure: [[exec("passed"), plain("c", "failed")], [exec("passed")], [exec("passed")]],
    withMeta: [[{ ...exec("passed"), journeyId: "j1", required: true }], [exec("passed")]],
    emptyShardPages: [[], [exec("passed")]],
};

for (const [name, rows] of Object.entries(FIXTURES)) {
    test(`D merged verification equals unsharded: ${name}`, async () => {
        const { r, report } = await mergeReport(rows);
        assert.ok(r.reportPath, `merge rejected: ${JSON.stringify(r.diagnostics)}`);
        assert.deepStrictEqual(report.verification, unsharded(rows));
    });
}

test("D one shard and two shards agree", async () => {
    const rows = FIXTURES.c3_passAndFail;
    const one = await mergeReport(rows, { total: 1 });
    const two = await mergeReport(rows, { total: 2 });
    assert.deepStrictEqual(one.report.verification, two.report.verification);
});

test("E2/E3 levels", async () => {
    assert.strictEqual((await mergeReport(FIXTURES.e2_verified)).report.verification.level, "BUSINESS_VERIFIED");
    assert.strictEqual((await mergeReport(FIXTURES.c3_passAndFail)).report.verification.level, "FAILED");
    assert.strictEqual((await mergeReport(FIXTURES.e1_interactionOnly)).report.verification.level, "INTERACTION_ONLY");
});

test("E4-E6 insufficient or unavailable evidence is never BUSINESS_VERIFIED", async () => {
    for (const k of ["e4_noCheck", "e5_noLocator", "e5b_emptyObject", "e5c_malformed", "c5_unavailable", "c6_skipped"]) {
        const { report } = await mergeReport(FIXTURES[k]);
        assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED", k);
    }
});

test("E7 a quarantined assertion failure is never BUSINESS_VERIFIED through shards", async () => {
    const { report } = await mergeReport([[{ ...exec("failed"), status: "quarantined" }]]);
    assert.notStrictEqual(report.verification.level, "BUSINESS_VERIFIED");
});

test("E8 deduped rows do not inflate assertion counts", async () => {
    const { report } = await mergeReport(FIXTURES.e8_dedupe);
    assert.strictEqual(report.verification.assertions.required, 2);
});

test("C7 legacy fragments (no assertion fields) merge as before", async () => {
    const legacy = (ord) => ({
        schema: "falcon.fragment", v: 1, runId: RUN, shard: { index: (ord % 2) + 1, total: 2 }, pageOrdinal: ord, status: "ok",
        results: [{ scenario: "s" + ord, scn: 0, rep: 0, status: "passed", durationMs: 5, errorType: null, error: null }], uiIssues: [],
    });
    const { r, report } = await mergeReport([[], []], { fragOverride: { 0: legacy(0), 1: legacy(1) } });
    assert.ok(r.reportPath);
    assert.ok(report.tests.every((t) => !("assertion" in t) && !("journeyId" in t) && !("required" in t)));
    assert.strictEqual(report.verification.level, "INTERACTION_ONLY");
});

test("C9 tampered fragment metadata is rejected and writes no report", async () => {
    const bad = fragmentFor(0, 2, [exec("passed")]);
    bad.results[0].assertion.sneaky = "x";
    const { r } = await mergeReport([[exec("passed")], [exec("passed")]], { fragOverride: { 0: bad } });
    assert.strictEqual(r.code, 2);
    assert.strictEqual(r.reportPath, null);
});

test("C8/C11/C12 missing shard, digest mismatch and identity mismatch still reject", async () => {
    const rows = FIXTURES.c2_twoShardPass;
    const e1 = env();
    const d1 = build(e1.inputs, rows, { order: [1] });
    assert.strictEqual((await ShardMerge.merge({ inputDir: d1, expectTotal: 2, paths: e1.paths, env: ENV })).code, 2);

    const e2 = env();
    const d2 = build(e2.inputs, rows);
    const fp = path.join(d2, "shard-1-of-2", "fragments", "page-0.json");
    const v = JSON.parse(fs.readFileSync(fp, "utf8"));
    v.results[0].assertion = { check: "visible", locator: "#tampered" };
    fs.writeFileSync(fp, JSON.stringify(v));
    assert.strictEqual((await ShardMerge.merge({ inputDir: d2, expectTotal: 2, paths: e2.paths, env: ENV })).code, 2);

    const e3 = env();
    const wrong = fragmentFor(0, 2, [exec("passed")], "gh-7900002");
    const d3 = build(e3.inputs, rows, { fragOverride: { 0: wrong } });
    assert.strictEqual((await ShardMerge.merge({ inputDir: d3, expectTotal: 2, paths: e3.paths, env: ENV })).code, 2);
});

test("C13/C14 shard order permutation yields identical reports", async () => {
    const rows = FIXTURES.c3_passAndFail;
    const a = await mergeReport(rows, { order: [1, 2] });
    const b = await mergeReport(rows, { order: [2, 1] });
    assert.deepStrictEqual(a.report.tests, b.report.tests);
    assert.deepStrictEqual(a.report.verification, b.report.verification);
});

test("F merged rows keep deterministic legacy keys and gain only the additive metadata", async () => {
    const { report } = await mergeReport([[{ ...exec("passed"), journeyId: "j1", required: true }]], { total: 1 });
    const t = report.tests[0];
    assert.deepStrictEqual(t.assertion, EV);
    assert.strictEqual(t.journeyId, "j1");
    assert.strictEqual(t.required, true);
    assert.strictEqual(report.summary.passed, 1);
    assert.strictEqual(report.result, "PASSED");
});
