"use strict";

/**
 * ContractStore.js — WP-77a auditable approval-lifecycle store for business
 * assertion contracts (Contract.js). One append-only JSONL event log per
 * journeyId, hash-chained so accidental or partial tampering (edited,
 * reordered, replayed, truncated or oversized files) is detected on read.
 *
 * Security note (read before relying on this for anything beyond operator
 * mistakes): the hash chain proves *internal consistency* of one file. It
 * cannot prove *authenticity* against an attacker capable of rewriting the
 * whole store from scratch with a self-consistent chain — there is no
 * external anchor (no signature, no external log). `channel` and `at` are
 * operator-supplied labels; they identify how an approval was recorded, not
 * who recorded it. Do not treat this store as proof of human identity or of
 * review quality — only as a tamper-evident log of lifecycle transitions.
 *
 * No contract body, locator text or expected values are ever stored here —
 * only digests, revisions and lifecycle metadata.
 */

const fs = require("fs");
const path = require("path");
const SafeFs = require("../parallel/SafeFs");
const Limits = require("../parallel/Limits");
const { canonicalJson, sha256 } = require("../parallel/Schemas");
const Contract = require("./Contract");

const EVENT_TYPES = Object.freeze(["PROPOSED", "APPROVED", "REJECTED", "SUPERSEDED"]);
const CHANNELS = Object.freeze(["cli", "dashboard", "test"]);
const GENESIS_PREV = "0".repeat(64);
const MAX_STORE_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_LINE_BYTES = 16 * 1024;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EVENT_KEYS = ["seq", "type", "journeyId", "digest", "revision", "channel", "at", "prev", "hash"];

function ok(value) { return Object.assign({ ok: true }, value); }
function bad(code, message) { return { ok: false, code, message: String(message || code).slice(0, 200) }; }

function isPlainObj(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const p = Object.getPrototypeOf(v);
    return p === Object.prototype || p === null;
}

function checkJourneyId(v) {
    return typeof v === "string" && Limits.NAME_PATTERN.test(v) && !/^\.+$/.test(v);
}

function defaultClock() { return new Date(); }

function isoNow(clock) {
    const d = (clock || defaultClock)();
    const iso = d.toISOString();
    return ISO_PATTERN.test(iso) ? iso : new Date().toISOString();
}

// --------------------------------------------------------------- per-file write queue

const fileQueues = new Map();

function withFileLock(key, fn) {
    const prev = fileQueues.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    // Keep the queue alive regardless of outcome, but never let a rejection
    // leak into the map's stored promise chain.
    fileQueues.set(key, run.then(() => {}, () => {}));
    return run;
}

// --------------------------------------------------------------- event hashing

function eventHash(e) {
    const { hash, ...rest } = e;
    return sha256(canonicalJson(rest));
}

function makeEvent(seq, type, journeyId, digest, revision, channel, at, prev) {
    const body = { seq, type, journeyId, digest, revision, channel, at, prev };
    return Object.assign({}, body, { hash: eventHash(body) });
}

function validateEventShape(e, expectedJourneyId) {
    if (!isPlainObj(e)) return false;
    const keys = Object.keys(e);
    if (keys.length !== EVENT_KEYS.length) return false;
    for (const k of keys) if (!EVENT_KEYS.includes(k)) return false;
    if (!Number.isInteger(e.seq) || e.seq < 1) return false;
    if (typeof e.type !== "string" || !EVENT_TYPES.includes(e.type)) return false;
    if (typeof e.journeyId !== "string" || e.journeyId !== expectedJourneyId) return false;
    if (typeof e.digest !== "string" || !DIGEST_PATTERN.test(e.digest)) return false;
    if (!Number.isInteger(e.revision) || e.revision < 1) return false;
    if (typeof e.channel !== "string" || !CHANNELS.includes(e.channel)) return false;
    if (typeof e.at !== "string" || !ISO_PATTERN.test(e.at)) return false;
    if (typeof e.prev !== "string" || !HASH_PATTERN.test(e.prev)) return false;
    if (typeof e.hash !== "string" || !HASH_PATTERN.test(e.hash)) return false;
    return true;
}

/**
 * Walk the ordered event list, enforcing hash chain, sequencing and the
 * lifecycle state machine. Returns null if the sequence is internally
 * consistent, or a short tamper code otherwise. Also returns the final
 * per-digest state map and the currently-approved digest, if any.
 */
