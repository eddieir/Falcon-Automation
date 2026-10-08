"use strict";

/**
 * Phase 16 pure reducers (architecture section 7). Every function here takes
 * plain data and returns new plain data: no file I/O, no singletons, no
 * clock, no logging, no mutation of its inputs. The coordinator owns reading
 * the fresh canonical files, calling a reducer, logging the returned
 * `evicted`/`conflicts` and the single digest-guarded write.
 *
 * Input events are journal events with the page ordinal attached by the
 * coordinator: { pageOrdinal, seq, id, type, scn, rep, at, p } (flakiness
 * events additionally carry the page `url` from the page table).
 *
 * The stores' own classify/key/eviction helpers live on singletons that read
 * files at construction, so the small pure parts are replicated here and
 * pinned to the stores by the regression tests (constants below mirror
 * FlakinessTracker, HealingTrust and LocatorStore).
 */

const { canonicalJson } = require("./Schemas");

const MIN_SAMPLES_FOR_VERDICT = 3;
const WINDOW_SIZE = 10;
const MAX_HISTORY_PER_SCENARIO = 20;
const MAX_TRACKED_SCENARIOS = 500;
const PENDING_MAX_ENTRIES = 200;
const MAX_ALTERNATIVES_PER_SELECTOR = 5;
const MAX_TRACKED_SELECTORS = 500;
const APPLIED_RUNS_MAX = 8;

class ReducerError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "ReducerError";
        this.code = code;
    }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const epoch = (iso) => {
    const t = typeof iso === "string" ? Date.parse(iso) : NaN;
    return Number.isNaN(t) ? 0 : t;
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function setOwn(obj, key, value) {
    Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
}
const getOwn = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);

/** Fresh object with the given entries inserted in ascending code-unit key order. */
function sortedObject(map) {
    const out = {};
    for (const key of [...map.keys()].sort(cmp)) setOwn(out, key, map.get(key));
    return out;
}

function withRun(list, runId) {
    const base = Array.isArray(list) ? list.filter((r) => typeof r === "string" && r !== runId) : [];
    return [...base, runId].slice(-APPLIED_RUNS_MAX);
}
const hasRun = (list, runId) => Array.isArray(list) && list.includes(runId);

function requireRunId(runId) {
    if (typeof runId !== "string" || !runId) throw new ReducerError("REDUCER_BAD_RUN_ID", "runId must be a non-empty string");
}

// ---------------------------------------------------------------------------
// Event ordering
// ---------------------------------------------------------------------------

function orderTuple(a, b) {
    return cmp(a.pageOrdinal, b.pageOrdinal)
        || cmp(a.scn ?? -1, b.scn ?? -1)
        || cmp(a.rep ?? 0, b.rep ?? 0)
        || cmp(a.seq, b.seq)
        || cmp(a.id, b.id)
        || cmp(a.at ?? "", b.at ?? "");
}

const identityOf = (e) => canonicalJson({ type: e.type, url: e.url ?? null, p: e.p ?? null });

/**
 * Global order (pageOrdinal, scn ?? -1, rep ?? 0, seq). Same id with the same
 * payload is a duplicate (the earliest `at` is kept so the choice never
 * depends on input order); same id with a different payload throws
 * EVENT_ID_CONFLICT. The input array is not modified.
 */
function orderEvents(events) {
    if (!Array.isArray(events)) throw new ReducerError("REDUCER_BAD_EVENTS", "events must be an array");
    const sorted = [...events].sort(orderTuple);
    const seen = new Map();
    const out = [];
    for (const e of sorted) {
        if (!isObj(e) || typeof e.id !== "string") throw new ReducerError("REDUCER_BAD_EVENT", "event without a string id");
        const sig = identityOf(e);
        if (seen.has(e.id)) {
            if (seen.get(e.id) !== sig) throw new ReducerError("EVENT_ID_CONFLICT", `event id ${e.id.slice(0, 32)} appears with different payloads`);
            continue;
        }
        seen.set(e.id, sig);
        out.push(e);
    }
    return out;
}

