"use strict";

const path = require("path");
const crypto = require("crypto");
const AtomicJsonStore = require("../util/AtomicJsonStore");
const LocatorIdentity = require("./LocatorIdentity");
const ElementSignature = require("./ElementSignature");
const Logger = require("../../../utils/Logger");

/**
 * LocatorMemory — Phase 14 (EP-5 §7) trusted-evidence store for scoped
 * locator identities.
 *
 * Persists to `data/locator_memory.json`, a NEW path. It deliberately does
 * NOT reuse `data/locator_store.json`: that file holds bare Tier 2
 * alternative-selector strings with no signature evidence at all, and
 * synthesising a signature for those rows would mean inventing evidence that
 * was never actually captured. The two stores stay structurally separate so
 * neither can be mistaken for the other's guarantees.
 *
 * ---------------------------------------------------------------------------
 * THE TRUST INVARIANT — two ingestion paths, asymmetric on purpose:
 *
 *   1. `recordEvidence(identity, signature)` — ground-truth refresh. Writes
 *      `entries[key]` directly as `trust: "trusted"`, no approval step, no
 *      score involved. This is legitimate because it records what the
 *      developer's own authored selector (Tier 1) currently resolves to —
 *      exactly as unconditionally trusted as Tier 1 already is today. It is
 *      the ONLY path that can ever grant an identity trusted evidence from
 *      nothing.
 *
 *   2. `recordPendingCandidate(identity, candidate)` — Tier 2.5 proposal.
 *      Writes into `entries[key].pendingCandidate` ONLY; it must never touch
 *      that entry's `trust` or `signature`. A match score, however high, can
 *      never manufacture trust by itself. Promotion happens solely through
 *      `approve()`.
 *
 * THREE TRUST STATES (`trust: "trusted" | "unproven" | "revoked"`):
 *
 *   - `"trusted"` — usable evidence, granted only by `recordEvidence()` or by
 *     `approve()` promoting a pending candidate.
 *   - `"unproven"` — the state a BRAND-NEW entry gets when
 *     `recordPendingCandidate()` is called for an identity that has never
 *     had ground truth recorded for it. There is no usable evidence, but
 *     critically, NOTHING WAS EVER REVOKED: `revocationHistory` starts empty
 *     and stays empty until an actual revocation decision is made. This
 *     state exists specifically so the ledger never lies — an entry must
 *     never claim `trust: "revoked"` with an empty, attributionless
 *     `revocationHistory`, because that is self-contradictory audit data in
 *     a phase whose entire point is that trust changes are attributable.
 *   - `"revoked"` — a human (or `rollback()`) actively withdrew trust;
 *     `revocationHistory` always has at least one `{actor, at, note?}` row
 *     when this state is reached, because the only code path that sets it
 *     is `rollback()`, which always appends one.
 *
 * `approve(key, { approvedBy })` promotes `pendingCandidate` into
 * `signature` + `trust: "trusted"` and clears `pendingCandidate` for BOTH
 * `"unproven"` and `"trusted"` source entries (an unproven entry approving
 * its first candidate is the ordinary, expected Tier 2.5 path) — UNLESS the
 * entry's current `trust` is `"revoked"`, in which case it refuses and
 * leaves the entry completely untouched. This closes the rollback ->
 * re-approve loophole: a human revoking trust in a piece of evidence must
 * not be undoable by re-approving a candidate that was sitting there before
 * (or arrives after) the rollback. The ONLY way a revoked identity regains
 * trusted evidence is a fresh `recordEvidence()` call — i.e. a human fixing
 * the test so Tier 1 passes again.
 *
 * `rollback(identityKey, { actor, note })` sets `trust: "revoked"` (never
 * deletes the entry) and appends to the append-only `revocationHistory`. It
 * is deliberately permitted from ANY prior state, including `"unproven"`:
 * an operator looking at a never-trusted candidate and explicitly rejecting
 * it is a real, auditable decision (distinct from simply never having
 * approved it), and it must produce the same kind of attributable record as
 * revoking previously-trusted evidence — never a silently-indistinguishable
 * no-op. `getTrusted()` treats anything other than `trust === "trusted"`
 * (both `"unproven"` and `"revoked"`) as "no usable evidence", so neither
 * state is ever reused, while `"revoked"`'s history and prior signature stay
 * inspectable for audit.
 *
 * ---------------------------------------------------------------------------
 * SALT (finding F14-1): the HMAC salt `ElementSignature.capture()` requires
 * must stay stable across runs so hashes remain comparable. Precedence:
 *   1. `FALCON_LOCATOR_SALT` from the environment, if set to a non-empty
 *      string — `saltSource: "env"`. Never persisted into the file; an
 *      operator who supplies their own salt keeps it out of the store
 *      entirely.
 *   2. Otherwise, a salt already persisted in this file's own header —
 *      `saltSource: "file"`.
 *   3. Otherwise, a freshly generated random salt, persisted into this
 *      file's header so later runs reuse it — also `saltSource: "file"`,
 *      and logged exactly once (never claiming the values are
 *      irrecoverable: a salt stored in the same file as the hashes it
 *      protects is a real, stated weakness, not a solved one — it leaves
 *      low-entropy values brute-forceable offline by anyone who can read
 *      this file).
 *
 * ---------------------------------------------------------------------------
 * LEGACY HANDLING — scoped to this file's OWN rows only (never
 * `locator_store.json`, which keeps serving Tier 2 untouched). A row in the
 * persisted `entries` object that is missing a required identity field, has
 * an unrecognised `trust` value, claims `trust: "trusted"` with no
 * signature, or whose `identity.schemaVersion` is not exactly the current
 * `LocatorIdentity.SCHEMA_VERSION`, is quarantined into `legacy` instead of
 * loaded into `entries`. Quarantining is a pure function of the row's own
 * content (never of load order or wall-clock time), so the same file always
 * classifies the same way. Legacy rows are never read by the matcher, never
 * auto-promoted, and are only ever removed via the explicit
 * `deleteLegacy(opaqueId, { actor })`. Only a COUNT of newly-quarantined
 * rows is ever logged — never raw content.
 *
 * ---------------------------------------------------------------------------
 * SECURITY (S-Q8): `entries`, `legacy`, and the rejection index are all
 * backed by `Map`, not plain objects — a locator identity key or a
 * generated legacy id can never repoint `Object.prototype` or be masked by
 * an inherited member, regardless of what string it happens to be (this is
 * strictly stronger than the `Object.hasOwn`/`Object.defineProperty`
 * discipline used elsewhere in this codebase, and was chosen specifically
 * so legacy ids need no separate provably-collision-safe-format argument:
 * a `Map` makes the question moot). Every accessor below returns a
 * defensive (deep) copy; nothing lets a caller mutate this store's internal
 * state by reference.
 *
 * SECURITY (S-Q7): `_persist()` performs exactly one `writeJsonAtomic` per
 * call, to this store's single managed path (`this.memoryPath`) — there is
 * structurally no second path for a later success to mask an earlier
 * failure against. The per-path `AtomicJsonStore.WriteFailureTracker` is
 * still composed in (rather than a single `_lastWriteFailure` slot) so the
 * aggregation discipline is identical to every other Phase 14 store and
 * would keep working correctly unchanged if a future slice ever adds a
 * second managed path to this store.
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

    return {
      ok: true,
      entry: {
        identity,
        trust: rawEntry.trust,
        signature: hasSignature ? rawEntry.signature : null,
        pendingCandidate: this._normalisePendingCandidate(rawEntry.pendingCandidate),
        firstSeen: _isNonEmptyString(rawEntry.firstSeen) ? rawEntry.firstSeen : new Date().toISOString(),
        lastSeen: _isNonEmptyString(rawEntry.lastSeen) ? rawEntry.lastSeen : new Date().toISOString(),
        revocationHistory: Array.isArray(rawEntry.revocationHistory) ? rawEntry.revocationHistory : [],
      },
    };
  }

  /**
   * `pendingCandidate` is transient/advisory, not trust-bearing, so a
   * malformed one self-heals to `null` rather than quarantining the whole
   * entry (whose `signature`/`trust` may be perfectly good evidence).
   */
  _normalisePendingCandidate(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (!_isNonEmptyString(raw.selector)) return null;
    if (!raw.signature || typeof raw.signature !== "object") return null;
    return {
      selector: raw.selector,
      signature: raw.signature,
      contributions: raw.contributions && typeof raw.contributions === "object" ? raw.contributions : {},
      total: typeof raw.total === "number" ? raw.total : 0,
      firstSeen: _isNonEmptyString(raw.firstSeen) ? raw.firstSeen : new Date().toISOString(),
      lastSeen: _isNonEmptyString(raw.lastSeen) ? raw.lastSeen : new Date().toISOString(),
      occurrences: Number.isFinite(raw.occurrences) ? raw.occurrences : 1,
    };
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
    const raw = AtomicJsonStore.readJsonSync(this.memoryPath, fallback);

    const { salt, saltSource, generated } = this._resolveSalt(raw);
    this.salt = salt;
    this.saltSource = saltSource;
    if (generated && !this._saltWarningLogged) {
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
    for (const [key, rawEntry] of Object.entries(rawEntries)) {
      const classification = this._classifyEntry(key, rawEntry);
      if (classification.ok) {
        this.entries.set(key, classification.entry);
      } else {
        quarantinedCount += 1;
        this.legacy.set(crypto.randomUUID(), {
          rawEntry,
          reason: classification.reason,
          loadedAt: new Date().toISOString(),
        });
      }
    }

    // Rows already quarantined in a previous run are loaded as-is, keyed by
    // their existing opaque id — never reclassified, never merged back into
    // `entries`, so a legacy row can't bounce back to trusted on a later
    // load just because it happens to parse again.
    const rawLegacy = raw && typeof raw.legacy === "object" && raw.legacy && !Array.isArray(raw.legacy) ? raw.legacy : {};
    for (const [id, entry] of Object.entries(rawLegacy)) {
      this.legacy.set(id, entry);
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
    this._buildRejectionIndex();

    const evictedCount = this._evictIfNeeded();

    if (generated || quarantinedCount > 0 || rejectionsTrimmed || evictedCount > 0) {
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
    const keys = [...this.entries.keys()];
    const overflow = keys.length - MAX_TRACKED_IDENTITIES;
    if (overflow <= 0) return 0;

    const toEvict = keys
      .map((key) => ({ key, lastSeenMs: Date.parse(this.entries.get(key)?.lastSeen) || 0 }))
      .sort((a, b) => a.lastSeenMs - b.lastSeenMs || a.key.localeCompare(b.key))
      .slice(0, overflow);

    const shown = toEvict.slice(0, LOGGED_EVICTION_SAMPLE);
    const remaining = toEvict.length - shown.length;
    const details = shown.map(({ key }) => `"${key}"`);
    const suffix = remaining > 0 ? `, ... and ${remaining} more` : "";
    Logger.warning(
      `LocatorMemory tracked-identity cap reached (MAX_TRACKED_IDENTITIES=${MAX_TRACKED_IDENTITIES}); evicted `
      + `${toEvict.length} least-recently-seen entr${toEvict.length === 1 ? "y" : "ies"}: ${details.join(", ")}${suffix}.`,
    );
    for (const { key } of toEvict) this.entries.delete(key);
    return toEvict.length;
  }

  /** Serialise current in-memory state into the on-disk JSON shape. */
  _toPersistable() {
    return {
      schemaVersion: SCHEMA_VERSION,
      salt: this.salt,
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
  _persist() {
    this._queue = this._queue
      .then(() => AtomicJsonStore.writeJsonAtomic(this.memoryPath, this._toPersistable()))
      .then((result) => this._writeFailures.record(this.memoryPath, result));
    return this._queue;
  }

  /**
   * Ground-truth refresh (the ONLY path that can grant trusted evidence from
   * nothing). `identity` is a `LocatorIdentity`-shaped object; its canonical
   * key is derived here, never accepted as a separate argument, so a caller
   * can never pass a key that doesn't match its own identity.
   */
  recordEvidence(identity, signature) {
    const key = LocatorIdentity.serialiseIdentity(identity);
    const existing = this.entries.get(key);
    const now = new Date().toISOString();
    const entry = {
      identity,
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
    const key = LocatorIdentity.serialiseIdentity(identity);
    const existing = this.entries.get(key);
    const now = new Date().toISOString();

    const priorCandidate = existing ? existing.pendingCandidate : null;
    const sameSelector = priorCandidate && priorCandidate.selector === candidate.selector;

    const pendingCandidate = {
      selector: candidate.selector,
      signature: candidate.signature,
      contributions: candidate.contributions && typeof candidate.contributions === "object" ? candidate.contributions : {},
      total: typeof candidate.total === "number" ? candidate.total : 0,
      firstSeen: sameSelector ? priorCandidate.firstSeen : now,
      lastSeen: now,
      occurrences: sameSelector ? priorCandidate.occurrences + 1 : 1,
    };

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
  approve(key, { approvedBy = "dashboard" } = {}) {
    const entry = this.entries.get(key);
    if (!entry || !entry.pendingCandidate) return null;
    if (entry.trust === "revoked") {
      Logger.warning(
        `LocatorMemory: refused to approve a pending candidate for a revoked identity (key=${key}); `
        + "a revoked identity can only regain trusted evidence via recordEvidence() (a fresh ground-truth pass), "
        + "never by re-approving candidate evidence.",
      );
      return null;
    }

    const now = new Date().toISOString();
    const approved = {
      ...entry,
      trust: "trusted",
      signature: entry.pendingCandidate.signature,
      pendingCandidate: null,
      lastSeen: now,
    };
    this.entries.set(key, approved);
    this._persist();
    void approvedBy;
    return _clone(approved);
  }

  /**
   * Discard `pendingCandidate` without ever promoting it, and record the
   * rejection so a repeated identical proposal can surface as "previously
   * rejected" via `previouslyRejected()`. Returns `null` if there is no
   * entry or no pendingCandidate to reject.
   */
  reject(key, { rejectedBy = "dashboard" } = {}) {
    const entry = this.entries.get(key);
    if (!entry || !entry.pendingCandidate) return null;

    const candidateSelector = entry.pendingCandidate.selector;
    const now = new Date().toISOString();
    const rejected = { ...entry, pendingCandidate: null, lastSeen: now };
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
  rollback(identityKey, { actor = "dashboard", note } = {}) {
    const entry = this.entries.get(identityKey);
    if (!entry) return null;

    const now = new Date().toISOString();
    const revocationEvent = note !== undefined ? { actor, at: now, note } : { actor, at: now };
    const revoked = {
      ...entry,
      trust: "revoked",
      lastSeen: now,
      revocationHistory: [...entry.revocationHistory, revocationEvent],
    };
    this.entries.set(identityKey, revoked);
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
    return _clone({ identity: entry.identity, signature: entry.signature, firstSeen: entry.firstSeen, lastSeen: entry.lastSeen });
  }

  /** Defensive copy of one entry by its canonical key, or `null`. */
  getEntry(key) {
    const entry = this.entries.get(key);
    return entry ? _clone(entry) : null;
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
      if (cloned.pendingCandidate) {
        cloned.pendingCandidate.previouslyRejected = this.previouslyRejected(key, cloned.pendingCandidate.selector);
      }
      out[key] = cloned;
    }
    return out;
  }

  /** Defensive copies of every quarantined legacy row, keyed by opaque id. */
  listLegacy() {
    const out = {};
    for (const [id, entry] of this.legacy) out[id] = _clone(entry);
    return out;
  }

  /**
   * Permanently remove one quarantined legacy row. Legacy rows are never
   * auto-promoted into `entries` by any code path — this is the only way
   * one is ever removed, and it is a deletion, never a promotion. Returns
   * `true` if a row was removed, `false` if `opaqueId` was not present.
   */
  deleteLegacy(opaqueId, { actor = "dashboard" } = {}) {
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