function reduceChain(events, expectedJourneyId) {
    let prevHash = GENESIS_PREV;
    const state = new Map(); // digest -> current status
    const revisionOf = new Map(); // digest -> revision
    let approvedDigest = null;

    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (!validateEventShape(e, expectedJourneyId)) return { tamper: "MALFORMED_EVENT" };
        if (e.seq !== i + 1) return { tamper: "SEQ" };
        if (e.prev !== prevHash) return { tamper: "CHAIN" };
        if (eventHash(e) !== e.hash) return { tamper: "HASH" };

        const cur = state.get(e.digest);
        if (e.type === "PROPOSED") {
            if (cur !== undefined) return { tamper: "ILLEGAL_TRANSITION" };
            state.set(e.digest, "PROPOSED");
            revisionOf.set(e.digest, e.revision);
        } else if (e.type === "APPROVED") {
            if (cur !== "PROPOSED") return { tamper: "ILLEGAL_TRANSITION" };
            if (approvedDigest !== null) return { tamper: "ILLEGAL_TRANSITION" }; // must be superseded first
            state.set(e.digest, "APPROVED");
            approvedDigest = e.digest;
        } else if (e.type === "REJECTED") {
            if (cur !== "PROPOSED") return { tamper: "ILLEGAL_TRANSITION" };
            state.set(e.digest, "REJECTED");
        } else if (e.type === "SUPERSEDED") {
            if (cur !== "APPROVED" || approvedDigest !== e.digest) return { tamper: "ILLEGAL_TRANSITION" };
            state.set(e.digest, "SUPERSEDED");
            approvedDigest = null;
        } else {
            return { tamper: "MALFORMED_EVENT" };
        }
        prevHash = e.hash;
    }
    return { tamper: null, state, revisionOf, approvedDigest, lastHash: prevHash };
}

// --------------------------------------------------------------- bounded read

async function readStoreFile(file) {
    let lst;
    try { lst = await fs.promises.lstat(file); } catch (e) {
        if (e && e.code === "ENOENT") return { status: "missing" };
        return { status: "broken" };
    }
    if (lst.isSymbolicLink()) return { status: "broken" };
    if (!lst.isFile()) return { status: "broken" };

    let fh = null;
    try {
        try {
            fh = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        } catch (e) {
            return { status: "broken" };
        }
        const st = await fh.stat();
        if (!st.isFile()) return { status: "broken" };
        if (st.size > MAX_STORE_BYTES) return { status: "broken" };
        const buf = Buffer.alloc(st.size + 1);
        let off = 0;
        for (;;) {
            const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
            if (bytesRead === 0) break;
            off += bytesRead;
            if (off > st.size || off > MAX_STORE_BYTES) return { status: "broken" };
            if (off >= buf.length) break;
        }
        let text;
        try {
            text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, off));
        } catch { return { status: "broken" }; }
        if (text === "") return { status: "ok", events: [] };
        if (!text.endsWith("\n")) return { status: "broken" }; // truncated final line
        const lines = text.split("\n").slice(0, -1);
        const events = [];
        for (const line of lines) {
            if (line === "" || Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) return { status: "broken" };
            const parsed = Contract.parseJsonStrict(line);
            if (!parsed.ok) return { status: "broken" };
            events.push(parsed.value);
        }
        return { status: "ok", events };
    } catch {
        return { status: "broken" };
    } finally {
        if (fh) { try { await fh.close(); } catch { /* ignore */ } }
    }
}

/** Read + fully verify one journeyId's event log. Never throws. */
async function loadChain(root, journeyId) {
    if (!checkJourneyId(journeyId)) return { integrity: "broken", status: "missing", file: null };
    let file;
    try {
        file = SafeFs.resolveUnder(root, journeyId, "events.jsonl");
    } catch {
        return { integrity: "broken", status: "missing", file: null };
    }
    const read = await readStoreFile(file);
    if (read.status === "missing") return { integrity: "missing", file, events: [] };
    if (read.status === "broken") return { integrity: "broken", file, events: [] };

    const reduced = reduceChain(read.events, journeyId);
    if (reduced.tamper) return { integrity: "broken", file, events: read.events };
    return {
        integrity: "ok",
        file,
        events: read.events,
        state: reduced.state,
        revisionOf: reduced.revisionOf,
        approvedDigest: reduced.approvedDigest,
        lastHash: reduced.lastHash,
    };
}

async function writeChain(file, events) {
    const content = events.map((e) => JSON.stringify(e) + "\n").join("");
    const res = await SafeFs.writeAtomicPrivate(file, content);
    if (!res.ok) return bad("WRITE_FAILED", res.error);
    return { ok: true };
}

function normalizeOpts(opts) {
    const channel = (opts && opts.channel) || "cli";
    const clock = (opts && opts.clock) || defaultClock;
    return { channel, clock };
}

// --------------------------------------------------------------- public API

