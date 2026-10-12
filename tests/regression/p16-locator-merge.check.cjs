const test = require("node:test");
const assert = require("node:assert");
const { reduceLocatorMemory } = require("../../src/core/parallel/LocatorMemoryMerge");
const V = require("../../src/core/locator/LocatorMemoryValidation");
const Identity = require("../../src/core/locator/LocatorIdentity");
const Signature = require("../../src/core/locator/ElementSignature");

const RUN = "run-aaaaaa";
const SNAP = "2026-02-03T04:05:06.000Z";
const at = (n) => new Date(Date.parse(SNAP) + n * 1000).toISOString();
const J = (v) => JSON.stringify(v);
const ident = (sel = "#go") => ({ schemaVersion: Identity.SCHEMA_VERSION, applicationId: "app", origin: "https://x.test", pathname: "/a", action: "click", originalSelector: sel });
const sig = (tag = "button") => ({ schemaVersion: Signature.SCHEMA_VERSION, capturedAt: SNAP, tagName: tag, role: null, accessibleNameApprox: null, attributes: {}, structuralPath: [], textApprox: null, boundingBoxBucket: null });
const cand = (sel) => ({ selector: sel, signature: sig("a") });
const pid = (sel) => V.proposal(cand(sel)).proposalId;
const KEY = Identity.serialiseIdentity(ident());
let n = 0;
const ev = (type, p, o = {}) => ({ pageOrdinal: o.page ?? 0, seq: ++n, id: o.id ?? `e${n}`, type, scn: null, rep: null, at: o.at ?? at(n), p });
const evid = (o, s = sig()) => ev("locatorMemory.evidence", { identity: ident(), signature: s }, o);
const ecand = (sel, o) => ev("locatorMemory.candidate", { identity: ident(), candidate: cand(sel), baseRevision: null }, o);
const env = (entries = {}, extra = {}) => ({ schemaVersion: 1, saltFingerprint: "f", saltSource: "env", entries, legacy: {}, rejections: [], ...extra });
const entry = (o = {}) => ({ identity: ident(), approvedAlternative: null, decisionHistory: [], trust: "trusted", signature: sig("div"), pendingCandidate: null, firstSeen: at(-100), lastSeen: at(-100), revocationHistory: [], ...o });
const codes = (r) => r.conflicts.map((c) => c.code);
const run = (e, evs, o) => reduceLocatorMemory(e, evs, RUN, SNAP, o);
const shuffle = (arr, seed) => { const a = [...arr]; let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const approved = (sel) => ({ ...V.proposal(cand(sel)), firstSeen: at(-50), lastSeen: at(-50), occurrences: 1, actor: "h", approvedAt: at(-50) });
const approveRow = (a) => ({ kind: "approve", actor: "h", at: a });

test("row 1: absent + evidence creates trusted; firstSeen min, lastSeen max", () => {
    const r = run(env(), [evid({ at: at(5) }, sig("b")), evid({ at: at(2) }, sig("c"))]);
    const e = r.envelope.entries[KEY];
    assert.deepStrictEqual([e.trust, e.signature.tagName, e.firstSeen, e.lastSeen, e.pendingCandidate, e.revocationHistory], ["trusted", "c", at(2), at(5), null, []]);
    assert.deepStrictEqual(r.conflicts, []);
});

test("row 2: absent + candidates only creates unproven; occurrences = distinct ids of the winning proposal", () => {
    const r = run(env(), [ecand("#a", { at: at(1) }), ecand("#b", { at: at(2), id: "x" }), ecand("#b", { at: at(3), id: "y" })]);
    const e = r.envelope.entries[KEY];
    assert.deepStrictEqual([e.trust, e.signature, e.pendingCandidate.selector, e.pendingCandidate.occurrences, e.pendingCandidate.firstSeen, e.pendingCandidate.lastSeen], ["unproven", null, "#b", 2, at(2), at(3)]);
});

test("row 3: trusted + evidence refreshes signature/lastSeen only", () => {
    const base = entry({ approvedAlternative: approved("#ok"), decisionHistory: [approveRow(at(-60))] });
    const r = run(env({ [KEY]: base }), [evid({ at: at(4) }, sig("span"))]);
    const e = r.envelope.entries[KEY];
    assert.deepStrictEqual([e.trust, e.signature.tagName, e.lastSeen, e.firstSeen], ["trusted", "span", at(4), at(-100)]);
    assert.deepStrictEqual([e.approvedAlternative, e.decisionHistory], [base.approvedAlternative, base.decisionHistory]);
    assert.deepStrictEqual(r.conflicts, []);
});

test("row 4: trusted + candidate equal to the approved proposal is a no-op", () => {
    const base = entry({ approvedAlternative: approved("#ok"), decisionHistory: [approveRow(at(-60))] });
    const r = run(env({ [KEY]: base }), [ecand("#ok", { at: at(9) })]);
    assert.strictEqual(J(r.envelope.entries[KEY]), J(base));
    assert.deepStrictEqual(r.conflicts, []);
});

test("row 5: trusted + other proposal sets pendingCandidate, merges counts, trust unchanged", () => {
    const prior = { ...V.proposal(cand("#n")), firstSeen: at(-20), lastSeen: at(-10), occurrences: 3 };
    const base = entry({ pendingCandidate: prior, approvedAlternative: approved("#ok"), decisionHistory: [approveRow(at(-60))] });
    const r = run(env({ [KEY]: base }), [ecand("#n", { at: at(2) })]);
    const e = r.envelope.entries[KEY];
    assert.deepStrictEqual([e.trust, e.pendingCandidate.occurrences, e.pendingCandidate.firstSeen, e.pendingCandidate.lastSeen], ["trusted", 4, at(-20), at(2)]);
    const r2 = run(env({ [KEY]: base }), [ecand("#different", { at: at(2) })]);
    assert.strictEqual(r2.envelope.entries[KEY].pendingCandidate.selector, "#different");
    assert.strictEqual(r2.envelope.entries[KEY].pendingCandidate.occurrences, 1);
});

test("row 6: unproven + evidence stays unproven, signature not installed", () => {
    const base = entry({ trust: "unproven", signature: null });
    const r = run(env({ [KEY]: base }), [evid()]);
    assert.strictEqual(r.envelope.entries[KEY].trust, "unproven");
    assert.strictEqual(r.envelope.entries[KEY].signature, null);
    assert.deepStrictEqual(codes(r), ["evidence_on_unproven_deferred"]);
});

test("row 7: unproven + candidate updates pendingCandidate", () => {
    const base = entry({ trust: "unproven", signature: null });
    const r = run(env({ [KEY]: base }), [ecand("#z", { at: at(3) })]);
    assert.deepStrictEqual([r.envelope.entries[KEY].trust, r.envelope.entries[KEY].pendingCandidate.selector, r.envelope.entries[KEY].lastSeen], ["unproven", "#z", at(3)]);
    assert.deepStrictEqual(r.conflicts, []);
});

test("row 8: revoked + evidence is ignored and the entry is unchanged", () => {
    const base = entry({ trust: "revoked", revocationHistory: [{ actor: "h", at: at(-5) }] });
    const r = run(env({ [KEY]: base }), [evid()]);
    assert.strictEqual(J(r.envelope.entries[KEY]), J(base));
    assert.deepStrictEqual(codes(r), ["evidence_on_revoked_ignored"]);
});

test("row 9: revoked + candidate is ignored and the entry is unchanged", () => {
    const base = entry({ trust: "revoked", revocationHistory: [{ actor: "h", at: at(-5) }] });
    const r = run(env({ [KEY]: base }), [ecand("#z")]);
    assert.strictEqual(J(r.envelope.entries[KEY]), J(base));
    assert.deepStrictEqual(codes(r), ["candidate_on_revoked_ignored"]);
});

test("row 10: human decision after snapshotAt drops evidence and candidates as stale (any trust)", () => {
    for (const trust of ["trusted", "unproven"]) {
        const base = entry({ trust, signature: trust === "trusted" ? sig("div") : null, decisionHistory: [approveRow(at(-60)), { kind: "reject", actor: "h", at: at(50) }] });
        const r = run(env({ [KEY]: base }), [evid(), ecand("#late")]);
        assert.strictEqual(J(r.envelope.entries[KEY]), J(base));
        assert.deepStrictEqual(codes(r), ["stale_after_decision", "stale_after_decision"]);
    }
    const before = entry({ decisionHistory: [approveRow(at(-60)), { kind: "reject", actor: "h", at: at(-1) }] });
    assert.deepStrictEqual(codes(run(env({ [KEY]: before }), [evid()])), [], "decision before snapshot is not stale");
});

test("row 11: two candidates with different proposalIds keep only the last in global order", () => {
    const r = run(env(), [ecand("#a", { at: at(1) }), ecand("#b", { at: at(2) })]);
    assert.strictEqual(r.envelope.entries[KEY].pendingCandidate.proposalId, pid("#b"));
    assert.deepStrictEqual(codes(r), ["candidate_superseded"]);
    assert.strictEqual(r.conflicts[0].key, KEY);
});

test("row 12: trusted with a revocation not older than the last approve (or unparseable/equal) fails closed", () => {
    const cases = [
        { decisionHistory: [approveRow(at(-60))], revocationHistory: [{ actor: "h", at: at(-30) }] },
        { decisionHistory: [approveRow(at(-60))], revocationHistory: [{ actor: "h", at: at(-60) }] },
        { decisionHistory: [approveRow(at(-60))], revocationHistory: [{ actor: "h", at: "garbage" }] },
        { decisionHistory: [], revocationHistory: [{ actor: "h", at: at(-30) }] },
    ];
    for (const c of cases) {
        const base = entry(c);
        const r = run(env({ [KEY]: base }), [evid(), ecand("#n")]);
        assert.strictEqual(J(r.envelope.entries[KEY]), J(base), "entry left unchanged");
        assert.deepStrictEqual(codes(r), ["revocation_conflict_failed_closed"]);
        assert.strictEqual(r.conflicts[0].requiresRevocation, true);
    }
    const ok = entry({ decisionHistory: [approveRow(at(-10))], revocationHistory: [{ actor: "h", at: at(-30) }] });
    assert.deepStrictEqual(codes(run(env({ [KEY]: ok }), [evid()])), []);
});

test("row 13: blocked envelope (schema, oversize, caller-detected salt) is returned untouched with envelope_blocked", () => {
    const bad = env({}, { schemaVersion: 99 });
    const r = run(bad, [evid()]);
    assert.strictEqual(r.envelope, bad);
    assert.deepStrictEqual([r.blocked, r.changed, codes(r)], [true, false, ["envelope_blocked"]]);
    assert.strictEqual(run(null, [evid()]).blocked, true);
    const salty = env();
    assert.strictEqual(run(salty, [evid()], { blocked: "salt_mismatch" }).envelope, salty);
    const big = env({ x: { pad: "p".repeat(V.MAX_BYTES + 10) } });
    assert.strictEqual(run(big, [evid()]).blocked, true);
});

test("never raises trust of an existing entry; human decision in canonical beats worker events", () => {
    for (const trust of ["unproven", "revoked"]) {
        const base = entry({ trust, signature: null, revocationHistory: trust === "revoked" ? [{ actor: "h", at: at(-5) }] : [] });
        const r = run(env({ [KEY]: base }), [evid(), ecand("#c"), evid()]);
        assert.strictEqual(r.envelope.entries[KEY].trust, trust);
        assert.strictEqual(r.envelope.entries[KEY].signature, null);
    }
    const human = entry({ decisionHistory: [approveRow(at(-60))], approvedAlternative: approved("#human") });
    const r = run(env({ [KEY]: human }), [ecand("#human"), ecand("#other", { at: at(1) })]);
    assert.strictEqual(r.envelope.entries[KEY].approvedAlternative.selector, "#human");
    assert.strictEqual(r.envelope.entries[KEY].trust, "trusted");
});

test("replay twice is byte-identical; mergedRuns FIFO 8; input not mutated", () => {
    const base = env({ [KEY]: entry({ trust: "unproven", signature: null }) });
    const before = J(base);
    const evs = [evid(), ecand("#a", { at: at(1) }), ecand("#b", { at: at(2) })];
    const first = run(base, evs);
    assert.strictEqual(J(base), before);
    const second = run(first.envelope, evs);
    assert.strictEqual(J(second.envelope), J(first.envelope));
    assert.deepStrictEqual([second.changed, second.conflicts], [false, []]);
    let e = env();
    for (let i = 0; i < 10; i++) e = reduceLocatorMemory(e, [evid()], `run-${i}00000`, SNAP).envelope;
    assert.strictEqual(e.mergedRuns.length, 8);
    assert.strictEqual(e.mergedRuns[7], "run-900000");
});

test("shuffled/reversed input gives identical output and conflicts", () => {
    const k2 = Identity.serialiseIdentity(ident("#other"));
    const evs = [evid({ at: at(1) }), ecand("#a", { at: at(2) }), ecand("#b", { at: at(3) }), ev("locatorMemory.evidence", { identity: ident("#other"), signature: sig() }, { at: at(4) })];
    const base = env({ [KEY]: entry({ trust: "unproven", signature: null }) });
    const a = run(base, evs);
    for (const input of [[...evs].reverse(), shuffle(evs, 3), shuffle(evs, 99)]) {
        const b = run(base, input);
        assert.strictEqual(J(b), J(a));
    }
    assert.ok(a.envelope.entries[k2]);
});

test("cap: 500 identities evicted by (lastSeen, key) after merge, independent of arrival", () => {
    const entries = {};
    for (let i = 0; i < 500; i++) {
        const id = ident(`#s${String(i).padStart(3, "0")}`);
        entries[Identity.serialiseIdentity(id)] = entry({ identity: id, lastSeen: at(1000 + i) });
    }
    const oldest = Identity.serialiseIdentity(ident("#s000"));
    const evs = [evid({ at: at(5000) }), ev("locatorMemory.evidence", { identity: ident("#new2"), signature: sig() }, { at: at(5001) })];
    const a = run(env(entries), evs);
    const b = run(env(entries), [...evs].reverse());
    assert.strictEqual(J(a), J(b));
    assert.strictEqual(Object.keys(a.envelope.entries).length, 500);
    assert.strictEqual(a.evicted[0], oldest);
    assert.strictEqual(a.evicted.length, 2);
});

test("invalid events are dropped with a conflict, never throw", () => {
    const bad = ev("locatorMemory.evidence", { identity: { nope: 1 }, signature: sig() });
    const r = run(env(), [bad, evid()]);
    assert.deepStrictEqual(codes(r), ["invalid_event_dropped"]);
    assert.ok(r.envelope.entries[KEY]);
});