// ---------------------------------------------------------------------------
// 7.1 Flakiness
// ---------------------------------------------------------------------------

function classify(history) {
    const recent = (history || []).slice(-WINDOW_SIZE);
    const passCount = recent.filter((h) => h.status === "passed").length;
    const failCount = recent.filter((h) => h.status === "failed").length;
    const sampleSize = passCount + failCount;
    if (sampleSize < MIN_SAMPLES_FOR_VERDICT) return { classification: "new", flakeRate: 0, sampleSize };
    if (failCount === 0) return { classification: "stable", flakeRate: 0, sampleSize };
    if (passCount === 0) return { classification: "broken", flakeRate: 1, sampleSize };
    return { classification: "flaky", flakeRate: failCount / sampleSize, sampleSize };
}

const flakinessKey = ({ url, action, locator }) => `${url}::${action}::${locator}`;

function effectiveDecisions(ledger, actions) {
    const latest = new Map();
    for (const d of Array.isArray(ledger) ? ledger : []) {
        if (isObj(d) && typeof d.key === "string" && actions.includes(d.action)) latest.set(d.key, d.action);
    }
    return latest;
}

/**
 * @param {Object} canonicalScenarios scenario_history.json content
 * @param {Array}  events             flakiness events with `url` attached
 * @param {string} runId
 * @param {Array}  [quarantineDecisions] quarantine_decisions.json rows (read-only)
 * @returns {{scenarios:Object, evicted:string[], conflicts:Array}}
 */
function reduceFlakiness(canonicalScenarios, events, runId, quarantineDecisions = []) {
    requireRunId(runId);
    const ordered = orderEvents(events).filter((e) => e.type === "flakiness.outcome" && isObj(e.p)
        && (e.p.status === "passed" || e.p.status === "failed") && typeof e.url === "string");
    const canon = isObj(canonicalScenarios) ? canonicalScenarios : {};
    const entries = new Map();
    for (const k of Object.keys(canon)) entries.set(k, canon[k]);

    const byKey = new Map();
    for (const e of ordered) {
        const key = flakinessKey({ url: e.url, action: e.p.action, locator: e.p.locator });
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(e);
    }

    for (const [key, evs] of byKey) {
        const existing = entries.get(key);
        if (existing && hasRun(existing.appliedRunIds, runId)) continue;
        const known = new Set((existing?.history ?? []).map((h) => h?.eventId).filter(Boolean));
        const fresh = [];
        for (const e of evs) {
            if (known.has(e.id)) continue;
            known.add(e.id);
            fresh.push(e);
        }
        if (fresh.length === 0) {
            if (existing) entries.set(key, { ...existing, appliedRunIds: withRun(existing.appliedRunIds, runId) });
            continue;
        }
        const added = fresh.map((e) => ({
            status: e.p.status, timestamp: e.at, duration: e.p.durationMs ?? null,
            errorType: e.p.errorType ?? null, outcome: e.p.outcome ?? null, eventId: e.id,
        }));
        const history = [...(existing?.history ?? []), ...added].slice(-MAX_HISTORY_PER_SCENARIO);
        const { classification, flakeRate, sampleSize } = classify(history);
        const wasFlaky = existing?.classification === "flaky";
        const sinceMs = existing?.flakySince == null ? NaN : Date.parse(existing.flakySince);
        const validSince = existing?.flakySince != null && !Number.isNaN(sinceMs);
        const earliestAt = fresh.map((e) => e.at).sort((a, b) => epoch(a) - epoch(b) || cmp(a, b))[0];
        const flakySince = classification === "flaky"
            ? (validSince ? existing.flakySince : earliestAt)
            : (wasFlaky ? null : (existing?.flakySince ?? null));
        const lastDescription = [...fresh].reverse().find((e) => e.p.description)?.p.description;
        const first = fresh[0];
        entries.set(key, {
            key, url: first.url, action: first.p.action, locator: first.p.locator,
            description: lastDescription || existing?.description || "",
            history, classification, flakeRate, sampleSize,
            lastUsed: Math.max(Number.isFinite(existing?.lastUsed) ? existing.lastUsed : 0, ...fresh.map((e) => epoch(e.at))),
            quarantined: existing?.quarantined ?? false,
            quarantinedAt: existing?.quarantinedAt ?? null,
            quarantinedBy: existing?.quarantinedBy ?? null,
            flakySince,
            appliedRunIds: withRun(existing?.appliedRunIds, runId),
        });
    }

    // Quarantine reconcile: the ledger wins (same rule as FlakinessTracker._reload).
    const latest = effectiveDecisions(quarantineDecisions, ["quarantine", "unquarantine"]);
    for (const [key, action] of latest) {
        const entry = entries.get(key);
        if (entry && entry.quarantined !== (action === "quarantine")) entries.set(key, { ...entry, quarantined: action === "quarantine" });
    }

    const evicted = [];
    const overflow = entries.size - MAX_TRACKED_SCENARIOS;
    if (overflow > 0) {
        const unprotected = [...entries.keys()].filter((k) => entries.get(k)?.quarantined !== true && latest.get(k) !== "quarantine");
        unprotected.sort((a, b) => (entries.get(a).lastUsed || 0) - (entries.get(b).lastUsed || 0) || cmp(a, b));
        for (const key of unprotected.slice(0, overflow)) {
            entries.delete(key);
            evicted.push(key);
        }
    }
    return { scenarios: sortedObject(entries), evicted, conflicts: [] };
}

