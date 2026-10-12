"use strict";

/**
 * Phase 16 LocatorMemory reducer (architecture section 7.5, rows 1-13).
 * Pure: it layers journal events on the single fresh canonical envelope and
 * returns a new envelope plus named conflicts. It never calls approve/reject/
 * rollback and never raises the trust of an existing entry. Rejections and
 * `legacy` are carried through untouched. Caller writes the result once,
 * digest-guarded.
 *
 * Event shape: { pageOrdinal, seq, id, type, scn, rep, at, p } where p is
 * { identity, signature } (locatorMemory.evidence) or
 * { identity, candidate, baseRevision } (locatorMemory.candidate).
 * baseRevision is carried for audit only: a changed revision alone is not
 * staleness (other shards legitimately change it); staleness is decided by a
 * human decision after `snapshotAt` (row 10).
 */

const V = require("../locator/LocatorMemoryValidation");
const LocatorIdentity = require("../locator/LocatorIdentity");
const { orderEvents, ReducerError, cmp, epoch, requireRunId, isObj, setOwn, APPLIED_RUNS_MAX } = require("./Reducers");

const MAX_TRACKED_IDENTITIES = 500;
const SCHEMA_VERSION = 1;
const HUMAN_DECISIONS = new Set(["approve", "reject", "rollback"]);

const ts = (v) => V.timestamp(v);
const minTs = (list) => [...list].sort((a, b) => epoch(a) - epoch(b) || cmp(a, b))[0];
const maxTs = (list) => [...list].sort((a, b) => epoch(b) - epoch(a) || cmp(b, a))[0];

function blockedReason(env, opts) {
    if (opts && opts.blocked) return String(opts.blocked).slice(0, 80);
    if (!isObj(env)) return "not_an_object";
    if (env.schemaVersion !== SCHEMA_VERSION) return "unsupported_schema";
    if (!isObj(env.entries)) return "entries_not_an_object";
    if (V.bytes(env) > V.MAX_BYTES) return "oversize";
    return null;
}

/** Row 12: a "trusted" entry whose latest revocation is not provably older than its latest approve. */
function revocationConflict(entry) {
    const revs = Array.isArray(entry.revocationHistory) ? entry.revocationHistory : [];
    if (revs.length === 0) return false;
    const lastRev = Date.parse(revs[revs.length - 1]?.at);
    const approves = (Array.isArray(entry.decisionHistory) ? entry.decisionHistory : []).filter((d) => d?.kind === "approve");
    const lastApprove = approves.length ? Date.parse(approves[approves.length - 1]?.at) : NaN;
    if (Number.isNaN(lastRev) || Number.isNaN(lastApprove)) return true;
    return lastRev >= lastApprove;
}

function staleAfterDecision(entry, snapshotAt) {
    const snap = Date.parse(snapshotAt);
    return (Array.isArray(entry.decisionHistory) ? entry.decisionHistory : []).some((d) => {
        if (!HUMAN_DECISIONS.has(d?.kind)) return false;
        const at = Date.parse(d.at);
        return Number.isNaN(snap) || Number.isNaN(at) ? true : at > snap;
    });
}

function pendingFrom(candEvents, existingPending) {
    // Last candidate in global order wins; occurrences = distinct ids of that proposalId.
    const last = candEvents[candEvents.length - 1];
    const proposal = last.proposal;
    const same = candEvents.filter((c) => c.proposal.proposalId === proposal.proposalId);
    const ids = new Set(same.map((c) => c.id));
    const ats = same.map((c) => ts(c.at));
    const prior = existingPending && existingPending.proposalId === proposal.proposalId ? existingPending : null;
    return {
        ...proposal,
        firstSeen: prior ? minTs([ts(prior.firstSeen), ...ats]) : minTs(ats),
        lastSeen: prior ? maxTs([ts(prior.lastSeen), ...ats]) : maxTs(ats),
        occurrences: Math.min(1000000, (prior ? Math.max(1, Number(prior.occurrences) || 1) : 0) + ids.size),
    };
}

/**
 * @param {Object} canonicalEnvelope fresh locator_memory.json content
 * @param {Array}  events            locatorMemory.* events (others ignored)
 * @param {string} runId
 * @param {string} snapshotAt        ISO run start
 * @param {{blocked?:string}} [opts] blocked: caller-detected block (e.g. salt mismatch)
 * @returns {{envelope:Object, conflicts:Array, evicted:string[], blocked:boolean, changed:boolean}}
 */
