const test = require("node:test");
const assert = require("node:assert");
const S = require("../../src/core/parallel/Schemas");
const Limits = require("../../src/core/parallel/Limits");
const StateJournal = require("../../src/core/parallel/StateJournal");

const H64 = "a".repeat(64);
const hdr = () => ({
    runId: "gh-1234567", shard: { index: 1, total: 2 }, pageOrdinal: 3, commit: "b".repeat(40),
    configFp: H64, planDigest: H64, snapshotAt: "2026-01-01T00:00:00.000Z",
    clock: () => new Date("2026-01-01T00:00:01.000Z"),
});
const manifest = () => ({
    schema: "falcon.shard-manifest", v: 1, runId: "gh-1234567", shard: { index: 1, total: 2 }, attempt: 1,
    commit: "unknown", ref: "feature/x", configFp: H64, frontierDigest: H64, planDigest: H64,
    pages: [{ ordinal: 0, url: "https://example.test/a", assigned: true, disposition: "completed",
        fragment: { name: "page-0.json", bytes: 10, sha256: H64 }, journal: { name: "page-0.json", bytes: 10, sha256: H64, events: 1 } }],
    exit: { code: 0, verdictCounts: { passed: 1 } },
    timing: { startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z", wallMs: 1000 },
    limits: { workers: 2, budgetMs: null },
});
const fragment = () => ({
    schema: "falcon.fragment", v: 1, runId: "gh-1234567", shard: { index: 1, total: 2 }, pageOrdinal: 0, status: "ok",
    results: [{ scenario: "login", scn: 0, rep: 0, status: "passed", durationMs: 5, errorType: null, error: null }],
    uiIssues: [{ type: "overlap", message: "m" }],
});

const size = (x) => Buffer.byteLength(JSON.stringify(x));
// Object whose JSON byte length is exactly `target` (strings kept <= 1500 chars).
function fitObj(target) {
    const o = {};
    let i = 0;
    while (size(o) < target) {
        o["k" + i] = "";
        let guard = 0;
        while (size(o) < target && o["k" + i].length < 1500 && guard++ < 10) {
            o["k" + i] += "x".repeat(Math.min(1500 - o["k" + i].length, target - size(o)));
        }
        i++;
        if (i > 200) throw new Error("cannot fit");
    }
    assert.strictEqual(size(o), target);
    return o;
}
// evidence payload whose total JSON size is exactly `target`
const evidenceOf = (target) => {
    const base = size({ identity: {}, signature: {} });
    return { identity: {}, signature: fitObj(target - base + 2) };
};
const code = (r) => (r.ok ? "OK" : r.code);

test("manifest: valid accepted", () => assert.strictEqual(S.validateManifest(manifest()).ok, true));

test("manifest: unknown/missing keys, wrong types, bad enums rejected", () => {
    let m = manifest(); m.extra = 1; assert.strictEqual(code(S.validateManifest(m)), "UNKNOWN_KEY");
    m = manifest(); delete m.planDigest; assert.strictEqual(code(S.validateManifest(m)), "MISSING_KEY");
    m = manifest(); m.pages[0].cookie = "c"; assert.strictEqual(code(S.validateManifest(m)), "UNKNOWN_KEY");
    m = manifest(); m.v = 2; assert.strictEqual(code(S.validateManifest(m)), "ENUM");
    m = manifest(); m.shard = { index: 3, total: 2 }; assert.strictEqual(code(S.validateManifest(m)), "OUT_OF_RANGE");
    m = manifest(); m.pages[0].fragment.name = "../page-0.json"; assert.ok(!S.validateManifest(m).ok);
    m = manifest(); m.pages[0].fragment.name = "page-1.json"; assert.ok(!S.validateManifest(m).ok);
    m = manifest(); m.pages[0].url = "https://u:p@example.test/"; assert.strictEqual(code(S.validateManifest(m)), "URL_USERINFO");
    m = manifest(); m.pages[0].url = "javascript:alert(1)"; assert.strictEqual(code(S.validateManifest(m)), "URL_INVALID");
    m = manifest(); m.runId = "Bad Run"; assert.strictEqual(code(S.validateManifest(m)), "PATTERN");
    m = manifest(); m.commit = "XYZ"; assert.ok(!S.validateManifest(m).ok);
    assert.ok(!S.validateManifest(null).ok && !S.validateManifest([]).ok && !S.validateManifest("x").ok);
});

test("manifest: forbidden keys (parsed from JSON) rejected without pollution", () => {
    const m = JSON.parse('{"__proto__":{"polluted":1}}');
    assert.strictEqual(code(S.validateManifest(m)), "FORBIDDEN_KEY");
    const m2 = manifest(); m2.pages[0].fragment = JSON.parse('{"constructor":{"prototype":{"polluted":1}}}');
    assert.strictEqual(code(S.validateManifest(m2)), "FORBIDDEN_KEY");
    assert.strictEqual(({}).polluted, undefined);
});

test("manifest: depth max accepted, max+1 rejected", () => {
    const wrap = (n) => { let o = "x"; for (let i = 0; i < n; i++) o = { a: o }; return o; };
    // extra key is rejected for being unknown, but depth is checked first
    const m = manifest(); m.ref = wrap(5); // depth 6 total ($ -> ref -> ... )
    assert.notStrictEqual(code(S.validateManifest(m)), "TOO_DEEP");
    const m2 = manifest(); m2.ref = wrap(6);
    assert.strictEqual(code(S.validateManifest(m2)), "TOO_DEEP");
    let deep = "x"; for (let i = 0; i < 10000; i++) deep = [deep];
    const m3 = manifest(); m3.ref = deep;
    assert.strictEqual(code(S.validateManifest(m3)), "TOO_DEEP");
});

test("manifest: pages array max accepted, max+1 rejected", () => {
    const mk = (n) => { const m = manifest(); const p = m.pages[0];
        m.pages = Array.from({ length: n }, (_, i) => ({ ...p, ordinal: i, fragment: { ...p.fragment, name: `page-${i}.json` }, journal: { ...p.journal, name: `page-${i}.json` } }));
        return m; };
    // 1000 pages exceeds the 256 KiB manifest budget? check explicitly
    const r = S.validateManifest(mk(Limits.MANIFEST_MAX_ARRAY));
    assert.ok(r.ok || r.code === "TOO_LARGE", r.code);
    assert.strictEqual(code(S.validateManifest(mk(Limits.MANIFEST_MAX_ARRAY + 1))), "ARRAY_TOO_LONG");
});

test("manifest: string max accepted, max+1 rejected; control chars rejected", () => {
    const m = manifest(); m.pages[0].url = "https://example.test/" + "a".repeat(Limits.MANIFEST_MAX_STRING - 21);
    assert.strictEqual(S.validateManifest(m).ok, true);
    m.pages[0].url += "a";
    assert.strictEqual(code(S.validateManifest(m)), "STRING_TOO_LONG");
    const c = manifest(); c.ref = "feat\nure"; assert.strictEqual(code(S.validateManifest(c)), "CONTROL_CHAR");
});

test("manifest: byte size max accepted, max+1 rejected", () => {
    const base = manifest();
    const sizeOf = (m) => Buffer.byteLength(JSON.stringify(m));
    // pad using many pages' urls (each <=2048) to reach the cap exactly
    const m = manifest();
    const p0 = m.pages[0];
    m.pages = Array.from({ length: 150 }, (_, i) => ({ ...p0, ordinal: i, url: "https://example.test/", fragment: { ...p0.fragment, name: `page-${i}.json` }, journal: { ...p0.journal, name: `page-${i}.json` } }));
    const need = Limits.MANIFEST_MAX_BYTES - sizeOf(m);
    assert.ok(need > 0 && need < 1500 * 150);
    // spread padding over page urls (each up to 2048 chars)
    let left = need, i = 0;
    while (left > 0) { const add = Math.min(left, 1800); m.pages[i].url += "a".repeat(add); left -= add; i++; }
    assert.strictEqual(sizeOf(m), Limits.MANIFEST_MAX_BYTES);
    assert.strictEqual(S.validateManifest(m).ok, true);
    m.pages[i - 1].url += "a";
    assert.strictEqual(code(S.validateManifest(m)), "TOO_LARGE");
    assert.ok(base);
});

test("fragment: valid accepted; unknown keys and secrets in fields rejected", () => {
    assert.strictEqual(S.validateFragment(fragment()).ok, true);
    for (const k of ["cookie", "authorization", "storageState", "value", "apiKey", "headers", "stack"]) {
        const f = fragment(); f.results[0][k] = "CANARY"; assert.strictEqual(code(S.validateFragment(f)), "UNKNOWN_KEY", k);
        const g = fragment(); g[k] = "CANARY"; assert.strictEqual(code(S.validateFragment(g)), "UNKNOWN_KEY", k);
        const u = fragment(); u.uiIssues[0][k] = "CANARY"; assert.strictEqual(code(S.validateFragment(u)), "UNKNOWN_KEY", k);
    }
});

test("fragment: row, error, uiIssue bounds accept max and reject max+1", () => {
    let f = fragment(); f.results = Array(Limits.FRAGMENT_MAX_ROWS).fill(fragment().results[0]);
    assert.strictEqual(S.validateFragment(f).ok, true);
    f.results.push(fragment().results[0]); assert.strictEqual(code(S.validateFragment(f)), "ARRAY_TOO_LONG");
    f = fragment(); f.results[0].error = "e".repeat(500); assert.strictEqual(S.validateFragment(f).ok, true);
    f.results[0].error = "e".repeat(501); assert.strictEqual(code(S.validateFragment(f)), "STRING_TOO_LONG");
    f = fragment(); f.uiIssues = Array(Limits.FRAGMENT_MAX_UI_ISSUES).fill({ type: "t", message: "m" });
    assert.strictEqual(S.validateFragment(f).ok, true);
    f.uiIssues.push({ type: "t", message: "m" }); assert.strictEqual(code(S.validateFragment(f)), "ARRAY_TOO_LONG");
    // per-issue 1 KiB: {"type":"t","message":"<n>"} has 28 bytes overhead; message cap 300 so use selector too
    f = fragment(); f.uiIssues = [{ type: "t".repeat(40), message: "m".repeat(300), selector: "s".repeat(300), severity: "s".repeat(20) }];
    assert.ok(Buffer.byteLength(JSON.stringify(f.uiIssues[0])) <= 1024);
    assert.strictEqual(S.validateFragment(f).ok, true);
    f.uiIssues[0].message += "m"; assert.strictEqual(code(S.validateFragment(f)), "STRING_TOO_LONG");
    f = fragment(); f.uiIssues[0].selector = "s".repeat(301); assert.strictEqual(code(S.validateFragment(f)), "STRING_TOO_LONG");
});

test("fragment: byte cap accepts max and rejects max+1", () => {
    const f = fragment();
    f.results = Array.from({ length: 1700 }, () => ({ scenario: "s", scn: 0, rep: 0, status: "passed", durationMs: 1, errorType: null, error: "e".repeat(500), description: "d" }));
    let left = Limits.FRAGMENT_MAX_BYTES - size(f), i = 0;
    assert.ok(left > 0);
    while (left > 0) {
        const r = f.results[i % f.results.length];
        const add = Math.min(left, 199 - (r.scenario.length - 1));
        if (add > 0) { r.scenario += "x".repeat(add); left -= add; }
        i++;
        assert.ok(i < 100000);
    }
    assert.strictEqual(size(f), Limits.FRAGMENT_MAX_BYTES);
    assert.strictEqual(S.validateFragment(f).ok, true);
    f.results[0].description += "d";
    assert.strictEqual(code(S.validateFragment(f)), "TOO_LARGE");
});

// ------------------------------------------------------------ journal events

const payloads = {
    "flakiness.outcome": { action: "click", locator: "#a", status: "passed", outcome: null, errorType: null, durationMs: 10, description: "d" },
    "healing.pending": { original: "#a", suggested: "#b", description: "d" },
    "healing.tier3": { original: "#a" },
    "healing.log": { original: "#a", resolved: null, tier: "LLM", description: "d" },
    "locatorStore.use": { original: "#a" },
    "locatorMemory.evidence": { identity: { k: "v" }, signature: { s: 1 } },
    "locatorMemory.candidate": { identity: { k: "v" }, candidate: { c: 1 }, baseRevision: null },
};

test("every event type: valid payload accepted", () => {
    for (const [t, p] of Object.entries(payloads)) assert.strictEqual(S.validateEventPayload(t, p).ok, true, t);
});

test("event types: unknown and decision types rejected", () => {
    for (const t of ["approve", "reject", "quarantine", "unquarantine", "rollback", "locatorStore.add", "healing.approve", "", "__proto__", "toString", null, 5]) {
        assert.strictEqual(code(S.validateEventPayload(t, {})), "EVENT_TYPE", String(t));
    }
    assert.ok(!S.EVENT_TYPES.some((t) => /approve|reject|quarantine|rollback|\.add$/.test(t)));
});

test("payload: missing key, unknown key, wrong type, bad enum", () => {
    for (const [t, p] of Object.entries(payloads)) {
        assert.strictEqual(code(S.validateEventPayload(t, { ...p, extra: 1 })), "UNKNOWN_KEY", t);
        const first = Object.keys(p)[0];
        const q = { ...p }; delete q[first];
        assert.strictEqual(code(S.validateEventPayload(t, q)), "MISSING_KEY", t);
        assert.ok(!S.validateEventPayload(t, null).ok && !S.validateEventPayload(t, []).ok);
    }
    assert.ok(!S.validateEventPayload("flakiness.outcome", { ...payloads["flakiness.outcome"], action: "hover" }).ok);
    assert.ok(!S.validateEventPayload("flakiness.outcome", { ...payloads["flakiness.outcome"], status: "skipped" }).ok);
    assert.ok(!S.validateEventPayload("flakiness.outcome", { ...payloads["flakiness.outcome"], outcome: "other" }).ok);
    assert.ok(!S.validateEventPayload("flakiness.outcome", { ...payloads["flakiness.outcome"], errorType: "Bad Type" }).ok);
    assert.ok(!S.validateEventPayload("healing.log", { ...payloads["healing.log"], tier: "Admin" }).ok);
});

test("payload: selector 300/301, description 120/121, error 300/301, reason 100/101, duration bounds", () => {
    const sel = (n) => "#" + "a".repeat(n - 1);
    assert.strictEqual(S.validateEventPayload("healing.tier3", { original: sel(300) }).ok, true);
    assert.strictEqual(code(S.validateEventPayload("healing.tier3", { original: sel(301) })), "STRING_TOO_LONG");
    assert.strictEqual(code(S.validateEventPayload("healing.tier3", { original: "" })), "STRING_TOO_SHORT");
    const d = (n) => ({ ...payloads["healing.pending"], description: "d".repeat(n) });
    assert.strictEqual(S.validateEventPayload("healing.pending", d(120)).ok, true);
    assert.strictEqual(code(S.validateEventPayload("healing.pending", d(121))), "STRING_TOO_LONG");
    const l = (extra) => ({ ...payloads["healing.log"], ...extra });
    assert.strictEqual(S.validateEventPayload("healing.log", l({ error: "e".repeat(300) })).ok, true);
    assert.ok(!S.validateEventPayload("healing.log", l({ error: "e".repeat(301) })).ok);
    assert.strictEqual(S.validateEventPayload("healing.log", l({ reason: "r".repeat(100) })).ok, true);
    assert.ok(!S.validateEventPayload("healing.log", l({ reason: "r".repeat(101) })).ok);
    const f = (n) => ({ ...payloads["flakiness.outcome"], durationMs: n });
    assert.strictEqual(S.validateEventPayload("flakiness.outcome", f(3600000)).ok, true);
    assert.strictEqual(code(S.validateEventPayload("flakiness.outcome", f(3600001))), "OUT_OF_RANGE");
    assert.ok(!S.validateEventPayload("flakiness.outcome", f(-1)).ok);
    assert.ok(!S.validateEventPayload("flakiness.outcome", f(1.5)).ok);
    assert.ok(!S.validateEventPayload("flakiness.outcome", f(Infinity)).ok);
    assert.ok(!S.validateEventPayload("flakiness.outcome", f(NaN)).ok);
});

test("payload: control characters rejected", () => {
    for (const ch of ["\n", "\r", "\t", "\u0000", "\u001b", "\u007f", "\u0085"]) {
        assert.strictEqual(code(S.validateEventPayload("healing.pending", { ...payloads["healing.pending"], description: `a${ch}b` })), "CONTROL_CHAR");
        assert.strictEqual(code(S.validateEventPayload("healing.tier3", { original: `#a${ch}` })), "CONTROL_CHAR");
    }
});

test("payload: forbidden keys and 10k nesting rejected without pollution", () => {
    const p = { identity: JSON.parse('{"__proto__":{"polluted":1}}'), signature: {} };
    assert.strictEqual(code(S.validateEventPayload("locatorMemory.evidence", p)), "FORBIDDEN_KEY");
    const q = { identity: { a: [{ b: JSON.parse('{"constructor":1}') }] }, signature: {} };
    assert.strictEqual(code(S.validateEventPayload("locatorMemory.evidence", q)), "FORBIDDEN_KEY");
    const r = { identity: { prototype: 1 }, signature: {} };
    assert.strictEqual(code(S.validateEventPayload("locatorMemory.evidence", r)), "FORBIDDEN_KEY");
    let deep = {}; let cur = deep; for (let i = 0; i < 10000; i++) { cur.a = {}; cur = cur.a; }
    assert.strictEqual(code(S.validateEventPayload("locatorMemory.evidence", { identity: deep, signature: {} })), "TOO_DEEP");
    assert.strictEqual(({}).polluted, undefined);
});

test("payload: default 8192-byte cap accepts max, rejects max+1", () => {
    const p = evidenceOf(8192);
    assert.strictEqual(size(p), 8192);
    assert.strictEqual(S.validateEventPayload("locatorMemory.evidence", p).ok, true);
    const q = evidenceOf(8193);
    assert.strictEqual(code(S.validateEventPayload("locatorMemory.evidence", q)), "PAYLOAD_TOO_LARGE");
});

test("locatorMemory.candidate: 12000-byte candidate accepted, 12001 rejected", () => {
    const cand = fitObj(12000);
    assert.strictEqual(S.validateEventPayload("locatorMemory.candidate", { identity: { a: 1 }, candidate: cand, baseRevision: H64 }).ok, true);
    const over = fitObj(12001);
    assert.strictEqual(code(S.validateEventPayload("locatorMemory.candidate", { identity: { a: 1 }, candidate: over, baseRevision: null })), "TOO_LARGE");
});

test("locatorMemory: depth 6 accepted / 7 rejected, array 50 / 51, identity type, baseRevision", () => {
    const nest = (n) => { let o = 1; for (let i = 0; i < n; i++) o = { a: o }; return o; };
    // payload root is depth 1, signature depth 2, so nest(5) reaches depth 6
    assert.strictEqual(S.validateEventPayload("locatorMemory.evidence", { identity: {}, signature: nest(5) }).ok, true);
    assert.strictEqual(code(S.validateEventPayload("locatorMemory.evidence", { identity: {}, signature: nest(6) })), "TOO_DEEP");
    assert.strictEqual(S.validateEventPayload("locatorMemory.evidence", { identity: {}, signature: { a: Array(50).fill(1) } }).ok, true);
    assert.strictEqual(code(S.validateEventPayload("locatorMemory.evidence", { identity: {}, signature: { a: Array(51).fill(1) } })), "ARRAY_TOO_LONG");
    assert.strictEqual(code(S.validateEventPayload("locatorMemory.evidence", { identity: {}, signature: { a: "x".repeat(2049) } })), "STRING_TOO_LONG");
    assert.ok(!S.validateEventPayload("locatorMemory.evidence", { identity: [], signature: {} }).ok);
    assert.ok(!S.validateEventPayload("locatorMemory.candidate", { identity: {}, candidate: {}, baseRevision: "abc" }).ok);
});

test("canaries in disallowed fields are never accepted", () => {
    const canaries = {
        cookie: "session=CANARY-COOKIE", authorization: "Bearer CANARY-AUTH", storageState: { cookies: [{ value: "CANARY-STATE" }] },
        value: "CANARY-INPUT-VALUE", apiKey: ["sk", "CANARY" + "0".repeat(28)].join("-"), stack: "Error: x\n at CANARY",
    };
    for (const [t, p] of Object.entries(payloads)) {
        for (const [k, v] of Object.entries(canaries)) {
            assert.strictEqual(S.validateEventPayload(t, { ...p, [k]: v }).ok, false, `${t}.${k}`);
        }
    }
    // control-char-bearing free text (stack-like) is refused in capped fields too
    assert.strictEqual(code(S.validateEventPayload("healing.log", { ...payloads["healing.log"], error: "Error: x\n    at CANARY (file.js:1)" })), "CONTROL_CHAR");
});

// ------------------------------------------------------------ envelope

function journal(n = 2) {
    const j = new StateJournal(hdr());
    for (let i = 0; i < n; i++) j.record("healing.tier3", i, 0, { original: "#a" + i });
    return JSON.parse(JSON.stringify(j.finish("ok")));
}
const resign = (env) => { env.count = env.events.length; env.digest = S.sha256(S.canonicalJson(env.events)); return env; };

test("journal: valid accepted", () => assert.strictEqual(S.validateJournal(journal()).ok, true));

test("journal: structural tamper rejected", () => {
    let e = journal(); e.events[0].p.original = "#zzz"; assert.strictEqual(code(S.validateJournal(e)), "DIGEST_MISMATCH");
    e = journal(); e.digest = "0".repeat(64); assert.strictEqual(code(S.validateJournal(e)), "DIGEST_MISMATCH");
    e = journal(); e.events[1].seq = 5; assert.strictEqual(code(S.validateJournal(e)), "SEQ");
    e = journal(); e.count = 99; assert.strictEqual(code(S.validateJournal(e)), "COUNT_MISMATCH");
    e = journal(); e.events.pop(); resign(e); assert.strictEqual(code(S.validateJournal(e)), "TASK_END_MISSING");
    e = journal(); e.events[0].id = "f".repeat(32); assert.strictEqual(code(S.validateJournal(e)), "EVENT_ID");
    e = journal(); e.events[2].p.eventCount = 1; resign(e); assert.strictEqual(code(S.validateJournal(e)), "COUNT_MISMATCH");
    e = journal(); e.extra = 1; assert.strictEqual(code(S.validateJournal(e)), "UNKNOWN_KEY");
    e = journal(); e.events[0].extra = 1; assert.strictEqual(code(S.validateJournal(e)), "UNKNOWN_KEY");
    e = journal(); e.events = []; e.count = 0; assert.strictEqual(code(S.validateJournal(e)), "EVENTS_EMPTY");
    e = journal(); e.runId = "BAD"; assert.strictEqual(code(S.validateJournal(e)), "PATTERN");
    assert.ok(!S.validateJournal(null).ok && !S.validateJournal([]).ok);
});

test("journal: task.end not last rejected; unknown/decision event types rejected in envelopes", () => {
    let e = journal(1);
    const end = e.events[1];
    e.events.splice(1, 0, { ...end });
    assert.ok(!S.validateJournal(resign(e)).ok);
    for (const t of ["approve", "reject", "quarantine", "rollback", "bogus"]) {
        e = journal(1); e.events[0].type = t; resign(e);
        assert.strictEqual(code(S.validateJournal(e)), "ENUM", t);
    }
});

test("journal: forbidden key in event payload rejected", () => {
    const e = journal(1);
    e.events[0].type = "locatorMemory.evidence";
    e.events[0].p = { identity: JSON.parse('{"__proto__":{"polluted":1}}'), signature: {} };
    assert.ok(!S.validateJournal(resign(e)).ok);
    assert.strictEqual(({}).polluted, undefined);
});

test("journal: event-count cap max accepted, max+1 rejected", () => {
    const build = (n) => {
        const j = new StateJournal(hdr());
        for (let i = 0; i < n; i++) j.record("healing.tier3", 0, 0, { original: "#a" });
        return JSON.parse(JSON.stringify(j.finish("ok")));
    };
    assert.strictEqual(S.validateJournal(build(Limits.JOURNAL_MAX_EVENTS - 1)).ok, true);
    const over = build(Limits.JOURNAL_MAX_EVENTS - 2);
    // synthesise max+1 by appending one more event and re-signing
    const e = over;
    e.events.splice(e.events.length - 1, 0, { ...e.events[0] });
    e.events.forEach((x, i) => { x.seq = i + 1; x.id = S.eventId(e.runId, e.pageOrdinal, x.scn, x.rep, x.type, x.seq); });
    e.events[e.events.length - 1].p.eventCount = e.events.length - 1;
    resign(e);
    assert.strictEqual(S.validateJournal(e).ok, true, "exactly max");
    const x = { ...e.events[0] };
    e.events.splice(e.events.length - 1, 0, x);
    e.events.forEach((y, i) => { y.seq = i + 1; y.id = S.eventId(e.runId, e.pageOrdinal, y.scn, y.rep, y.type, y.seq); });
    e.events[e.events.length - 1].p.eventCount = e.events.length - 1;
    resign(e);
    assert.strictEqual(code(S.validateJournal(e)), "ARRAY_TOO_LONG");
});

test("journal: byte cap accepts max (2 MiB), rejects max+1", () => {
    const N = 252;
    const build = (lastTarget) => {
        const env = journal(1);
        const at = env.events[0].at;
        env.events = Array.from({ length: N }, (_, i) => ({ seq: i + 1, id: "", type: "locatorMemory.evidence", scn: 0, rep: 0, at, p: evidenceOf(i === N - 1 ? lastTarget : 8192) }));
        env.events.push({ seq: N + 1, id: "", type: "task.end", scn: null, rep: null, at, p: { status: "ok", eventCount: N } });
        env.events.forEach((x) => { x.id = S.eventId(env.runId, env.pageOrdinal, x.scn, x.rep, x.type, x.seq); });
        return resign(env);
    };
    const probe = build(8192);
    const excess = size(probe) - Limits.JOURNAL_MAX_BYTES;
    assert.ok(excess > 0 && excess < 8000, String(excess));
    const atCap = build(8192 - excess);
    assert.strictEqual(size(atCap), Limits.JOURNAL_MAX_BYTES);
    assert.strictEqual(S.validateJournal(atCap).ok, true);
    const over = build(8192 - excess + 1);
    assert.strictEqual(size(over), Limits.JOURNAL_MAX_BYTES + 1);
    assert.strictEqual(code(S.validateJournal(over)), "TOO_LARGE");
});
