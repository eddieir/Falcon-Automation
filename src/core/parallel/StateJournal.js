"use strict";

const Limits = require("./Limits");
const Schemas = require("./Schemas");

class JournalError extends Error {
    constructor(code, path) {
        super(`${code}${path ? " at " + String(path).slice(0, 80) : ""}`);
        this.name = "JournalError";
        this.code = code;
        this.path = path ? String(path).slice(0, 120) : "";
    }
}

// task.end is appended by finish() only; callers may record the rest.
const RECORDABLE = new Set(Schemas.EVENT_TYPES.filter((t) => t !== "task.end"));

function _iso(clock) {
    const v = clock();
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) throw new JournalError("JOURNAL_CLOCK_INVALID");
    return d.toISOString();
}

class StateJournal {
    constructor({ runId, shard, pageOrdinal, commit, configFp, planDigest, snapshotAt, clock } = {}) {
        this._h = { runId, shard, pageOrdinal, commit, configFp, planDigest, snapshotAt };
        this._clock = typeof clock === "function" ? clock : () => new Date();
        this._events = [];
        this._env = null;
        // Fail early on a bad header: validate a throwaway minimal envelope.
        const probe = this._build("ok", [], true);
        const r = Schemas.validateJournal(probe);
        if (!r.ok && !/^\$\.(events|count|digest)/.test(r.path) && r.code !== "EVENT_ID") {
            throw new JournalError("JOURNAL_HEADER_INVALID:" + r.code, r.path);
        }
    }

    record(type, scn, rep, payload) {
        if (this._env) throw new JournalError("JOURNAL_FINISHED");
        if (!RECORDABLE.has(type)) throw new JournalError("JOURNAL_TYPE_INVALID");
        if (this._events.length >= Limits.JOURNAL_MAX_EVENTS - 1) throw new JournalError("JOURNAL_FULL");
        const s = scn === undefined ? null : scn;
        const r = rep === undefined ? null : rep;
        if (s !== null && !(Number.isInteger(s) && s >= 0 && s <= 100000)) throw new JournalError("JOURNAL_SCN_INVALID");
        if (r !== null && !(Number.isInteger(r) && r >= 0 && r <= 1000)) throw new JournalError("JOURNAL_REP_INVALID");
        const v = Schemas.validateEventPayload(type, payload);
        if (!v.ok) throw new JournalError("JOURNAL_PAYLOAD_INVALID:" + v.code, v.path);
        const seq = this._events.length + 1;
        this._events.push({
            seq,
            id: Schemas.eventId(this._h.runId, this._h.pageOrdinal, s, r, type, seq),
            type,
            scn: s,
            rep: r,
            at: _iso(this._clock),
            p: JSON.parse(JSON.stringify(payload)),
        });
    }

    get size() { return this._events.length; }

    _build(status, events, probe) {
        const h = this._h;
        const digest = Schemas.sha256(Schemas.canonicalJson(events));
        return {
            schema: "falcon.journal", v: 1, runId: h.runId, shard: h.shard, pageOrdinal: h.pageOrdinal,
            commit: h.commit, configFp: h.configFp, planDigest: h.planDigest, snapshotAt: h.snapshotAt,
            events, count: events.length, digest: probe ? "0".repeat(64) : digest,
        };
    }

    finish(status) {
        if (this._env) throw new JournalError("JOURNAL_FINISHED");
        if (status !== "ok" && status !== "failed") throw new JournalError("JOURNAL_STATUS_INVALID");
        const seq = this._events.length + 1;
        const events = this._events.concat([{
            seq,
            id: Schemas.eventId(this._h.runId, this._h.pageOrdinal, null, null, "task.end", seq),
            type: "task.end", scn: null, rep: null, at: _iso(this._clock),
            p: { status, eventCount: this._events.length },
        }]);
        const env = this._build(status, events, false);
        const v = Schemas.validateJournal(env);
        if (!v.ok) throw new JournalError("JOURNAL_ENVELOPE_INVALID:" + v.code, v.path);
        this._env = env;
        return env;
    }

    toJSON() {
        if (!this._env) throw new JournalError("JOURNAL_NOT_FINISHED");
        return this._env;
    }
}

module.exports = StateJournal;
module.exports.StateJournal = StateJournal;
module.exports.JournalError = JournalError;
module.exports.eventId = Schemas.eventId;
