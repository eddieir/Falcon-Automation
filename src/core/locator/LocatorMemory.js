"use strict";

const path = require("path");
const V = require("./LocatorMemoryValidation");
const Writer = require("./LocatorMemoryWriter");
const crypto = require("crypto");
const AtomicJsonStore = require("../util/AtomicJsonStore");
const LocatorIdentity = require("./LocatorIdentity");
const ElementSignature = require("./ElementSignature");
const Logger = require("../../../utils/Logger");

/** Scoped trusted evidence and explicit review decisions.
 * Authored-selector evidence is trusted; matched candidates remain pending.
 * Durable decisions require a content-addressed proposal ID and persist before
 * installing state. External salts are never serialized. Unsupported envelopes
 * and salt mismatches remain untouched and cannot provide trusted evidence.
 * Writes use an exclusive adjacent lock plus an expected durable-file digest.
 * Quarantine surfaces retain only bounded metadata, never raw historical rows.
 */

const SCHEMA_VERSION = 1;
const MAX_TRACKED_IDENTITIES = 500;
const REJECTIONS_MAX_ROWS = 500;
const LOGGED_EVICTION_SAMPLE = 10;

function _clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function _isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/** Own-property-only, prototype-chain-safe read (S-Q8 posture, belt-and-braces). */
function _safeGet(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

class LocatorMemory {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.memoryPath] - override the on-disk path (tests use
   *   this to point at a temp directory so they never touch real `data/`).
   * @param {NodeJS.ProcessEnv} [opts.env] - override the environment read
   *   for `FALCON_LOCATOR_SALT` (tests use this instead of mutating
   *   `process.env`).
   */
  constructor({ memoryPath, env } = {}) {
    this.memoryPath = memoryPath || path.join(__dirname, "..", "..", "..", "data", "locator_memory.json");
    this._env = env === undefined ? process.env : env;
    this._queue = Promise.resolve();
    // AC-08 / S-Q7: per-path write-failure visibility, same primitive every
    // other Phase 14 store composes in.
    this._writeFailures = new AtomicJsonStore.WriteFailureTracker();
    this._saltWarningLogged = false;
    this._rejectionsRotationLogged = false;
    this._reload();
  }

  /**
   * Resolve the salt per the precedence documented above. Never reads
   * `process.env` directly — always goes through `this._env`, set once at
   * construction, so tests never need to mutate global state.
   */
  _resolveSalt(raw) {
    const envSalt = _safeGet(this._env, "FALCON_LOCATOR_SALT");
    if (typeof envSalt === "string" && envSalt.length > 0) {
      return { salt: envSalt, saltSource: "env", generated: false };
    }
    if (typeof raw.salt === "string" && raw.salt.length > 0) {
      return { salt: raw.salt, saltSource: "file", generated: false };
    }
    return { salt: crypto.randomBytes(32).toString("hex"), saltSource: "file", generated: true };
  }

  /**
   * Pure classification of one raw `entries[key]` row: `{ok: true, entry}`
   * if it carries everything `recordEvidence`/`recordPendingCandidate`
   * require, or `{ok: false, reason}` if it must be quarantined into
   * `legacy` instead. Deterministic — depends only on `rawEntry` and `key`,
   * never on load order or the current time.
   */
  _classifyEntry(key, rawEntry) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      return { ok: false, reason: "not_an_object" };
    }
    const identity = rawEntry.identity;
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
      return { ok: false, reason: "missing_identity" };
    }
    if (identity.schemaVersion !== LocatorIdentity.SCHEMA_VERSION) {
      return { ok: false, reason: "identity_schema_version_below_current" };
    }
    for (const field of ["applicationId", "origin", "pathname", "originalSelector"]) {
      if (!_isNonEmptyString(identity[field])) {
        return { ok: false, reason: `missing_identity_field:${field}` };
      }
    }
    if (!LocatorIdentity.ALLOWED_ACTIONS.has(identity.action)) {
      return { ok: false, reason: "invalid_identity_action" };
    }
    if(this._decisionInProgress) throw new Error("locator decision in progress");
    if (!V.identity(identity)) return { ok: false, reason: "invalid_identity_bounds" };
    if (key !== LocatorIdentity.serialiseIdentity(identity)) {
      // The stored key must be the canonical serialisation of its own
      // identity — a mismatch means the row was hand-edited or corrupted in
      // a way that could otherwise let one identity's evidence be looked up
      // under a different identity's key.
      return { ok: false, reason: "key_identity_mismatch" };
    }
    if (rawEntry.trust !== "trusted" && rawEntry.trust !== "unproven" && rawEntry.trust !== "revoked") {
      // An unrecognised trust value is never treated as "trusted" by
      // omission — it is quarantined outright, same as any other malformed
      // row, rather than falling through to some implicit default.
      return { ok: false, reason: "invalid_trust" };
    }
    const hasSignature = rawEntry.signature && typeof rawEntry.signature === "object" && !Array.isArray(rawEntry.signature);
    if (rawEntry.trust === "trusted" && !hasSignature) {
      return { ok: false, reason: "trusted_without_signature" };
    }
    if (hasSignature && rawEntry.signature.schemaVersion !== ElementSignature.SCHEMA_VERSION) {
      return { ok: false, reason: "signature_schema_version_below_current" };
    }

    if (hasSignature && !V.signature(rawEntry.signature)) return {ok:false, reason:"invalid_signature_bounds"};
    return {
      ok: true,
      entry: {
        identity: _clone(identity),
        approvedAlternative: rawEntry.approvedAlternative && this._normalisePendingCandidate(rawEntry.approvedAlternative) && V.string(rawEntry.approvedAlternative.actor,128) && V.bytes(rawEntry.approvedAlternative)<=12000 ? {...this._normalisePendingCandidate(rawEntry.approvedAlternative),actor:rawEntry.approvedAlternative.actor,approvedAt:V.timestamp(rawEntry.approvedAlternative.approvedAt)} : null,
        decisionHistory: this._boundedHistory(rawEntry.decisionHistory),
        trust: rawEntry.trust,
        signature: hasSignature ? _clone(rawEntry.signature) : null,
        pendingCandidate: this._normalisePendingCandidate(rawEntry.pendingCandidate),
        firstSeen: V.timestamp(rawEntry.firstSeen),
        lastSeen: V.timestamp(rawEntry.lastSeen),
        revocationHistory: this._boundedHistory(rawEntry.revocationHistory),
      },
    };
  }

  /**
   * `pendingCandidate` is transient/advisory, not trust-bearing, so a
   * malformed one self-heals to `null` rather than quarantining the whole
   * entry (whose `signature`/`trust` may be perfectly good evidence).
   */
  _boundedHistory(rows) {
    if(!Array.isArray(rows)) return [];
    return rows.slice(-V.HISTORY_MAX).flatMap(row=>{
      if(!row || !V.string(row.actor,128) || !V.string(row.at,64)) return [];
      const event={actor:row.actor,at:V.timestamp(row.at)};
      if(["approve","reject","rollback"].includes(row.kind)) event.kind=row.kind;
      if(typeof row.note === "string" && row.note.length<=500) event.note=row.note;
      if(["trusted","unproven","revoked"].includes(row.priorTrust)) event.priorTrust=row.priorTrust;
      if(row.proposal) {try {event.proposal=V.proposal(row.proposal);}catch{return [];}}
      return [event];
    });
  }

  _normalisePendingCandidate(raw) {
    try {
      return {...V.proposal(raw), firstSeen: V.timestamp(raw.firstSeen), lastSeen: V.timestamp(raw.lastSeen), occurrences: Math.min(1000000,Math.max(1,Number(raw.occurrences)||1))};
    } catch { return null; }
  }

  /**
   * (Re)load from disk. Exposed (not private-by-convention-only) so tests
   * can swap `memoryPath` after construction and reload, mirroring
   * HealingTrust's test seam.
   *
   * Caps are enforced here too, not only on mutation (MAX_TRACKED_IDENTITIES,
   * REJECTIONS_MAX_ROWS) — a store loaded read-mostly must still honour its
   * invariants, not only the next time something is written.
   */
  _reload() {
    const fallback = { schemaVersion: SCHEMA_VERSION, salt: null, entries: {}, legacy: {}, rejections: [] };
    let raw;
    let oversized=false;
    try {
      const buffer=Writer.readBoundedSync(this.memoryPath);
      this._expectedDigest=V.hash(buffer);
      try {raw=JSON.parse(buffer.toString("utf8"));}
      catch {raw=AtomicJsonStore.readJsonSync(this.memoryPath,fallback);}
    } catch(error) {
      if(error.code === "EFBIG") {oversized=true;raw=fallback;this._expectedDigest=null;}
      else {this._expectedDigest=null;raw=AtomicJsonStore.readJsonSync(this.memoryPath,fallback);}
    }
    const saltFingerprint = V.hash(this._env.FALCON_LOCATOR_SALT || raw.salt || "");
    const invalidEnvelope = oversized || !raw || raw.schemaVersion !== SCHEMA_VERSION || V.bytes(raw) > V.MAX_BYTES;
    const saltMismatch = raw && raw.saltFingerprint && raw.saltFingerprint !== saltFingerprint;
    this._blockedEnvelope = invalidEnvelope || saltMismatch;
    if (this._blockedEnvelope) {
      // Preserve the original at its managed path; never rewrite unknown state.
      raw = fallback;
    }

    const { salt, saltSource, generated } = this._resolveSalt(raw);
    this.salt = salt;
    this.saltSource = saltSource;
    if (generated && !this._blockedEnvelope && !this._saltWarningLogged) {
      this._saltWarningLogged = true;
      Logger.warning(
        "LocatorMemory: FALCON_LOCATOR_SALT is not set; generated a new locator-signature salt and persisted it in "
        + "data/locator_memory.json's own header. The salt is stored in the same file as the hashes it protects, "
        + "so hashed values are not irrecoverable if this file is exposed. Set FALCON_LOCATOR_SALT to keep the salt "
        + "out of this file.",
      );
    }

    this.entries = new Map();
    this.legacy = new Map();
    let quarantinedCount = 0;

    const rawEntries = raw && typeof raw.entries === "object" && raw.entries && !Array.isArray(raw.entries) ? raw.entries : {};
    for (const [key, rawEntry] of Object.entries(rawEntries).slice(0,1000)) {
      const classification = this._classifyEntry(key, rawEntry);
      if (classification.ok) {
        this.entries.set(key, classification.entry);
      } else {
        quarantinedCount += 1;
        this.legacy.set(V.hash({key,rawEntry}), {
          digest: V.hash(rawEntry),
          reason: classification.reason,
          loadedAt: "1970-01-01T00:00:00.000Z",
        });
      }
    }

    // Rows already quarantined in a previous run are loaded as-is, keyed by
    // their existing opaque id — never reclassified, never merged back into
    // `entries`, so a legacy row can't bounce back to trusted on a later
    // load just because it happens to parse again.
    const rawLegacy = raw && typeof raw.legacy === "object" && raw.legacy && !Array.isArray(raw.legacy) ? raw.legacy : {};
    for (const [id, entry] of Object.entries(rawLegacy).slice(-500)) {
      this.legacy.set(id, {reason: typeof entry.reason === "string" ? entry.reason.slice(0,100) : "legacy", digest: entry.digest || V.hash(entry)});
    }

    if (quarantinedCount > 0) {
      Logger.warning(
        `LocatorMemory: quarantined ${quarantinedCount} row(s) from data/locator_memory.json into legacy on load `
        + "(missing required identity fields or a schemaVersion below current) — never auto-promoted.",
      );
    }

    this.rejections = Array.isArray(raw.rejections)
      ? raw.rejections.filter((row) => row && typeof row === "object" && !Array.isArray(row))
      : [];
    const rejectionsOverflow = this.rejections.length - REJECTIONS_MAX_ROWS;
    let rejectionsTrimmed = false;
    if (rejectionsOverflow > 0) {
      this.rejections = this.rejections.slice(-REJECTIONS_MAX_ROWS);
      rejectionsTrimmed = true;
      if (!this._rejectionsRotationLogged) {
        this._rejectionsRotationLogged = true;
        Logger.warning(
          `LocatorMemory: loaded rejections ledger had ${rejectionsOverflow + REJECTIONS_MAX_ROWS} rows, exceeding `
          + `REJECTIONS_MAX_ROWS (${REJECTIONS_MAX_ROWS}); dropped ${rejectionsOverflow} oldest row(s).`,
        );
      }
    }
    this.rejections = this.rejections.filter(row => V.bytes(row) <= 12000).map(row => ({...row,rejectedAt:V.timestamp(row.rejectedAt)}));
    this.legacy = new Map([...this.legacy].slice(-500));
    this._buildRejectionIndex();

    const evictedCount = this._evictIfNeeded();

    if (!this._blockedEnvelope && (generated || quarantinedCount > 0 || rejectionsTrimmed || evictedCount > 0)) {
      this._persist();
    }
  }

  /**
   * Fold `this.rejections` (append-only, time order) into
   * `Map<JSON.stringify([identityKey, candidateSelector]), {count,
   * lastRejectedAt, lastRejectedBy}>`. Mirrors HealingTrust's
   * `_buildRejectionIndex` exactly in spirit: identity is the exact pair,
   * case-sensitive, no normalisation.
   */
  _buildRejectionIndex() {
    const index = new Map();
    for (const row of this.rejections) {
      if (!row || typeof row !== "object") continue;
      if (typeof row.identityKey !== "string" || typeof row.candidateSelector !== "string") continue;
      if (typeof row.rejectedAt !== "string" || Number.isNaN(Date.parse(row.rejectedAt))) continue;

      const key = JSON.stringify([row.identityKey, row.candidateSelector]);
      const prior = index.get(key) ?? { count: 0, lastRejectedAt: null, lastRejectedBy: null };
      index.set(key, {
        count: prior.count + 1,
        lastRejectedAt: row.rejectedAt,
        lastRejectedBy: typeof row.rejectedBy === "string" ? row.rejectedBy : null,
      });
    }
    this._rejectionIndex = index;
  }

  /**
   * True if the exact (identityKey, candidateSelector) pair was previously
   * rejected. Always recomputed fresh from `_rejectionIndex` — never read
   * from any field cached on a stored entry — so it can't go stale when a
   * later rejection is recorded or an old one ages out of the capped
   * ledger.
   */
  previouslyRejected(identityKey, candidateSelector) {
    const rejectionKey = JSON.stringify([identityKey, candidateSelector]);
    const rejection = this._rejectionIndex.get(rejectionKey);
    return rejection
      ? { ...rejection }
      : { count: 0, lastRejectedAt: null, lastRejectedBy: null };
  }

  /**
   * Keep at most MAX_TRACKED_IDENTITIES entries, evicting the ones with the
   * oldest `lastSeen` first; ties (including entries sharing an unparseable
   * `lastSeen`) are broken by ascending key for determinism. Mirrors
   * HealingTrust's `_evictPendingIfNeeded` sampling/logging shape exactly.
   * Returns the number of entries evicted.
   */
  _evictIfNeeded() {
    const oldest=[...this.entries.keys()].sort((a,b)=> (Date.parse(this.entries.get(a).lastSeen)||0)-(Date.parse(this.entries.get(b).lastSeen)||0)||a.localeCompare(b));
    let removed=0;
    while(this.entries.size>MAX_TRACKED_IDENTITIES || V.bytes(this._toPersistable())>V.MAX_BYTES) {
      const key=oldest.shift();
      if(!key) break;
      this.entries.delete(key); removed++;
    }
    if(removed) Logger.warning(`LocatorMemory bounded storage evicted ${removed} oldest entries.`);
    return removed;
  }

  /** Serialise current in-memory state into the on-disk JSON shape. */
  _toPersistable() {
    return {
      schemaVersion: SCHEMA_VERSION,
      ...(this.saltSource === "file" ? {salt: this.salt} : {}),
      saltFingerprint: V.hash(this.salt),
      saltSource: this.saltSource,
      entries: Object.fromEntries(this.entries),
      legacy: Object.fromEntries(this.legacy),
      rejections: this.rejections,
    };
  }

  /**
   * Queue exactly one atomic write of the full current state. S-Q7: a
   * single `writeJsonAtomic` call to this store's one managed path per
   * invocation — there is no second path in the same chain whose success
   * could mask this one's failure.
   */
  async _writeState(data) {
    let result;
    if(this._blockedEnvelope) result={ok:false,error:"unsupported schema or salt mismatch; original file preserved"};
    else if(V.bytes(data)>V.MAX_BYTES) result={ok:false,error:"memory serialized size exceeds bound"};
    else result=await Writer.write(this.memoryPath,data,this._expectedDigest,AtomicJsonStore.writeJsonAtomic);
    this._writeFailures.record(this.memoryPath,result);
    if(result.ok) this._expectedDigest=result.digest;
    return result;
  }

  _persist() {
    const snapshot = _clone(this._toPersistable());
    this._queue = this._queue.then(() => this._writeState(snapshot));
    return this._queue;
  }

  /**
   * Ground-truth refresh (the ONLY path that can grant trusted evidence from
   * nothing). `identity` is a `LocatorIdentity`-shaped object; its canonical
   * key is derived here, never accepted as a separate argument, so a caller
   * can never pass a key that doesn't match its own identity.
   */
  recordEvidence(identity, signature) {
    if(this._decisionInProgress) throw new Error("locator decision in progress");
    if (!V.identity(identity) || !V.signature(signature)) throw new Error("invalid locator evidence");
    identity = _clone(identity); signature = _clone(signature);
    const key = LocatorIdentity.serialiseIdentity(identity);
    const existing = this.entries.get(key);
    const now = new Date().toISOString();
    const entry = {
      identity,
      approvedAlternative: existing ? existing.approvedAlternative : null,
      decisionHistory: existing ? existing.decisionHistory : [],
      trust: "trusted",
      signature,
      pendingCandidate: existing ? existing.pendingCandidate : null,
      firstSeen: existing ? existing.firstSeen : now,
      lastSeen: now,
      revocationHistory: existing ? existing.revocationHistory : [],
    };
    this.entries.set(key, entry);
    this._evictIfNeeded();
    this._persist();
    return _clone(entry);
  }

  /**
   * Tier 2.5 proposal. Touches `entries[key].pendingCandidate` ONLY — never
   * `trust`, never `signature`. If no entry exists yet for this identity (a
   * candidate proposed before any ground truth was ever recorded for it), a
   * new entry is created with `trust: "unproven"` and `signature: null`.
   * `getTrusted()` treats `"unproven"` exactly like `"revoked"` (no usable
   * evidence), but the two are NOT the same thing and must never be
   * conflated: `"unproven"` carries an empty `revocationHistory` because
   * nothing was ever revoked, whereas `"revoked"` always carries at least
   * one attributed row. Using `"revoked"` here (an earlier draft of this
   * module did) would have produced self-contradictory audit data — an
   * entry claiming to have been revoked, by nobody, at no time.
   */
  recordPendingCandidate(identity, candidate) {
    if(this._decisionInProgress) throw new Error("locator decision in progress");
    if (!V.identity(identity)) throw new Error("invalid locator identity");
    identity = _clone(identity);
    const proposed = V.proposal(candidate);
    const key = LocatorIdentity.serialiseIdentity(identity);
    const existing = this.entries.get(key);
    const now = new Date().toISOString();
    const priorCandidate = existing ? existing.pendingCandidate : null;
    const sameProposal = priorCandidate && priorCandidate.proposalId === proposed.proposalId;
    if(existing && existing.approvedAlternative?.proposalId === proposed.proposalId && existing.trust === "trusted") return _clone(existing);
    const pendingCandidate = {...proposed,firstSeen:sameProposal?priorCandidate.firstSeen:now,lastSeen:now,occurrences:sameProposal?Math.min(1000000,priorCandidate.occurrences+1):1};

    const entry = existing
      ? { ...existing, pendingCandidate, lastSeen: now }
      : {
        identity,
        trust: "unproven",
        signature: null,
        pendingCandidate,
        firstSeen: now,
        lastSeen: now,
        revocationHistory: [],
      };

    this.entries.set(key, entry);
    this._evictIfNeeded();
    this._persist();
    return _clone(entry);
  }

  /**
   * Promote `pendingCandidate` into `signature` + `trust: "trusted"`,
   * clearing `pendingCandidate`. Works from BOTH `"unproven"` (the ordinary
   * case: a fresh Tier 2.5 candidate with no prior ground truth) and
   * `"trusted"` (refreshing an already-trusted entry's evidence) starting
   * states. Refuses (leaving the entry completely untouched, logging why)
   * ONLY if the entry's current `trust` is `"revoked"` — this is the
   * rollback -> re-approve loophole closure: once a human has revoked an
   * identity's trust, the ONLY way back is a fresh `recordEvidence()` call,
   * never re-approving old (or newly arrived) candidate evidence sitting
   * next to the revocation. The guard checks for `"revoked"` specifically
   * (not `!== "trusted"`) precisely so it does not also catch `"unproven"`
   * — an earlier draft of this module used `"revoked"` as the placeholder
   * for "no evidence yet", which would have made this same guard wrongly
   * block the primary approval path for every first-time candidate; keeping
   * the two states distinct is what makes this check correct.
   *
   * Returns `null` if there is no entry, no pendingCandidate, or the entry
   * is revoked; otherwise the approved (cloned) entry.
   */
  _applyApprove(key, { approvedBy = "dashboard", proposalId } = {}) {
    if(this._decisionInProgress) return null;
    const entry = this.entries.get(key);
    if (!entry || !entry.pendingCandidate || (!proposalId || entry.pendingCandidate.proposalId !== proposalId)) return null;
    if (entry.trust === "revoked") {
      Logger.warning(
        `LocatorMemory: refused to approve a pending candidate for a revoked identity (key=${key}); `
        + "a revoked identity can only regain trusted evidence via recordEvidence() (a fresh ground-truth pass), "
        + "never by re-approving candidate evidence.",
      );
      return null;
    }

    if(!V.string(approvedBy,128)) return null;
    const now = new Date().toISOString();
    const approved = {
      ...entry,
      trust: "trusted",
      signature: _clone(entry.pendingCandidate.signature),
      approvedAlternative: {..._clone(entry.pendingCandidate),actor:approvedBy,approvedAt:now},
      decisionHistory: this._boundedHistory([...(entry.decisionHistory || []),{kind:"approve",actor:approvedBy,at:now,proposal:_clone(entry.pendingCandidate),priorTrust:entry.trust}]),
      pendingCandidate: null,
      lastSeen: now,
    };
    this.entries.set(key, approved);
    this._evictIfNeeded();
    this._persist();

    return _clone(approved);
  }

  /**
   * Discard `pendingCandidate` without ever promoting it, and record the
   * rejection so a repeated identical proposal can surface as "previously
   * rejected" via `previouslyRejected()`. Returns `null` if there is no
   * entry or no pendingCandidate to reject.
   */
  _applyReject(key, { rejectedBy = "dashboard", proposalId } = {}) {
    if(this._decisionInProgress) return null;
    const entry = this.entries.get(key);
    if (!entry || !entry.pendingCandidate || (!proposalId || entry.pendingCandidate.proposalId !== proposalId)) return null;

    if(!V.string(rejectedBy,128)) return null;
    const candidateSelector = entry.pendingCandidate.selector;
    const now = new Date().toISOString();
    const rejected = { ...entry, pendingCandidate: null, lastSeen: now, decisionHistory:this._boundedHistory([...(entry.decisionHistory || []),{kind:"reject",actor:rejectedBy,at:now,proposal:_clone(entry.pendingCandidate),priorTrust:entry.trust}]) };
    this.entries.set(key, rejected);

    this.rejections.push({ identityKey: key, candidateSelector, rejectedBy, rejectedAt: now });
    if (this.rejections.length > REJECTIONS_MAX_ROWS) {
      this.rejections = this.rejections.slice(-REJECTIONS_MAX_ROWS);
      if (!this._rejectionsRotationLogged) {
        this._rejectionsRotationLogged = true;
        Logger.warning(
          `LocatorMemory rejections ledger reached its cap (REJECTIONS_MAX_ROWS=${REJECTIONS_MAX_ROWS}) `
          + "and began discarding its oldest row. Further rotations this process will not be logged individually.",
        );
      }
    }
    this._buildRejectionIndex();
    this._evictIfNeeded();
    this._persist();
    return _clone(rejected);
  }

  /**
   * Revoke trust in an identity's current evidence, from ANY starting
   * `trust` value (`"trusted"`, `"unproven"`, or an already-`"revoked"`
   * entry — rolling back twice just appends a second row). The entry is
   * never deleted: `signature` is left exactly as it was (inspectable for
   * audit) and `revocationHistory` (append-only, never cleared) always
   * gains exactly one more `{actor, at, note?}` row.
   *
   * Permitting this from `"unproven"` is deliberate: an operator explicitly
   * rejecting a candidate that was never trusted in the first place is a
   * real decision worth recording, not a no-op — and it must look like one
   * in the audit trail (an attributed revocationHistory row), never like a
   * silent nothing-happened. This is what keeps `"unproven"` from ever being
   * confused with `"revoked"`: the latter is only ever reached through this
   * method, so it always carries at least one attributed row; `"unproven"`
   * never does.
   *
   * Returns `null` if there is no entry for `identityKey`.
   */
  _applyRollback(identityKey, { actor = "dashboard", note } = {}) {
    if(this._decisionInProgress) return null;
    const entry = this.entries.get(identityKey);
    if (!entry) return null;

    const now = new Date().toISOString();
    if(!V.string(actor,128) || (note!==undefined && (typeof note!=="string" || note.length>500))) return null;
    const revocationEvent = note !== undefined ? { actor, at: now, note } : { actor, at: now };
    const revoked = {
      ...entry,
      trust: "revoked",
      lastSeen: now,
      approvedAlternative: null,
      pendingCandidate: null,
      decisionHistory: this._boundedHistory([...(entry.decisionHistory || []),{kind:"rollback",...revocationEvent,proposal:_clone(entry.pendingCandidate || entry.approvedAlternative),priorTrust:entry.trust}]),
      revocationHistory: this._boundedHistory([...entry.revocationHistory, revocationEvent]),
    };
    this.entries.set(identityKey, revoked);
    this._evictIfNeeded();
    this._persist();
    return _clone(revoked);
  }

  /**
   * Usable evidence for `identity`, or `null` if none exists or the entry's
   * trust is anything other than `"trusted"` (revoked, or the
   * "revoked"-as-no-evidence-yet state a candidate-only entry starts in).
   * Returns a defensive copy; mutating the result can never affect this
   * store's internal state.
   */
  getTrusted(identity) {
    const key = LocatorIdentity.serialiseIdentity(identity);
    const entry = this.entries.get(key);
    if (!entry || entry.trust !== "trusted") return null;
    return _clone({ identity: entry.identity, signature: entry.signature, approvedAlternative:entry.approvedAlternative, firstSeen: entry.firstSeen, lastSeen: entry.lastSeen });
  }

  _revision(entry) {
    function substantive(v) {
      if(Array.isArray(v)) return v.map(substantive);
      if(v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k])=>!["lastSeen","firstSeen","occurrences","capturedAt"].includes(k)).map(([k,value])=>[k,substantive(value)]));
      return v;
    }
    return V.hash(substantive(entry));
  }

  async approve(key,{approvedBy="dashboard",proposalId}={}) {const r=await this.decide("approve",key,{actor:approvedBy,proposalId});return r.ok?r.entry:null;}
  async reject(key,{rejectedBy="dashboard",proposalId}={}) {const r=await this.decide("reject",key,{actor:rejectedBy,proposalId});return r.ok?r.entry:null;}
  async rollback(key,{actor="dashboard",note,expectedRevision,proposalId}={}) {const r=await this.decide("rollback",key,{actor,note,expectedRevision,proposalId});return r.ok?r.entry:null;}

  getApprovedAlternatives(identity) {
    const trusted=this.getTrusted(identity);
    return trusted?.approvedAlternative ? [_clone(trusted.approvedAlternative)] : [];
  }

  decide(kind,key,{proposalId,expectedRevision,actor="dashboard",note}={}) {
    const operation=async () => {
      const fail=(status,error)=>({ok:false,status,entry:null,error});
      if(!["approve","reject","rollback"].includes(kind) || !V.string(actor,128) || (note!==undefined && (typeof note!=="string" || note.length>500))) return fail(400,"invalid decision");
      if(kind !== "rollback" && !V.string(proposalId,64)) return fail(400,"proposalId required");
      if(kind === "rollback" && !V.string(expectedRevision,64) && !V.string(proposalId,64)) return fail(400,"expectedRevision required");
      const current=this.entries.get(key);
      if(!current) return fail(404,"identity missing");
      const expected=kind === "rollback" ? current.approvedAlternative || current.pendingCandidate : current.pendingCandidate;
      if(kind === "rollback" ? (expectedRevision ? this._revision(current) !== expectedRevision : !expected || expected.proposalId !== proposalId) : current.trust === "revoked" || !expected || expected.proposalId !== proposalId) return fail(409,"stale or revoked proposal");
      // Stage using the same pure state transformations as the low-level API.
      const oldEntries=this.entries,oldRejections=this.rejections,oldQueue=this._queue;
      this.entries=new Map([...oldEntries].map(([k,v])=>[k,_clone(v)])); this.rejections=_clone(oldRejections);
      const persist=this._persist; this._persist=()=>Promise.resolve();
      let entry;
      try {entry=kind==="approve"?this._applyApprove(key,{approvedBy:actor,proposalId}):kind==="reject"?this._applyReject(key,{rejectedBy:actor,proposalId}):this._applyRollback(key,{actor,note});}
      finally {this._persist=persist;}
      const stagedEntries=this.entries,stagedRejections=this.rejections,data=_clone(this._toPersistable());
      this.entries=oldEntries;this.rejections=oldRejections;this._queue=oldQueue;this._buildRejectionIndex();
      this._decisionInProgress=true;
      let result;
      try {result=await this._writeState(data);} finally {this._decisionInProgress=false;}
      if(!result.ok) return fail(503,result.error);
      this.entries=stagedEntries;this.rejections=stagedRejections;this._buildRejectionIndex();
      return {ok:true,status:200,entry:{..._clone(entry),revision:this._revision(entry)},error:null};
    };
    const result=this._queue.then(operation);
    this._queue=result.then(()=>undefined);
    return result;
  }

  /** Defensive copy of one entry by its canonical key, or `null`. */
  getEntry(key) {
    const entry = this.entries.get(key);
    return entry ? {..._clone(entry),revision:this._revision(entry)} : null;
  }

  /**
   * Defensive copies of every tracked entry, keyed by canonical identity
   * key. Returns a keyed OBJECT rather than an array like
   * `HealingTrust.list()` — a deliberate divergence, not an inconsistency:
   * HealingTrust's pending entries already embed their own key (`original`)
   * as a field, so flattening to an array loses nothing, whereas a
   * `LocatorMemory` entry does not otherwise carry its own key (it exists
   * only as the Map key / object property name). A keyed object lets a
   * caller look an entry up by key directly; each entry ALSO carries its
   * own `key` field (duplicating the property name) specifically so that a
   * caller who flattens this to an array (e.g. `Object.values(list())`)
   * still has what `approve()`/`reject()`/`rollback()` require, rather than
   * having to re-derive it via `LocatorIdentity.serialiseIdentity` itself.
   *
   * AC-36: every entry whose `pendingCandidate` is non-null gets a
   * `previouslyRejected` field folded onto that `pendingCandidate`,
   * recomputed fresh from the rejection index via `previouslyRejected()` —
   * never read from any field stored on the entry, so it can't go stale.
   * This mirrors `HealingTrust.list()`'s `_hydratePreviouslyRejected`
   * posture deliberately: the signal is folded into every listed entry so a
   * consumer iterating this list cannot forget to check it, rather than
   * being an opt-in second call a future implementer could easily skip.
   */
  list() {
    const out = {};
    for (const [key, entry] of this.entries) {
      const cloned = _clone(entry);
      cloned.key = key;
      cloned.revision = this._revision(entry);
      if (cloned.pendingCandidate) {
        cloned.pendingCandidate.previouslyRejected = this.previouslyRejected(key, cloned.pendingCandidate.selector);
      }
      out[key] = cloned;
    }
    return out;
  }

  /** Defensive copies of every quarantined legacy row, keyed by opaque id. */
  listLegacy() {
    const out = Object.create(null);
    for (const [id, entry] of this.legacy) out[id] = {reason: entry.reason, digest: entry.digest || V.hash(entry)};
    return out;
  }

  /**
   * Permanently remove one quarantined legacy row. Legacy rows are never
   * auto-promoted into `entries` by any code path — this is the only way
   * one is ever removed, and it is a deletion, never a promotion. Returns
   * `true` if a row was removed, `false` if `opaqueId` was not present.
   */
  deleteLegacy(opaqueId, { actor = "dashboard" } = {}) {
    if(this._decisionInProgress) return false;
    if (!this.legacy.has(opaqueId)) return false;
    this.legacy.delete(opaqueId);
    Logger.info(`LocatorMemory: legacy row ${opaqueId} deleted by ${actor}.`);
    this._persist();
    return true;
  }

  /**
   * AC-08: true if the last write to this store's managed path did not
   * durably land on disk.
   */
  hasUnpersistedWriteFailure() {
    return this._writeFailures.hasUnpersistedWriteFailure();
  }

  /**
   * AC-08: the most recent unpersisted write failure (`{path, error, at}`),
   * or `null` if none is currently outstanding.
   */
  lastWriteError() {
    return this._writeFailures.lastWriteError();
  }
}

LocatorMemory.SCHEMA_VERSION = SCHEMA_VERSION;
LocatorMemory.MAX_TRACKED_IDENTITIES = MAX_TRACKED_IDENTITIES;
LocatorMemory.REJECTIONS_MAX_ROWS = REJECTIONS_MAX_ROWS;

module.exports = LocatorMemory;