// ---------------------------------------------------------------------------
// 7.3 Healing pending
// ---------------------------------------------------------------------------

function rejectionIndex(decisions) {
    const index = new Map();
    for (const row of Array.isArray(decisions) ? decisions : []) {
        if (!isObj(row) || typeof row.original !== "string" || typeof row.suggested !== "string") continue;
        if (row.decision !== "approved" && row.decision !== "rejected") continue;
        if (typeof row.decidedAt !== "string" || Number.isNaN(Date.parse(row.decidedAt))) continue;
        if (row.decision !== "rejected") continue;
        const k = JSON.stringify([row.original, row.suggested]);
        const prior = index.get(k) ?? { count: 0 };
        index.set(k, {
            count: prior.count + 1, lastRejectedAt: row.decidedAt,
            lastRejectedBy: typeof row.decidedBy === "string" ? row.decidedBy : null,
        });
    }
    return index;
}

function previouslyRejected(index, original, suggested) {
    const r = index.get(JSON.stringify([original, suggested]));
    return { count: r?.count ?? 0, lastRejectedAt: r?.lastRejectedAt ?? null, lastRejectedBy: r?.lastRejectedBy ?? null };
}

const minIso = (list) => [...list].sort((a, b) => epoch(a) - epoch(b) || cmp(a, b))[0];
const maxIso = (list) => [...list].sort((a, b) => epoch(b) - epoch(a) || cmp(b, a))[0];

/**
 * @returns {{pending:Object, evicted:string[], conflicts:Array}}
 */
