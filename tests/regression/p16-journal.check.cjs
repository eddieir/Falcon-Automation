const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const StateJournal = require("../../src/core/parallel/StateJournal");
const { JournalError } = StateJournal;
const S = require("../../src/core/parallel/Schemas");
const Limits = require("../../src/core/parallel/Limits");
const { writeAtomicPrivate, readBoundedJson } = require("../../src/core/parallel/SafeFs");

const H64 = "c".repeat(64);
const hdr = (o = {}) => ({
    runId: "gh-7654321", shard: { index: 2, total: 4 }, pageOrdinal: 5, commit: "unknown",
    configFp: H64, planDigest: H64, snapshotAt: "2026-02-03T04:05:06.000Z",
    clock: () => new Date("2026-02-03T04:05:07.123Z"), ...o,
});
const OUT = { action: "click", locator: "#go", status: "failed", outcome: null, errorType: "timeout", durationMs: 12, description: "go button" };

function run() {
    const j = new StateJournal(hdr());
    j.record("flakiness.outcome", 0, 0, OUT);
    j.record("healing.pending", 0, 0, { original: "#go", suggested: "#go2", description: "d" });
    j.record("locatorStore.use", 1, null, { original: "#go" });
    return j.finish("ok");
}

test("finish appends task.end with eventCount = count-1 and a valid digest", () => {
    const env = run();
    assert.strictEqual(env.count, 4);
    const last = env.events[3];
    assert.deepStrictEqual([last.type, last.p.status, last.p.eventCount, last.scn, last.rep], ["task.end", "ok", 3, null, null]);
    assert.deepStrictEqual(env.events.map((e) => e.seq), [1, 2, 3, 4]);
    assert.strictEqual(env.digest, S.sha256(S.canonicalJson(env.events)));
    assert.strictEqual(S.validateJournal(JSON.parse(JSON.stringify(env))).ok, true);
});

test("replay produces identical ids and identical envelope", () => {
    const a = run(), b = run();
    assert.deepStrictEqual(a.events.map((e) => e.id), b.events.map((e) => e.id));
    assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
    assert.strictEqual(a.events[0].id, S.sha256("gh-7654321|5|0|0|flakiness.outcome|1").slice(0, 32));
    assert.strictEqual(StateJournal.eventId("gh-7654321", 5, 1, null, "locatorStore.use", 3), a.events[2].id);
});

test("ids ignore the clock but depend on run, page, scenario, repetition, type, seq", () => {
    const base = run().events[0].id;
    const j = new StateJournal(hdr({ clock: () => new Date("2030-01-01T00:00:00.000Z") }));
    j.record("flakiness.outcome", 0, 0, OUT);
    assert.strictEqual(j.finish("ok").events[0].id, base);
    for (const alt of [{ runId: "gh-7654322" }, { pageOrdinal: 6 }]) {
        const k = new StateJournal(hdr(alt)); k.record("flakiness.outcome", 0, 0, OUT);
        assert.notStrictEqual(k.finish("ok").events[0].id, base);
    }
    const k2 = new StateJournal(hdr()); k2.record("flakiness.outcome", 1, 0, OUT);
    assert.notStrictEqual(k2.finish("ok").events[0].id, base);
});

test("toJSON has stable key order and equals the envelope", () => {
    const j = new StateJournal(hdr());
    j.record("healing.tier3", 0, 0, { original: "#a" });
    assert.throws(() => j.toJSON(), { code: "JOURNAL_NOT_FINISHED" });
    j.finish("failed");
    assert.deepStrictEqual(Object.keys(j.toJSON()), ["schema", "v", "runId", "shard", "pageOrdinal", "commit", "configFp", "planDigest", "snapshotAt", "events", "count", "digest"]);
    assert.deepStrictEqual(Object.keys(j.toJSON().events[0]), ["seq", "id", "type", "scn", "rep", "at", "p"]);
    assert.strictEqual(j.toJSON().events[1].p.status, "failed");
    assert.strictEqual(JSON.parse(JSON.stringify(j)).digest, j.toJSON().digest);
});

test("record rejects invalid payloads with a coded error and records nothing", () => {
    const j = new StateJournal(hdr());
    for (const [t, p] of [
        ["healing.tier3", { original: "#a", cookie: "session=CANARY" }],
        ["healing.tier3", { original: "x".repeat(301) }],
        ["flakiness.outcome", { ...OUT, value: "CANARY-INPUT" }],
        ["flakiness.outcome", { ...OUT, description: "line\nbreak" }],
        ["healing.log", { original: "#a", resolved: null, tier: "LLM", description: "d", authorization: "Bearer CANARY" }],
        ["healing.log", { original: "#a", resolved: null, tier: "LLM", description: "d", apiKey: "sk-CANARY" }],
        ["locatorMemory.evidence", { identity: {}, signature: {}, storageState: { cookies: [] } }],
        ["healing.tier3", null],
        ["healing.tier3", "#a"],
    ]) {
        assert.throws(() => j.record(t, 0, 0, p), (e) => e instanceof JournalError && e.code.startsWith("JOURNAL_PAYLOAD_INVALID:"), t);
    }
    assert.strictEqual(j.size, 0);
    const polluted = JSON.parse('{"identity":{"__proto__":{"polluted":1}},"signature":{}}');
    assert.throws(() => j.record("locatorMemory.evidence", 0, 0, polluted), { code: "JOURNAL_PAYLOAD_INVALID:FORBIDDEN_KEY" });
    assert.strictEqual(({}).polluted, undefined);
    assert.strictEqual(j.size, 0);
});