function reduceLocatorMemory(canonicalEnvelope, events, runId, snapshotAt, opts = {}) {
    requireRunId(runId);
    const ordered = orderEvents(events).filter((e) => e.type === "locatorMemory.evidence" || e.type === "locatorMemory.candidate");

    const reason = blockedReason(canonicalEnvelope, opts);
    if (reason) {
        // Row 13: no write, original preserved, merge reports non-durable.
        return { envelope: canonicalEnvelope, conflicts: [{ code: "envelope_blocked", key: null, detail: reason }], evicted: [], blocked: true, changed: false };
    }
    const base = V.clone(canonicalEnvelope);
    if (Array.isArray(base.mergedRuns) && base.mergedRuns.includes(runId)) {
        return { envelope: base, conflicts: [], evicted: [], blocked: false, changed: false };
    }

    if (ordered.length === 0) return { envelope: base, conflicts: [], evicted: [], blocked: false, changed: false };

    const conflicts = [];
    const entries = new Map(Object.entries(base.entries));
    const byKey = new Map();
    for (const e of ordered) {
        let key, item;
        try {
            if (!isObj(e.p) || !V.identity(e.p.identity)) throw new Error("identity");
            key = LocatorIdentity.serialiseIdentity(e.p.identity);
            if (e.type === "locatorMemory.evidence") {
                if (!V.signature(e.p.signature)) throw new Error("signature");
                item = { kind: "evidence", id: e.id, at: ts(e.at), identity: V.clone(e.p.identity), signature: V.clone(e.p.signature) };
            } else {
                item = { kind: "candidate", id: e.id, at: ts(e.at), identity: V.clone(e.p.identity), proposal: V.proposal(e.p.candidate) };
            }
        } catch {
            conflicts.push({ code: "invalid_event_dropped", key: null, eventId: e.id });
            continue;
        }
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(item);
    }

    for (const [key, items] of byKey) {
        const existing = entries.get(key);
        const evidence = items.filter((i) => i.kind === "evidence");
        let candidates = items.filter((i) => i.kind === "candidate");

        if (existing !== undefined) {
            if (!isObj(existing) || !["trusted", "unproven", "revoked"].includes(existing.trust)) {
                conflicts.push({ code: "revocation_conflict_failed_closed", key, detail: "invalid_entry" });
                continue;
            }
            let drop = false;
            if (existing.trust === "trusted" && revocationConflict(existing)) {
                conflicts.push({ code: "revocation_conflict_failed_closed", key, requiresRevocation: true });
                drop = true;
            }
            if (staleAfterDecision(existing, snapshotAt)) {
                for (const i of items) conflicts.push({ code: "stale_after_decision", key, eventId: i.id });
                drop = true;
            }
            if (drop) continue; // fail closed: entry stays byte-unchanged
        }

        // Row 11: only the last candidate survives; the others are reported.
        const approvedId = existing?.trust === "trusted" ? existing.approvedAlternative?.proposalId : undefined;
        if (approvedId !== undefined) candidates = candidates.filter((c) => c.proposal.proposalId !== approvedId); // row 4
        const distinct = new Set(candidates.map((c) => c.proposal.proposalId));
        if (distinct.size > 1) {
            const winner = candidates[candidates.length - 1].proposal.proposalId;
            for (const c of candidates) if (c.proposal.proposalId !== winner) conflicts.push({ code: "candidate_superseded", key, eventId: c.id });
            candidates = candidates.filter((c) => c.proposal.proposalId === winner);
        }

        if (!existing) {
            if (evidence.length === 0 && candidates.length === 0) continue;
            const all = [...evidence, ...candidates];
            const trusted = evidence.length > 0;
            entries.set(key, {
                identity: all[0].identity,
                approvedAlternative: null,
                decisionHistory: [],
                trust: trusted ? "trusted" : "unproven",
                signature: trusted ? evidence[evidence.length - 1].signature : null,
                pendingCandidate: candidates.length ? pendingFrom(candidates, null) : null,
                firstSeen: minTs(all.map((i) => i.at)),
                lastSeen: maxTs(all.map((i) => i.at)),
                revocationHistory: [],
            });
            continue;
        }

        if (existing.trust === "revoked") {
            for (const i of evidence) conflicts.push({ code: "evidence_on_revoked_ignored", key, eventId: i.id });
            for (const i of candidates) conflicts.push({ code: "candidate_on_revoked_ignored", key, eventId: i.id });
            continue;
        }

        const next = V.clone(existing);
        const applied = [];
        if (existing.trust === "trusted" && evidence.length) {
            next.signature = evidence[evidence.length - 1].signature;
            applied.push(...evidence);
        } else if (existing.trust === "unproven") {
            for (const i of evidence) conflicts.push({ code: "evidence_on_unproven_deferred", key, eventId: i.id });
        }
        if (candidates.length) {
            next.pendingCandidate = pendingFrom(candidates, existing.pendingCandidate);
            applied.push(...candidates);
        }
        if (applied.length) {
            next.lastSeen = maxTs([ts(existing.lastSeen), ...applied.map((i) => i.at)]);
            entries.set(key, next);
        }
    }

    // Caps once, after the merge: lastSeen asc, key asc (never arrival order).
    const evicted = [];
    const order = [...entries.keys()].sort((a, b) => epoch(entries.get(a).lastSeen) - epoch(entries.get(b).lastSeen) || cmp(a, b));
    const out = { ...base };
    const build = () => {
        const obj = {};
        for (const k of [...entries.keys()].sort(cmp)) setOwn(obj, k, entries.get(k));
        out.entries = obj;
        return out;
    };
    out.mergedRuns = [...(Array.isArray(base.mergedRuns) ? base.mergedRuns.filter((r) => r !== runId) : []), runId].slice(-APPLIED_RUNS_MAX);
    while (entries.size > MAX_TRACKED_IDENTITIES || V.bytes(build()) > V.MAX_BYTES) {
        const k = order.shift();
        if (k === undefined) break;
        entries.delete(k);
        evicted.push(k);
    }
    build();
    return { envelope: out, conflicts, evicted, blocked: false, changed: true };
}

module.exports = { reduceLocatorMemory, ReducerError, MAX_TRACKED_IDENTITIES };