function reduceHealingPending(canonicalPending, decisionsLedger, events, snapshotAt, runId) {
    requireRunId(runId);
    const ordered = orderEvents(events);
    const canon = isObj(canonicalPending) ? canonicalPending : {};
    const entries = new Map();
    for (const k of Object.keys(canon)) entries.set(k, canon[k]);
    const index = rejectionIndex(decisionsLedger);
    const conflicts = [];

    const groups = new Map();
    for (const e of ordered) {
        if ((e.type !== "healing.pending" && e.type !== "healing.tier3") || !isObj(e.p) || typeof e.p.original !== "string") continue;
        if (!groups.has(e.p.original)) groups.set(e.p.original, { pending: [], tier3: [] });
        groups.get(e.p.original)[e.type === "healing.pending" ? "pending" : "tier3"].push(e);
    }

    for (const [original, g] of groups) {
        const existing = entries.get(original);
        if (existing && hasRun(existing.appliedRunIds, runId)) continue;
        if (!existing && g.pending.length === 0) continue; // tier3 alone is a no-op, as today
        const pendingIds = new Set(g.pending.map((e) => e.id));
        const tier3Ids = new Set(g.tier3.map((e) => e.id));
        const last = g.pending[g.pending.length - 1];
        const ats = g.pending.map((e) => e.at);
        const suggested = last ? last.p.suggested : existing.suggested;
        const description = [...g.pending].reverse().find((e) => e.p.description)?.p.description ?? "";
        const next = {
            original,
            suggested,
            description: description || existing?.description || "",
            firstSeen: existing ? minIso([existing.firstSeen, ...ats].filter((v) => typeof v === "string")) : minIso(ats),
            lastSeen: existing ? maxIso([existing.lastSeen, ...ats].filter((v) => typeof v === "string")) : maxIso(ats),
            occurrences: (existing?.occurrences ?? 0) + pendingIds.size,
            tier3Invocations: (existing ? (existing.tier3Invocations ?? 0) : 1) + tier3Ids.size,
            previouslyRejected: previouslyRejected(index, original, suggested),
            appliedRunIds: withRun(existing?.appliedRunIds, runId),
        };
        entries.set(original, next);

        const snap = epoch(snapshotAt);
        if (next.previouslyRejected.count > 0 && epoch(next.previouslyRejected.lastRejectedAt) > snap) {
            conflicts.push({ code: "rejected_after_snapshot", key: original });
        }
    }

    // previouslyRejected is a cache: re-derive for every entry from the fresh ledger.
    for (const [key, entry] of entries) {
        const derived = previouslyRejected(index, entry.original ?? key, entry.suggested);
        if (canonicalJson(entry.previouslyRejected ?? null) !== canonicalJson(derived)) entries.set(key, { ...entry, previouslyRejected: derived });
    }

    const evicted = [];
    const overflow = entries.size - PENDING_MAX_ENTRIES;
    if (overflow > 0) {
        const order = [...entries.keys()].sort((a, b) => epoch(entries.get(a).lastSeen) - epoch(entries.get(b).lastSeen) || cmp(a, b));
        for (const key of order.slice(0, overflow)) {
            entries.delete(key);
            evicted.push(key);
        }
    }
    return { pending: sortedObject(entries), evicted, conflicts };
}

// ---------------------------------------------------------------------------
// 7.4 LocatorStore
// ---------------------------------------------------------------------------

/** Union preserving order; new entries append in the given order; keep the newest 5 by position. */
function mergeAlternatives(existing, added) {
    const out = [];
    for (const v of [...(existing ?? []), ...(added ?? [])]) {
        if (typeof v === "string" && v.trim() && !out.includes(v)) out.push(v);
    }
    return out.slice(-MAX_ALTERNATIVES_PER_SELECTOR);
}

function migrateStoreEntry(raw) {
    const alternatives = Array.isArray(raw) ? raw : raw?.alternatives;
    if (!Array.isArray(alternatives)) return null;
    const entry = {
        alternatives: mergeAlternatives(alternatives, []),
        // The store stamps Date.now() on a legacy entry; a reducer has no clock, so 0 (oldest).
        lastUsed: Number.isFinite(raw?.lastUsed) ? raw.lastUsed : 0,
    };
    if (isObj(raw) && Array.isArray(raw.appliedRunIds)) entry.appliedRunIds = raw.appliedRunIds.slice(-APPLIED_RUNS_MAX);
    return entry;
}