async function propose(root, contract, opts) {
    try {
        const { channel, clock } = normalizeOpts(opts);
        if (!CHANNELS.includes(channel)) return bad("CHANNEL_INVALID", "unsupported channel");

        let value, digest;
        if (typeof contract === "string") {
            const r = Contract.parse(contract);
            if (!r.ok) return bad(r.code, r.message);
            value = r.value; digest = r.digest;
        } else {
            const r = Contract.validate(contract);
            if (!r.ok) return bad(r.code, r.message);
            value = r.value;
            digest = Contract.digestOf(value);
        }

        const journeyId = value.journeyId;
        const revision = value.revision;
        if (!checkJourneyId(journeyId)) return bad("PATH_INVALID", "journeyId invalid");

        const chain = await loadChain(root, journeyId);
        if (chain.integrity === "broken") return bad("STORE_BROKEN", "chain failed integrity verification");

        const key = chain.file || `${root}:${journeyId}`;
        return await withFileLock(key, async () => {
            // Always re-load inside the lock: another queued write for this same
            // journeyId may have landed between the pre-lock check above and now.
            const fresh = await loadChain(root, journeyId);
            if (fresh.integrity === "broken") return bad("STORE_BROKEN", "chain failed integrity verification");

            const events = fresh.events || [];
            const existing = events.find((e) => e.digest === digest);
            if (existing) {
                const status = fresh.state.get(digest);
                return ok({ idempotent: true, status: status || "PROPOSED", digest, journeyId });
            }

            let maxRevision = 0;
            if (fresh.revisionOf) for (const r of fresh.revisionOf.values()) maxRevision = Math.max(maxRevision, r);
            if (events.length > 0 && revision <= maxRevision) return bad("REVISION_NOT_INCREASED", "revision must increase");

            const at = isoNow(clock);
            const prev = fresh.lastHash || GENESIS_PREV;
            const seq = events.length + 1;
            const event = makeEvent(seq, "PROPOSED", journeyId, digest, revision, channel, at, prev);
            const newEvents = events.concat([event]);
            const file = fresh.file || SafeFs.resolveUnder(root, journeyId, "events.jsonl");
            const w = await writeChain(file, newEvents);
            if (!w.ok) return w;
            return ok({ idempotent: false, status: "PROPOSED", digest, journeyId });
        });
    } catch (e) {
        return bad("INTERNAL", e && e.message);
    }
}

async function approve(root, journeyId, digest, opts) {
    return transition(root, journeyId, digest, "APPROVED", opts);
}

async function reject(root, journeyId, digest, opts) {
    return transition(root, journeyId, digest, "REJECTED", opts);
}

async function transition(root, journeyId, digest, type, opts) {
    try {
        const { channel, clock } = normalizeOpts(opts);
        if (!CHANNELS.includes(channel)) return bad("CHANNEL_INVALID", "unsupported channel");
        if (!checkJourneyId(journeyId)) return bad("PATH_INVALID", "journeyId invalid");
        if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) return bad("DIGEST_INVALID", "digest malformed");

        let file;
        try { file = SafeFs.resolveUnder(root, journeyId, "events.jsonl"); } catch { return bad("PATH_INVALID", "journeyId invalid"); }

        return await withFileLock(file, async () => {
            const chain = await loadChain(root, journeyId);
            if (chain.integrity === "broken") return bad("STORE_BROKEN", "chain failed integrity verification");
            if (chain.integrity === "missing" || !chain.state || !chain.state.has(digest)) {
                return bad("NOT_PROPOSED", "digest was never proposed for this journey");
            }
            const current = chain.state.get(digest);
            if (current !== "PROPOSED") return bad("INVALID_TRANSITION", `cannot move from ${current} to ${type}`);

            const at = isoNow(clock);
            const events = chain.events.slice();
            let seq = events.length + 1;
            let prev = chain.lastHash;

            if (type === "APPROVED" && chain.approvedDigest && chain.approvedDigest !== digest) {
                const oldDigest = chain.approvedDigest;
                const oldRevision = chain.revisionOf.get(oldDigest);
                const supersede = makeEvent(seq, "SUPERSEDED", journeyId, oldDigest, oldRevision, channel, at, prev);
                events.push(supersede);
                seq += 1;
                prev = supersede.hash;
            }

            const revision = chain.revisionOf.get(digest);
            const event = makeEvent(seq, type, journeyId, digest, revision, channel, at, prev);
            events.push(event);

            const w = await writeChain(file, events);
            if (!w.ok) return w;
            return ok({ status: type, digest, journeyId });
        });
    } catch (e) {
        return bad("INTERNAL", e && e.message);
    }
}

async function status(root, journeyId, digest) {
    try {
        if (!checkJourneyId(journeyId)) return ok({ status: "UNKNOWN", integrity: "missing" });
        if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) return ok({ status: "UNKNOWN", integrity: "missing" });
        const chain = await loadChain(root, journeyId);
        if (chain.integrity === "missing") return ok({ status: "UNKNOWN", integrity: "missing" });
        if (chain.integrity === "broken") return ok({ status: "UNKNOWN", integrity: "broken" });
        const st = chain.state.has(digest) ? chain.state.get(digest) : "UNKNOWN";
        return ok({ status: st, integrity: "ok" });
    } catch (e) {
        return bad("INTERNAL", e && e.message);
    }
}

async function isApproved(root, journeyId, digest) {
    const r = await status(root, journeyId, digest);
    if (!r.ok) return false;
    return r.integrity === "ok" && r.status === "APPROVED";
}

module.exports = {
    propose, approve, reject, status, isApproved,
    EVENT_TYPES, CHANNELS, GENESIS_PREV,
};
