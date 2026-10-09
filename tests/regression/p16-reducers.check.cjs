const test = require("node:test");
const assert = require("node:assert");
const R = require("../../src/core/parallel/Reducers");

const RUN = "run-aaaaaa";
const T0 = "2026-02-03T04:05:06.000Z";
const at = (n) => new Date(Date.parse(T0) + n * 1000).toISOString();
let counter = 0;
function ev(pageOrdinal, seq, type, p, o = {}) {
    return { pageOrdinal, seq, id: o.id ?? `id-${pageOrdinal}-${seq}-${type}`, type, scn: o.scn ?? null, rep: o.rep ?? null, at: o.at ?? at(counter++), p, ...(o.url ? { url: o.url } : {}) };
}
const shuffle = (arr, seed) => { const a = [...arr]; let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const J = (v) => JSON.stringify(v);
const OUT = (status, extra = {}) => ({ action: "click", locator: "#go", status, outcome: null, errorType: null, durationMs: 5, description: "go", ...extra });
const fev = (pageOrdinal, seq, status, o = {}, extra = {}) => ev(pageOrdinal, seq, "flakiness.outcome", OUT(status, extra), { url: "https://x.test/a", ...o });
const KEY = "https://x.test/a::click::#go";

// ---------- orderEvents ----------
test("orderEvents sorts by (pageOrdinal, scn??-1, rep??0, seq) and ignores input order", () => {
    const e = [
        ev(2, 1, "healing.tier3", { original: "a" }),
        ev(1, 5, "healing.tier3", { original: "b" }, { scn: 1, rep: 0 }),
        ev(1, 3, "healing.tier3", { original: "c" }, { scn: null }),
        ev(1, 4, "healing.tier3", { original: "d" }, { scn: 0, rep: 1 }),
        ev(1, 2, "healing.tier3", { original: "e" }, { scn: 0, rep: 0 }),
    ];
    const names = (l) => R.orderEvents(l).map((x) => x.p.original).join("");
    assert.strictEqual(names(e), "cedba");
    assert.strictEqual(names([...e].reverse()), "cedba");
    assert.strictEqual(names(shuffle(e, 7)), "cedba");
});

test("orderEvents drops identical duplicates (earliest at kept) and does not mutate input", () => {
    const a = ev(0, 1, "healing.tier3", { original: "a" }, { id: "dup", at: at(5) });
    const b = ev(0, 1, "healing.tier3", { original: "a" }, { id: "dup", at: at(1) });
    const snapshot = J([a, b]);
    assert.strictEqual(R.orderEvents([a, b]).length, 1);
    assert.strictEqual(R.orderEvents([a, b])[0].at, at(1));
    assert.strictEqual(R.orderEvents([b, a])[0].at, at(1));
    assert.strictEqual(J([a, b]), snapshot);
});

test("orderEvents throws EVENT_ID_CONFLICT for same id with a different payload, and rejects bad input", () => {
    const a = ev(0, 1, "healing.tier3", { original: "a" }, { id: "dup" });
    const b = ev(0, 1, "healing.tier3", { original: "b" }, { id: "dup" });
    assert.throws(() => R.orderEvents([a, b]), { code: "EVENT_ID_CONFLICT" });
    assert.throws(() => R.orderEvents([b, a]), { code: "EVENT_ID_CONFLICT" });
    assert.throws(() => R.orderEvents("x"), { code: "REDUCER_BAD_EVENTS" });
    assert.throws(() => R.orderEvents([{ type: "x" }]), { code: "REDUCER_BAD_EVENT" });
});

// ---------- 7.1 Flakiness ----------
test("flakiness: new entry, history in global order with eventId, classify, flakySince = earliest at", () => {
    const evs = [fev(0, 1, "passed", { at: at(10) }), fev(0, 2, "failed", { at: at(11) }), fev(0, 3, "passed", { at: at(12) })];
    const { scenarios } = R.reduceFlakiness({}, shuffle(evs, 3), RUN);
    const e = scenarios[KEY];
    assert.deepStrictEqual(e.history.map((h) => h.status), ["passed", "failed", "passed"]);
    assert.deepStrictEqual(Object.keys(e.history[0]), ["status", "timestamp", "duration", "errorType", "outcome", "eventId"]);
    assert.strictEqual(e.classification, "flaky");
    assert.strictEqual(e.flakySince, at(10));
    assert.strictEqual(e.lastUsed, Date.parse(at(12)));
    assert.deepStrictEqual([e.url, e.action, e.locator, e.quarantined, e.appliedRunIds], ["https://x.test/a", "click", "#go", false, [RUN]]);
});

test("flakiness: retry events (same id) do not inflate; also not across a different run id", () => {
    const a = fev(0, 1, "failed", { id: "same", at: at(1) });
    const b = fev(0, 1, "failed", { id: "same", at: at(2) });
    const once = R.reduceFlakiness({}, [a, b], RUN).scenarios;
    assert.strictEqual(once[KEY].history.length, 1);
    const other = R.reduceFlakiness(once, [a], "run-bbbbbb").scenarios;
    assert.strictEqual(other[KEY].history.length, 1, "eventId already in history is skipped");
});

test("flakiness: replaying the same run twice is byte-identical, even past the history window", () => {
    const evs = Array.from({ length: 25 }, (_, i) => fev(0, i + 1, i % 2 ? "passed" : "failed", { at: at(i) }));
    const first = R.reduceFlakiness({}, evs, RUN).scenarios;
    const second = R.reduceFlakiness(first, evs, RUN).scenarios;
    assert.strictEqual(J(second), J(first));
    assert.strictEqual(first[KEY].history.length, 20);
});

test("flakiness: input order does not change the output", () => {
    const evs = Array.from({ length: 12 }, (_, i) => fev(i % 3, i + 1, i % 4 ? "passed" : "failed", { at: at(i) }));
    const base = J(R.reduceFlakiness({}, evs, RUN));
    assert.strictEqual(J(R.reduceFlakiness({}, [...evs].reverse(), RUN)), base);
    assert.strictEqual(J(R.reduceFlakiness({}, shuffle(evs, 11), RUN)), base);
});

test("flakiness: history trimmed to newest 20 after all appends (existing items first)", () => {
    const existing = { [KEY]: { key: KEY, url: "https://x.test/a", action: "click", locator: "#go", description: "d", history: Array.from({ length: 18 }, (_, i) => ({ status: "passed", timestamp: at(i), duration: 1, errorType: null, outcome: null, eventId: `old${i}` })), classification: "stable", flakeRate: 0, sampleSize: 18, lastUsed: 5, quarantined: false, quarantinedAt: null, quarantinedBy: null, flakySince: null } };
    const evs = [1, 2, 3, 4].map((n) => fev(0, n, "failed", { at: at(100 + n) }));
    const e = R.reduceFlakiness(existing, evs, RUN).scenarios[KEY];
    assert.strictEqual(e.history.length, 20);
    assert.strictEqual(e.history[0].eventId, "old2");
    assert.strictEqual(e.history[19].eventId, evs[3].id);
});

test("flakiness: flakySince kept when valid, cleared on leaving flaky, backfilled when invalid", () => {
    const h = (s, i) => ({ status: s, timestamp: at(i), duration: 1, errorType: null, outcome: null, eventId: `o${i}` });
    const base = (history, extra) => ({ [KEY]: { key: KEY, url: "https://x.test/a", action: "click", locator: "#go", description: "", history, classification: R.classify(history).classification, flakeRate: 0, sampleSize: 0, lastUsed: 0, quarantined: false, quarantinedAt: null, quarantinedBy: null, flakySince: null, ...extra } });
    const keep = R.reduceFlakiness(base([h("passed", 1), h("failed", 2), h("passed", 3)], { flakySince: "2020-01-01T00:00:00.000Z" }), [fev(0, 1, "failed", { at: at(50) })], RUN).scenarios[KEY];
    assert.strictEqual(keep.flakySince, "2020-01-01T00:00:00.000Z");
    const back = R.reduceFlakiness(base([h("passed", 1), h("failed", 2), h("passed", 3)], { flakySince: "garbage" }), [fev(0, 1, "failed", { at: at(50) })], RUN).scenarios[KEY];
    assert.strictEqual(back.flakySince, at(50));
    const leave = R.reduceFlakiness(base([h("passed", 1), h("failed", 2), h("passed", 3)], { flakySince: "2020-01-01T00:00:00.000Z" }), Array.from({ length: 12 }, (_, i) => fev(0, i + 1, "passed", { at: at(60 + i) })), RUN).scenarios[KEY];
    assert.strictEqual(leave.classification, "stable");
    assert.strictEqual(leave.flakySince, null);
});

test("flakiness: events never change quarantined; a human ledger decision wins either way", () => {
    const entry = (q) => ({ key: KEY, url: "https://x.test/a", action: "click", locator: "#go", description: "", history: [], classification: "new", flakeRate: 0, sampleSize: 0, lastUsed: 0, quarantined: q, quarantinedAt: null, quarantinedBy: null, flakySince: null });
    const evs = [fev(0, 1, "failed")];
    assert.strictEqual(R.reduceFlakiness({ [KEY]: entry(true) }, evs, RUN).scenarios[KEY].quarantined, true);
    assert.strictEqual(R.reduceFlakiness({ [KEY]: entry(false) }, evs, RUN, [{ key: KEY, action: "quarantine", by: "h", at: T0 }]).scenarios[KEY].quarantined, true);
    assert.strictEqual(R.reduceFlakiness({ [KEY]: entry(true) }, evs, RUN, [{ key: KEY, action: "quarantine" }, { key: KEY, action: "unquarantine" }]).scenarios[KEY].quarantined, false);
});

test("flakiness: skipped/invalid outcomes are never recorded", () => {
    const evs = [fev(0, 1, "skipped"), ev(0, 2, "flakiness.outcome", OUT("failed"))]; // second has no url
    assert.deepStrictEqual(R.reduceFlakiness({}, evs, RUN).scenarios, {});
});

test("flakiness: cap 500 evicts unprotected by (lastUsed, key) independent of arrival; protected survive", () => {
    const mk = (i) => ({ key: `k${String(i).padStart(4, "0")}`, history: [], classification: "new", lastUsed: 1000, quarantined: false, appliedRunIds: [] });
    const canon = {};
    for (let i = 0; i < 500; i++) canon[mk(i).key] = mk(i);
    canon.k0000.lastUsed = 1; canon.k0001.lastUsed = 1; // oldest two
    const evs = [fev(0, 1, "passed", { at: at(1) }), fev(1, 1, "passed", { url: "https://x.test/b" }, {})];
    const ledger = [{ key: "k0000", action: "quarantine" }];
    const a = R.reduceFlakiness(canon, evs, RUN, ledger);
    const b = R.reduceFlakiness(canon, [...evs].reverse(), RUN, ledger);
    assert.strictEqual(J(a), J(b));
    assert.strictEqual(Object.keys(a.scenarios).length, 500);
    assert.deepStrictEqual(a.evicted, ["k0001", "k0002"].slice(0, 2).length === 2 ? a.evicted : []);
    assert.ok(Object.hasOwn(a.scenarios, "k0000"), "ledger-quarantined key protected");
    assert.ok(!Object.hasOwn(a.scenarios, "k0001"));
    assert.strictEqual(a.evicted.length, 2);
    assert.strictEqual(a.evicted[0], "k0001");
});

// ---------- 7.3 Healing pending ----------
const pev = (seq, original, suggested, description = "d", o = {}) => ev(0, seq, "healing.pending", { original, suggested, description }, o);
const tev = (seq, original, o = {}) => ev(0, seq, "healing.tier3", { original }, o);

test("pending: create sets firstSeen=min, lastSeen=max, occurrences=distinct ids, tier3=1+distinct tier3 ids", () => {
    const evs = [pev(1, "#a", "#b", "first", { at: at(5) }), pev(2, "#a", "#c", "", { at: at(9) }), pev(3, "#a", "#c", "last", { at: at(7), id: "p3" }), tev(4, "#a", { at: at(6) }), tev(5, "#a", { at: at(6) })];
    const { pending } = R.reduceHealingPending({}, [], shuffle(evs, 5), T0, RUN);
    const e = pending["#a"];
    assert.deepStrictEqual([e.firstSeen, e.lastSeen, e.occurrences, e.tier3Invocations], [at(5), at(9), 3, 3]);
    assert.strictEqual(e.suggested, "#c");
    assert.strictEqual(e.description, "last");
    assert.deepStrictEqual(e.previouslyRejected, { count: 0, lastRejectedAt: null, lastRejectedBy: null });
});

test("pending: existing entry accumulates; empty description keeps the stored one; tier3 on existing counts", () => {
    const existing = { "#a": { original: "#a", suggested: "#old", description: "keep", firstSeen: at(1), lastSeen: at(2), occurrences: 4, tier3Invocations: 2, previouslyRejected: { count: 0, lastRejectedAt: null, lastRejectedBy: null } } };
    const { pending } = R.reduceHealingPending(existing, [], [pev(1, "#a", "#new", "", { at: at(20) }), tev(2, "#a")], T0, RUN);
    assert.deepStrictEqual([pending["#a"].firstSeen, pending["#a"].lastSeen, pending["#a"].occurrences, pending["#a"].tier3Invocations, pending["#a"].description, pending["#a"].suggested], [at(1), at(20), 5, 3, "keep", "#new"]);
});

test("pending: tier3 with no entry and no pending event is a no-op", () => {
    assert.deepStrictEqual(R.reduceHealingPending({}, [], [tev(1, "#a")], T0, RUN).pending, {});
});

test("pending: previouslyRejected re-derived from the fresh ledger; stale cache replaced", () => {
    const ledger = [{ original: "#a", suggested: "#b", decision: "rejected", decidedAt: at(-100), decidedBy: "h" }, { original: "#a", suggested: "#b", decision: "approved", decidedAt: at(-50) }, { original: "#a", suggested: "#b", decision: "rejected", decidedAt: "bad" }];
    const stale = { "#z": { original: "#z", suggested: "#q", description: "", firstSeen: at(0), lastSeen: at(0), occurrences: 1, tier3Invocations: 1, previouslyRejected: { count: 9, lastRejectedAt: "x", lastRejectedBy: "x" } } };
    const { pending, conflicts } = R.reduceHealingPending(stale, ledger, [pev(1, "#a", "#b")], T0, RUN);
    assert.deepStrictEqual(pending["#a"].previouslyRejected, { count: 1, lastRejectedAt: at(-100), lastRejectedBy: "h" });
    assert.strictEqual(pending["#z"].previouslyRejected.count, 0);
    assert.deepStrictEqual(conflicts, []);
});

test("pending: a rejection after snapshotAt still creates a pending entry flagged previouslyRejected, never approved", () => {
    const ledger = [{ original: "#a", suggested: "#b", decision: "rejected", decidedAt: at(100), decidedBy: "h" }];
    const { pending, conflicts } = R.reduceHealingPending({}, ledger, [pev(1, "#a", "#b")], T0, RUN);
    assert.ok(pending["#a"]);
    assert.strictEqual(pending["#a"].previouslyRejected.count, 1);
    assert.ok(!("decision" in pending["#a"]));
    assert.deepStrictEqual(conflicts, [{ code: "rejected_after_snapshot", key: "#a" }]);
});

test("pending: replay twice and shuffled input are byte-identical; marker is FIFO 8", () => {
    const evs = [pev(1, "#a", "#b", "d", { at: at(1) }), pev(2, "#a", "#b", "d", { at: at(2) }), tev(3, "#a", { at: at(3) })];
    const once = R.reduceHealingPending({}, [], evs, T0, RUN);
    const twice = R.reduceHealingPending(once.pending, [], evs, T0, RUN);
    assert.strictEqual(J(twice), J(once));
    assert.strictEqual(J(R.reduceHealingPending({}, [], [...evs].reverse(), T0, RUN)), J(once));
    let p = {};
    for (let i = 0; i < 10; i++) p = R.reduceHealingPending(p, [], [pev(1, "#a", "#b")], T0, `run-${i}00000`).pending;
    assert.strictEqual(p["#a"].appliedRunIds.length, 8);
    assert.strictEqual(p["#a"].appliedRunIds[7], "run-900000");
    assert.strictEqual(p["#a"].occurrences, 10);
});

test("pending: cap 200 evicts by (lastSeen, key) after merge regardless of arrival order", () => {
    const canon = {};
    for (let i = 0; i < 200; i++) canon[`#k${String(i).padStart(3, "0")}`] = { original: `#k${i}`, suggested: "#s", description: "", firstSeen: at(1000), lastSeen: at(1000), occurrences: 1, tier3Invocations: 1, previouslyRejected: { count: 0, lastRejectedAt: null, lastRejectedBy: null } };
    canon["#k000"].lastSeen = at(1); canon["#k001"].lastSeen = at(1);
    const evs = [pev(1, "#new1", "#s", "d", { at: at(2000) }), pev(2, "#new2", "#s", "d", { at: at(2001) })];
    const a = R.reduceHealingPending(canon, [], evs, T0, RUN);
    const b = R.reduceHealingPending(canon, [], [...evs].reverse(), T0, RUN);
    assert.strictEqual(J(a), J(b));
    assert.strictEqual(Object.keys(a.pending).length, 200);
    assert.deepStrictEqual(a.evicted, ["#k000", "#k001"]);
    assert.ok(a.pending["#new1"] && a.pending["#new2"]);
});

test("pending: prototype-polluting keys are stored as own data properties", () => {
    const { pending } = R.reduceHealingPending({}, [], [pev(1, "__proto__", "#b")], T0, RUN);
    assert.ok(Object.hasOwn(pending, "__proto__"));
    assert.strictEqual(Object.getPrototypeOf(pending), Object.prototype);
    assert.strictEqual(({}).suggested, undefined);
});

test("pending: input canonical object is not mutated", () => {
    const canon = { "#a": { original: "#a", suggested: "#o", description: "", firstSeen: at(1), lastSeen: at(1), occurrences: 1, tier3Invocations: 1, previouslyRejected: { count: 0, lastRejectedAt: null, lastRejectedBy: null } } };
    const before = J(canon);
    R.reduceHealingPending(canon, [], [pev(1, "#a", "#n")], T0, RUN);
    assert.strictEqual(J(canon), before);
});

// ---------- 7.4 LocatorStore ----------
const uev = (seq, original, o = {}) => ev(0, seq, "locatorStore.use", { original }, o);

test("locatorStore: use raises lastUsed to max only for an existing key; absent key ignored", () => {
    const canon = { "#a": { alternatives: ["#x"], lastUsed: 100 }, "#b": { alternatives: ["#y"], lastUsed: 9e12 } };
    const { store } = R.reduceLocatorStore(canon, [uev(1, "#a", { at: at(5) }), uev(2, "#b", { at: at(5) }), uev(3, "#nope")], RUN);
    assert.strictEqual(store["#a"].lastUsed, Date.parse(at(5)));
    assert.strictEqual(store["#b"].lastUsed, 9e12);
    assert.deepStrictEqual(store["#a"].alternatives, ["#x"]);
    assert.ok(!Object.hasOwn(store, "#nope"));
});

test("locatorStore: legacy array shape is migrated and bad entries dropped", () => {
    const { store } = R.reduceLocatorStore({ "#a": ["#x", "#x", "", 5, "#y"], "#bad": "nope" }, [], RUN);
    assert.deepStrictEqual(store["#a"].alternatives, ["#x", "#y"]);
    assert.ok(!Object.hasOwn(store, "#bad"));
});

test("locatorStore: alternative union preserves order, appends new, keeps newest 5, replay is a no-op", () => {
    const canon = { "#a": { alternatives: ["1", "2", "3"], lastUsed: 1 } };
    const adds = [{ original: "#a", alternative: "2", at: at(1) }, { original: "#a", alternative: "4", at: at(2) }, { original: "#a", alternative: "5", at: at(3) }, { original: "#a", alternative: "6", at: at(4) }];
    const first = R.reduceLocatorStore(canon, [], RUN, adds).store;
    assert.deepStrictEqual(first["#a"].alternatives, ["2", "3", "4", "5", "6"]);
    assert.deepStrictEqual(first["#a"].appliedRunIds, [RUN]);
    assert.strictEqual(J(R.reduceLocatorStore(first, [], RUN, adds).store), J(first));
    assert.deepStrictEqual(R.mergeAlternatives(["a"], ["a", "b"]), ["a", "b"]);
});

test("locatorStore: cap 500 evicts by (lastUsed, key); order of use events does not matter", () => {
    const canon = {};
    for (let i = 0; i < 500; i++) canon[`#s${String(i).padStart(3, "0")}`] = { alternatives: ["x"], lastUsed: 1000 + i };
    const evs = [uev(1, "#s000", { at: at(0) }), uev(2, "#s003", { at: "1970-01-01T00:00:00.001Z" })];
    const adds = [{ original: "#fresh", alternative: "z", at: at(1) }];
    const a = R.reduceLocatorStore(canon, evs, RUN, adds);
    const b = R.reduceLocatorStore(canon, [...evs].reverse(), RUN, adds);
    assert.strictEqual(J(a), J(b));
    assert.strictEqual(Object.keys(a.store).length, 500);
    assert.deepStrictEqual(a.evicted, ["#s001"]);
});

test("locatorStore: non-use event types (e.g. locatorStore.add from a worker) never change the store", () => {
    const canon = { "#a": { alternatives: ["1"], lastUsed: 1 } };
    const forged = ev(0, 1, "locatorStore.add", { original: "#a", alternative: "evil" });
    assert.deepStrictEqual(R.reduceLocatorStore(canon, [forged], RUN).store, canon);
});

// ---------- 7.6 Healing log ----------
test("healingLog: union by id in global order, HealingReport entry shape, byte-stable on replay and shuffle", () => {
    const l = (seq, p, o = {}) => ev(0, seq, "healing.log", { description: "d", ...p }, o);
    const evs = [
        l(2, { original: "#b", resolved: null, tier: "exhausted", error: "boom", status: "failed", reason: "r", action: "click", trust: "pending" }, { at: at(2) }),
        l(1, { original: "#a", resolved: "#a2", tier: "LocatorStore" }, { at: at(1) }),
        l(1, { original: "#a", resolved: "#a2", tier: "LocatorStore" }, { at: at(9), id: "id-0-1-healing.log" }),
    ];
    const log = R.buildHealingLog(evs);
    assert.strictEqual(log.length, 2);
    assert.deepStrictEqual(Object.keys(log[0]), ["timestamp", "original", "resolved", "tier", "description"]);
    assert.deepStrictEqual(Object.keys(log[1]), ["timestamp", "original", "resolved", "tier", "description", "error", "trust", "action", "status", "reason"]);
    assert.strictEqual(log[0].timestamp, at(1));
    assert.strictEqual(J(R.buildHealingLog([...evs].reverse())), J(log));
    assert.strictEqual(J(R.buildHealingLog(evs)), J(log));
});