/**
 * @param {Object} canonicalStore locator_store.json content
 * @param {Array}  events         `locatorStore.use` events (others ignored)
 * @param {string} runId
 * @param {Array}  [adds]         coordinator-side [{original, alternative, at}]; never from worker journals
 * @returns {{store:Object, evicted:string[], conflicts:Array}}
 */
function reduceLocatorStore(canonicalStore, events, runId, adds = []) {
    requireRunId(runId);
    const ordered = orderEvents(events);
    const entries = new Map();
    for (const k of Object.keys(isObj(canonicalStore) ? canonicalStore : {})) {
        const m = migrateStoreEntry(canonicalStore[k]);
        if (m) entries.set(k, m);
    }

    for (const e of ordered) {
        if (e.type !== "locatorStore.use" || !isObj(e.p) || typeof e.p.original !== "string") continue;
        const entry = entries.get(e.p.original);
        if (!entry) continue; // use for an absent key is ignored
        entries.set(e.p.original, { ...entry, lastUsed: Math.max(entry.lastUsed, epoch(e.at)) });
    }

    const addsByKey = new Map();
    for (const a of Array.isArray(adds) ? adds : []) {
        if (!isObj(a) || typeof a.original !== "string" || typeof a.alternative !== "string") continue;
        if (!addsByKey.has(a.original)) addsByKey.set(a.original, []);
        addsByKey.get(a.original).push(a);
    }
    for (const [original, list] of addsByKey) {
        const entry = entries.get(original) ?? { alternatives: [], lastUsed: 0 };
        if (hasRun(entry.appliedRunIds, runId)) continue;
        entries.set(original, {
            ...entry,
            alternatives: mergeAlternatives(entry.alternatives, list.map((a) => a.alternative)),
            lastUsed: Math.max(entry.lastUsed, ...list.map((a) => epoch(a.at))),
            appliedRunIds: withRun(entry.appliedRunIds, runId),
        });
    }

    const evicted = [];
    const overflow = entries.size - MAX_TRACKED_SELECTORS;
    if (overflow > 0) {
        const order = [...entries.keys()].sort((a, b) => entries.get(a).lastUsed - entries.get(b).lastUsed || cmp(a, b));
        for (const key of order.slice(0, overflow)) {
            entries.delete(key);
            evicted.push(key);
        }
    }
    return { store: sortedObject(entries), evicted, conflicts: [] };
}

// ---------------------------------------------------------------------------
// 7.6 Healing logs
// ---------------------------------------------------------------------------

/** This run's healing log in global order; entry shape mirrors HealingReport._log. */
function buildHealingLog(events) {
    const out = [];
    for (const e of orderEvents(events)) {
        if (e.type !== "healing.log" || !isObj(e.p)) continue;
        const p = e.p;
        out.push({
            timestamp: e.at,
            original: p.original,
            resolved: p.resolved ?? null,
            tier: p.tier,
            description: p.description ?? "",
            ...(p.error ? { error: p.error } : {}),
            ...(p.trust ? { trust: p.trust } : {}),
            ...(p.action ? { action: p.action } : {}),
            ...(p.status ? { status: p.status } : {}),
            ...(p.reason ? { reason: p.reason } : {}),
        });
    }
    return out;
}

module.exports = {
    ReducerError, orderEvents, reduceFlakiness, reduceHealingPending, reduceLocatorStore,
    buildHealingLog, mergeAlternatives, classify, flakinessKey,
    cmp, epoch, withRun, hasRun, isObj, setOwn, getOwn, sortedObject, requireRunId, APPLIED_RUNS_MAX,
    LIMITS: Object.freeze({
        MAX_HISTORY_PER_SCENARIO, MAX_TRACKED_SCENARIOS, PENDING_MAX_ENTRIES,
        MAX_ALTERNATIVES_PER_SELECTOR, MAX_TRACKED_SELECTORS,
    }),
};