test("record never leaks rejected content in the error", () => {
    const j = new StateJournal(hdr());
    try { j.record("healing.tier3", 0, 0, { original: "#a", cookie: "session=CANARY-LEAK" }); assert.fail("must throw"); } catch (e) {
        assert.ok(!String(e.message).includes("CANARY-LEAK") && !String(e.path).includes("CANARY-LEAK"));
    }
});

test("record rejects unknown, decision, and task.end types", () => {
    const j = new StateJournal(hdr());
    for (const t of ["approve", "reject", "quarantine", "unquarantine", "rollback", "locatorStore.add", "task.end", "bogus", "", undefined, "constructor"]) {
        assert.throws(() => j.record(t, 0, 0, {}), { code: "JOURNAL_TYPE_INVALID" }, String(t));
    }
    assert.strictEqual(j.size, 0);
});

test("record validates scn/rep and defaults undefined to null", () => {
    const j = new StateJournal(hdr());
    for (const bad of [-1, 1.5, "1", NaN, 100001]) assert.throws(() => j.record("healing.tier3", bad, 0, { original: "#a" }), { code: "JOURNAL_SCN_INVALID" });
    for (const bad of [-1, 1.5, "1", 1001]) assert.throws(() => j.record("healing.tier3", 0, bad, { original: "#a" }), { code: "JOURNAL_REP_INVALID" });
    j.record("healing.tier3", undefined, undefined, { original: "#a" });
    const env = j.finish("ok");
    assert.deepStrictEqual([env.events[0].scn, env.events[0].rep], [null, null]);
});

test("recorded payload is copied: later mutation cannot alter the journal", () => {
    const j = new StateJournal(hdr());
    const p = { original: "#a" };
    j.record("healing.tier3", 0, 0, p);
    p.original = "#mutated";
    assert.strictEqual(j.finish("ok").events[0].p.original, "#a");
});

test("event cap: 4999 recordable events plus task.end accepted, one more refused", () => {
    const j = new StateJournal(hdr());
    for (let i = 0; i < Limits.JOURNAL_MAX_EVENTS - 1; i++) j.record("healing.tier3", 0, 0, { original: "#a" });
    assert.throws(() => j.record("healing.tier3", 0, 0, { original: "#a" }), { code: "JOURNAL_FULL" });
    const env = j.finish("ok");
    assert.strictEqual(env.count, Limits.JOURNAL_MAX_EVENTS);
    assert.strictEqual(S.validateJournal(JSON.parse(JSON.stringify(env))).ok, true);
});

test("finish: single-use, status validated, no record after finish", () => {
    const j = new StateJournal(hdr());
    assert.throws(() => j.finish("done"), { code: "JOURNAL_STATUS_INVALID" });
    j.finish("ok");
    assert.throws(() => j.finish("ok"), { code: "JOURNAL_FINISHED" });
    assert.throws(() => j.record("healing.tier3", 0, 0, { original: "#a" }), { code: "JOURNAL_FINISHED" });
});

test("empty journal finishes with only task.end", () => {
    const env = new StateJournal(hdr()).finish("failed");
    assert.strictEqual(env.count, 1);
    assert.strictEqual(env.events[0].p.eventCount, 0);
    assert.strictEqual(S.validateJournal(JSON.parse(JSON.stringify(env))).ok, true);
});

test("constructor rejects a bad header", () => {
    for (const alt of [{ runId: "BAD" }, { runId: "../x" }, { shard: { index: 5, total: 4 } }, { pageOrdinal: -1 }, { configFp: "zz" }, { planDigest: undefined }, { snapshotAt: "yesterday" }, { commit: "HEAD" }]) {
        assert.throws(() => new StateJournal(hdr(alt)), (e) => e instanceof JournalError && e.code.startsWith("JOURNAL_HEADER_INVALID"), JSON.stringify(alt));
    }
    assert.throws(() => new StateJournal(), JournalError);
});

test("envelope digest tamper is detected after a disk round trip", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "p16-jr-"));
    const f = path.join(d, "page-5.json");
    const env = run();
    assert.deepStrictEqual(await writeAtomicPrivate(f, JSON.stringify(env)), { ok: true });
    const r = await readBoundedJson(f, { maxBytes: Limits.JOURNAL_MAX_BYTES, maxDepth: Limits.JOURNAL_MAX_DEPTH + 3 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(S.validateJournal(r.value).ok, true);
    const tampered = JSON.parse(fs.readFileSync(f, "utf8"));
    tampered.events[0].p.locator = "#other";
    assert.strictEqual(S.validateJournal(tampered).code, "DIGEST_MISMATCH");
    const dropped = JSON.parse(fs.readFileSync(f, "utf8"));
    dropped.events.splice(1, 1);
    assert.notStrictEqual(S.validateJournal(dropped).ok, true);
    const reordered = JSON.parse(fs.readFileSync(f, "utf8"));
    reordered.events.reverse();
    assert.notStrictEqual(S.validateJournal(reordered).ok, true);
});

test("canaries never appear in a finished journal", () => {
    const j = new StateJournal(hdr());
    for (const k of ["cookie", "authorization", "storageState", "value", "apiKey"]) {
        assert.throws(() => j.record("flakiness.outcome", 0, 0, { ...OUT, [k]: "CANARY-" + k }));
    }
    j.record("flakiness.outcome", 0, 0, OUT);
    assert.ok(!/CANARY/.test(JSON.stringify(j.finish("ok"))));
});
