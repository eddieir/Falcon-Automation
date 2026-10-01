"use strict";

/**
 * P14-19 regression: LocatorMemory — evidence-based trusted locator store.
 *
 * Covers EP-5 §7's trust invariant (ground-truth refresh vs. candidate
 * proposal), rollback (and the re-approve loophole closure), the
 * MAX_TRACKED_IDENTITIES / rejections caps, legacy quarantine, the salt
 * precedence (F14-1), S-Q7 (per-path write-failure aggregation), and S-Q8
 * (prototype-pollution-safe keying).
 *
 * Run directly with `node --test`, independent of the rest of the suite.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, silent, temp, root } = require("./helpers.cjs");

const AtomicJsonStore = require(path.join(root, "src", "core", "util", "AtomicJsonStore.js"));
const LocatorIdentity = require(path.join(root, "src", "core", "locator", "LocatorIdentity.js"));
const ElementSignature = require(path.join(root, "src", "core", "locator", "ElementSignature.js"));

function makeMemoryPath(dir) {
  return path.join(dir, "locator_memory.json");
}

function loadLocatorMemory(mocks = {}) {
  return load("src/core/locator/LocatorMemory.js", {
    "../../../utils/Logger": silent,
    ...mocks,
  });
}

const TEST_SALT = "p14-memory-test-salt-v1";

function identityFor(selector, overrides = {}) {
  const built = LocatorIdentity.buildIdentity({
    url: "https://example.com/checkout",
    action: "click",
    originalSelector: selector,
    env: {},
  });
  assert.equal(built.status, "built");
  return { ...built.identity, ...overrides };
}

function signatureFor(label) {
  return ElementSignature.capture(
    {
      tagName: "button",
      role: "button",
      accessibleName: label,
      attributes: { id: label },
      structuralPath: ["form", "div", "button"],
      ownText: label,
      boundingBoxBucket: "bottom-right:small",
    },
    { salt: TEST_SALT },
  );
}

function candidateFor(selector, label) {
  return {
    selector,
    signature: signatureFor(label),
    contributions: { attribute: 0.4, accessibleName: 0.2 },
    total: 0.6,
  };
}

// ---------------------------------------------------------------------------
// Construction / salt precedence (F14-1)
// ---------------------------------------------------------------------------

test("constructs against a temp directory and creates no file until a write is queued", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memoryPath = makeMemoryPath(dir);
  const memory = new LocatorMemory({ memoryPath, env: {} });
  assert.equal(memory.memoryPath, memoryPath);
  assert.equal(memory.saltSource, "file", "no env salt and no existing file -> a fresh one is generated and persisted");
  assert.equal(typeof memory.salt, "string");
  assert.ok(memory.salt.length > 0);
});

test("salt precedence: FALCON_LOCATOR_SALT from env wins even when the file already has a different salt", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  fs.writeFileSync(memoryPath, JSON.stringify({ schemaVersion: 1, salt: "file-salt", entries: {}, legacy: {} }));

  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath, env: { FALCON_LOCATOR_SALT: "env-salt" } });
  assert.equal(memory.salt, "env-salt");
  assert.equal(memory.saltSource, "env");
});

test("salt precedence: an existing file salt is reused (not regenerated) when no env salt is set", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  fs.writeFileSync(memoryPath, JSON.stringify({ schemaVersion: 1, salt: "persisted-salt", entries: {}, legacy: {} }));

  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath, env: {} });
  assert.equal(memory.salt, "persisted-salt");
  assert.equal(memory.saltSource, "file");
});

test("a generated salt is persisted so a second instance pointed at the same file reuses it", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  const LocatorMemory = loadLocatorMemory();

  const first = new LocatorMemory({ memoryPath, env: {} });
  return first._queue.then(() => {
    const onDisk = JSON.parse(fs.readFileSync(memoryPath, "utf8"));
    assert.equal(onDisk.salt, first.salt);

    const second = new LocatorMemory({ memoryPath, env: {} });
    assert.equal(second.salt, first.salt);
    assert.equal(second.saltSource, "file");
  });
});

test("generating a fresh salt emits exactly one warning", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  let warnings = 0;
  const LocatorMemory = loadLocatorMemory({
    "../../../utils/Logger": { ...silent, warning: () => { warnings += 1; } },
  });
  const memory = new LocatorMemory({ memoryPath, env: {} });
  memory._reload();
  memory._reload();
  assert.equal(warnings, 1, "the salt-generation warning must fire exactly once, not once per reload");
});

// ---------------------------------------------------------------------------
// The trust invariant: recordEvidence vs. recordPendingCandidate
// ---------------------------------------------------------------------------

test("recordEvidence grants trusted evidence directly, with no approval step", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#checkout-button");
  const signature = signatureFor("Checkout");
  const entry = memory.recordEvidence(identity, signature);

  assert.equal(entry.trust, "trusted");
  assert.deepEqual(entry.signature, signature);
  const trusted = memory.getTrusted(identity);
  assert.ok(trusted, "getTrusted must return usable evidence immediately, no approve() call involved");
  assert.deepEqual(trusted.signature, signature);
});

test("recordPendingCandidate never touches trust or signature on an existing trusted entry", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#checkout-button");
  const groundTruthSignature = signatureFor("Checkout");
  memory.recordEvidence(identity, groundTruthSignature);

  const candidate = candidateFor("#new-checkout-button", "Checkout Now");
  const entry = memory.recordPendingCandidate(identity, candidate);

  assert.equal(entry.trust, "trusted", "trust must be completely untouched by a pending proposal");
  assert.deepEqual(entry.signature, groundTruthSignature, "signature must be completely untouched by a pending proposal");
  assert.equal(entry.pendingCandidate.selector, "#new-checkout-button");
  assert.equal(entry.pendingCandidate.occurrences, 1);

  // A high score can never manufacture trust by itself, even a very high one.
  const strongCandidate = { ...candidate, total: 0.99 };
  const entry2 = memory.recordPendingCandidate(identity, strongCandidate);
  assert.equal(entry2.trust, "trusted");
  assert.deepEqual(entry2.signature, groundTruthSignature);

  // Re-proposing the same selector bumps occurrences in place.
  assert.equal(entry2.pendingCandidate.occurrences, 2);
});

test("recordPendingCandidate on a never-before-seen identity creates an entry with no usable trusted evidence", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#never-seen");
  const candidate = candidateFor("#guess", "Guess");
  memory.recordPendingCandidate(identity, candidate);

  assert.equal(memory.getTrusted(identity), null, "a candidate-only entry must never be usable as trusted evidence");
});

// ---------------------------------------------------------------------------
// approve() / reject() / previouslyRejected()
// ---------------------------------------------------------------------------

test("approve() promotes pendingCandidate into signature + trusted, and clears pendingCandidate", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#checkout-button");
  memory.recordEvidence(identity, signatureFor("Checkout"));
  const candidate = candidateFor("#new-checkout-button", "Checkout Now");
  const key = LocatorIdentity.serialiseIdentity(identity);
  memory.recordPendingCandidate(identity, candidate);

  const approved = memory.approve(key, { approvedBy: "qa-lead" });
  assert.ok(approved);
  assert.equal(approved.trust, "trusted");
  assert.deepEqual(approved.signature, candidate.signature);
  assert.equal(approved.pendingCandidate, null);

  const trusted = memory.getTrusted(identity);
  assert.deepEqual(trusted.signature, candidate.signature);
});

// ---------------------------------------------------------------------------
// Three trust states: "trusted" | "unproven" | "revoked"
// ---------------------------------------------------------------------------

test("getTrusted() returns usable evidence for \"trusted\" only, and null for both \"unproven\" and \"revoked\"", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  // "unproven": a first-time candidate with no prior ground truth.
  const unprovenIdentity = identityFor("#never-seen");
  memory.recordPendingCandidate(unprovenIdentity, candidateFor("#guess", "Guess"));
  const unprovenKey = LocatorIdentity.serialiseIdentity(unprovenIdentity);
  assert.equal(memory.getEntry(unprovenKey).trust, "unproven");
  assert.equal(memory.getTrusted(unprovenIdentity), null, "\"unproven\" must never be usable evidence");

  // "trusted": a ground-truth refresh.
  const trustedIdentity = identityFor("#checkout-button");
  memory.recordEvidence(trustedIdentity, signatureFor("Checkout"));
  assert.ok(memory.getTrusted(trustedIdentity), "\"trusted\" must be usable evidence");

  // "revoked": trusted evidence that was then rolled back.
  const revokedIdentity = identityFor("#removed-button");
  memory.recordEvidence(revokedIdentity, signatureFor("Removed"));
  const revokedKey = LocatorIdentity.serialiseIdentity(revokedIdentity);
  memory.rollback(revokedKey, { actor: "qa-lead" });
  assert.equal(memory.getEntry(revokedKey).trust, "revoked");
  assert.equal(memory.getTrusted(revokedIdentity), null, "\"revoked\" must never be usable evidence");
});

test("approve() SUCCEEDS on an \"unproven\" entry — this is the ordinary first-time Tier 2.5 promotion path", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#never-seen");
  const candidate = candidateFor("#guess", "Guess");
  const key = LocatorIdentity.serialiseIdentity(identity);
  memory.recordPendingCandidate(identity, candidate);
  assert.equal(memory.getEntry(key).trust, "unproven", "precondition: the entry must actually be unproven before approving it");

  const approved = memory.approve(key, { approvedBy: "qa-lead" });
  assert.ok(approved, "approve() must succeed on an unproven entry — refusing this would block the primary approval path entirely");
  assert.equal(approved.trust, "trusted");
  assert.deepEqual(approved.signature, candidate.signature);
  assert.equal(approved.pendingCandidate, null);
  assert.ok(memory.getTrusted(identity), "the identity must now have usable evidence");
});

test("approve() still REFUSES a genuinely revoked entry, leaving it untouched (both directions proven explicitly)", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#checkout-button");
  const originalSignature = signatureFor("Checkout");
  memory.recordEvidence(identity, originalSignature);
  const key = LocatorIdentity.serialiseIdentity(identity);
  memory.recordPendingCandidate(identity, candidateFor("#sneaky", "Sneaky"));
  memory.rollback(key, { actor: "qa-lead" });
  assert.equal(memory.getEntry(key).trust, "revoked", "precondition: the entry must actually be revoked");

  const result = memory.approve(key, { approvedBy: "attacker-or-mistake" });
  assert.equal(result, null, "approve() must still refuse a genuinely revoked entry");
  const entry = memory.getEntry(key);
  assert.equal(entry.trust, "revoked");
  assert.deepEqual(entry.signature, originalSignature);
});

test("rollback() on an \"unproven\" entry transitions it to \"revoked\" with an attributed revocationHistory row, never silently", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#never-seen");
  memory.recordPendingCandidate(identity, candidateFor("#guess", "Guess"));
  const key = LocatorIdentity.serialiseIdentity(identity);
  const before = memory.getEntry(key);
  assert.equal(before.trust, "unproven");
  assert.deepEqual(before.revocationHistory, [], "an unproven entry must start with an empty revocationHistory — nothing has been revoked yet");

  const revoked = memory.rollback(key, { actor: "qa-lead", note: "rejecting this guess outright" });
  assert.ok(revoked, "rollback() must be permitted from \"unproven\", not only from \"trusted\"");
  assert.equal(revoked.trust, "revoked");
  assert.equal(revoked.revocationHistory.length, 1, "the transition must be recorded as one real, attributed event — never a silent no-op");
  assert.equal(revoked.revocationHistory[0].actor, "qa-lead");
  assert.equal(revoked.revocationHistory[0].note, "rejecting this guess outright");
  assert.equal(memory.getTrusted(identity), null);

  // approve() must now refuse it, same as any other revoked entry.
  assert.equal(memory.approve(key), null);
});

test("an unrecognised trust value on load is quarantined into legacy, never silently treated as trusted", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  const identity = identityFor("#weird");
  const key = LocatorIdentity.serialiseIdentity(identity);
  fs.writeFileSync(memoryPath, JSON.stringify({
    schemaVersion: 1,
    salt: TEST_SALT,
    entries: {
      [key]: {
        identity,
        trust: "definitely-not-a-real-state",
        signature: signatureFor("weird"),
        pendingCandidate: null,
        firstSeen: "2024-01-01T00:00:00.000Z",
        lastSeen: "2024-01-01T00:00:00.000Z",
        revocationHistory: [],
      },
    },
    legacy: {},
    rejections: [],
  }));

  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath, env: {} });
  assert.equal(memory.entries.size, 0, "an unrecognised trust value must never be loaded into entries");
  assert.equal(memory.getTrusted(identity), null);
  assert.equal(memory.legacy.size, 1);
  const [legacyRow] = [...memory.legacy.values()];
  assert.equal(legacyRow.reason, "invalid_trust");
});

test("reject() clears pendingCandidate without ever writing it to signature, and records the rejection", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#checkout-button");
  const groundTruth = signatureFor("Checkout");
  memory.recordEvidence(identity, groundTruth);
  const candidate = candidateFor("#bad-guess", "Bad Guess");
  const key = LocatorIdentity.serialiseIdentity(identity);
  memory.recordPendingCandidate(identity, candidate);

  const rejected = memory.reject(key, { rejectedBy: "qa-lead" });
  assert.ok(rejected);
  assert.equal(rejected.pendingCandidate, null);
  assert.deepEqual(rejected.signature, groundTruth, "rejecting a candidate must never alter the existing trusted signature");

  const rejectionInfo = memory.previouslyRejected(key, "#bad-guess");
  assert.equal(rejectionInfo.count, 1);
  assert.equal(rejectionInfo.lastRejectedBy, "qa-lead");

  // Re-proposing the identical candidate now surfaces as previously rejected.
  memory.recordPendingCandidate(identity, candidate);
  const stillRejected = memory.previouslyRejected(key, "#bad-guess");
  assert.equal(stillRejected.count, 1);
});

test("previouslyRejected is always recomputed from the rejection index, never trusted from a stored field", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#x");
  memory.recordEvidence(identity, signatureFor("X"));
  const key = LocatorIdentity.serialiseIdentity(identity);

  assert.equal(memory.previouslyRejected(key, "#guess").count, 0);
  memory.recordPendingCandidate(identity, candidateFor("#guess", "Guess"));
  memory.reject(key);
  assert.equal(memory.previouslyRejected(key, "#guess").count, 1);

  // Corrupting the in-memory entry (as if a stale cached field existed)
  // must have zero effect on the recomputed answer — there is no such field
  // read anywhere in previouslyRejected().
  const entry = memory.entries.get(key);
  entry.someStaleCache = { count: 999 };
  assert.equal(memory.previouslyRejected(key, "#guess").count, 1);
});

// AC-36: list() must fold the previously-rejected signal into every listed
// entry's pendingCandidate — a consumer must see it from list() ALONE, with
// no second call to previouslyRejected() required.
test("list() exposes the previously-rejected signal for a re-proposed candidate through list() alone, and carries each entry's own key", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#checkout-button");
  memory.recordEvidence(identity, signatureFor("Checkout"));
  const key = LocatorIdentity.serialiseIdentity(identity);

  const rejectedCandidate = candidateFor("#bad-guess", "Bad Guess");
  memory.recordPendingCandidate(identity, rejectedCandidate);
  memory.reject(key, { rejectedBy: "alice" });
  // Re-propose the IDENTICAL candidate selector — this is the AC-36 scenario:
  // an approver must see, from list() alone, that this was already rejected.
  memory.recordPendingCandidate(identity, rejectedCandidate);

  const listed = memory.list();
  assert.equal(listed[key].key, key, "each listed entry must carry its own serialised key");

  const rejectedInfo = listed[key].pendingCandidate.previouslyRejected;
  assert.ok(rejectedInfo, "list() alone — no second call to previouslyRejected() — must expose the rejection signal");
  assert.equal(rejectedInfo.count, 1);
  assert.equal(rejectedInfo.lastRejectedBy, "alice");

  // A second identity whose candidate was never rejected must show the
  // signal present but zeroed out — never absent, so a consumer doesn't
  // have to special-case "field missing" vs. "count is 0".
  const cleanIdentity = identityFor("#never-rejected");
  memory.recordEvidence(cleanIdentity, signatureFor("Clean"));
  const cleanKey = LocatorIdentity.serialiseIdentity(cleanIdentity);
  memory.recordPendingCandidate(cleanIdentity, candidateFor("#fresh-guess", "Fresh Guess"));
  const cleanListed = memory.list();
  assert.equal(cleanListed[cleanKey].pendingCandidate.previouslyRejected.count, 0);

  // An entry with no pendingCandidate at all must not have a
  // previouslyRejected field fabricated out of nothing.
  const bareIdentity = identityFor("#no-candidate");
  memory.recordEvidence(bareIdentity, signatureFor("Bare"));
  const bareKey = LocatorIdentity.serialiseIdentity(bareIdentity);
  const bareListed = memory.list();
  assert.equal(bareListed[bareKey].pendingCandidate, null);
});

// ---------------------------------------------------------------------------
// rollback() and the re-approve loophole closure
// ---------------------------------------------------------------------------

test("rollback() revokes trust, preserves revocationHistory and the prior signature, and getTrusted returns nothing", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#checkout-button");
  const signature = signatureFor("Checkout");
  memory.recordEvidence(identity, signature);
  const key = LocatorIdentity.serialiseIdentity(identity);

  const revoked = memory.rollback(key, { actor: "qa-lead", note: "page redesign broke this" });
  assert.equal(revoked.trust, "revoked");
  assert.deepEqual(revoked.signature, signature, "the prior signature must be preserved, not cleared, by a rollback");
  assert.equal(revoked.revocationHistory.length, 1);
  assert.equal(revoked.revocationHistory[0].actor, "qa-lead");
  assert.equal(revoked.revocationHistory[0].note, "page redesign broke this");

  assert.equal(memory.getTrusted(identity), null, "a revoked entry must never be returned as usable evidence");

  // A second rollback appends, never replaces, the history.
  memory.rollback(key, { actor: "someone-else" });
  const afterSecond = memory.getEntry(key);
  assert.equal(afterSecond.revocationHistory.length, 2);
  assert.equal(afterSecond.revocationHistory[0].actor, "qa-lead", "earlier history rows must never be overwritten");
});

test("a revoked entry cannot be re-promoted via approve() — only recordEvidence() can re-trust it", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const identity = identityFor("#checkout-button");
  const originalSignature = signatureFor("Checkout");
  memory.recordEvidence(identity, originalSignature);
  const key = LocatorIdentity.serialiseIdentity(identity);

  // A pending candidate exists at the moment of rollback (or arrives right
  // after it) — this is exactly the loophole shape: rollback, then try to
  // use approve() on whatever pendingCandidate is sitting there to sneak
  // back to trusted without a real ground-truth pass.
  const candidate = candidateFor("#sneaky", "Sneaky");
  memory.recordPendingCandidate(identity, candidate);
  memory.rollback(key, { actor: "qa-lead" });

  const result = memory.approve(key, { approvedBy: "attacker-or-mistake" });
  assert.equal(result, null, "approve() must refuse to promote a pendingCandidate on a revoked entry");

  const entry = memory.getEntry(key);
  assert.equal(entry.trust, "revoked", "trust must remain revoked after the refused approve() attempt");
  assert.deepEqual(entry.signature, originalSignature, "signature must be completely unchanged by the refused approve()");
  assert.ok(entry.pendingCandidate, "the pendingCandidate itself is left as-is by a refused approve() (only cleared on success)");

  // The only sanctioned way back: a fresh ground-truth pass.
  const freshSignature = signatureFor("Checkout Again");
  const reTrusted = memory.recordEvidence(identity, freshSignature);
  assert.equal(reTrusted.trust, "trusted");
  assert.deepEqual(memory.getTrusted(identity).signature, freshSignature);
});

// ---------------------------------------------------------------------------
// Caps: MAX_TRACKED_IDENTITIES, deterministic LRU eviction
// ---------------------------------------------------------------------------

test("MAX_TRACKED_IDENTITIES is enforced on mutation, evicting least-recently-seen first, ties broken by ascending key", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const cap = LocatorMemory.MAX_TRACKED_IDENTITIES;
  const keys = [];
  for (let i = 0; i < cap + 5; i += 1) {
    const identity = identityFor(`#el-${String(i).padStart(4, "0")}`);
    memory.recordEvidence(identity, signatureFor(`el-${i}`));
    keys.push(LocatorIdentity.serialiseIdentity(identity));
  }

  assert.equal(memory.entries.size, cap, "the cap must be a genuine invariant, never exceeded");
  // The first 5 inserted (oldest lastSeen, since each recordEvidence call
  // happens strictly later than the previous one) must be the ones evicted.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(memory.entries.has(keys[i]), false, `entry ${i} (oldest) should have been evicted`);
  }
  for (let i = 5; i < keys.length; i += 1) {
    assert.equal(memory.entries.has(keys[i]), true, `entry ${i} should have survived`);
  }
});

test("MAX_TRACKED_IDENTITIES is enforced on load too, not only on mutation, and eviction is deterministic across repeated loads", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  const LocatorMemory = loadLocatorMemory();

  const oversized = { schemaVersion: 1, salt: TEST_SALT, entries: {}, legacy: {}, rejections: [] };
  const identities = [];
  for (let i = 0; i < LocatorMemory.MAX_TRACKED_IDENTITIES + 10; i += 1) {
    const identity = identityFor(`#bulk-${String(i).padStart(4, "0")}`);
    const key = LocatorIdentity.serialiseIdentity(identity);
    identities.push({ identity, key });
    oversized.entries[key] = {
      identity,
      trust: "trusted",
      signature: signatureFor(`bulk-${i}`),
      pendingCandidate: null,
      // Ties on purpose: every entry shares the same lastSeen, so the
      // tie-break (ascending key) is what must determine the outcome.
      firstSeen: "2024-01-01T00:00:00.000Z",
      lastSeen: "2024-01-01T00:00:00.000Z",
      revocationHistory: [],
    };
  }
  fs.writeFileSync(memoryPath, JSON.stringify(oversized));

  const first = new LocatorMemory({ memoryPath, env: {} });
  assert.equal(first.entries.size, LocatorMemory.MAX_TRACKED_IDENTITIES);
  const survivorsFirst = new Set(first.entries.keys());

  return first._queue.then(() => {
    const second = new LocatorMemory({ memoryPath, env: {} });
    assert.equal(second.entries.size, LocatorMemory.MAX_TRACKED_IDENTITIES);
    const survivorsSecond = new Set(second.entries.keys());
    assert.deepEqual(survivorsFirst, survivorsSecond, "the same oversized input must evict the same entries every time");

    // Ascending-key tie-break: the surviving keys must be exactly the
    // lexicographically LAST MAX_TRACKED_IDENTITIES keys.
    const sortedKeys = identities.map((e) => e.key).sort((a, b) => a.localeCompare(b));
    const expectedSurvivors = new Set(sortedKeys.slice(-LocatorMemory.MAX_TRACKED_IDENTITIES));
    assert.deepEqual(survivorsFirst, expectedSurvivors);
  });
});

test("REJECTIONS_MAX_ROWS is enforced on load, trimming oldest rows and rebuilding the rejection index from only what survives", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  const LocatorMemory = loadLocatorMemory();

  const identity = identityFor("#x");
  const key = LocatorIdentity.serialiseIdentity(identity);
  const rejections = [];
  for (let i = 0; i < LocatorMemory.REJECTIONS_MAX_ROWS + 10; i += 1) {
    rejections.push({
      identityKey: key,
      candidateSelector: `#guess-${i}`,
      rejectedBy: "qa-lead",
      rejectedAt: new Date(2024, 0, 1, 0, 0, i).toISOString(),
    });
  }
  fs.writeFileSync(memoryPath, JSON.stringify({
    schemaVersion: 1, salt: TEST_SALT, entries: {}, legacy: {}, rejections,
  }));

  const memory = new LocatorMemory({ memoryPath, env: {} });
  assert.equal(memory.rejections.length, LocatorMemory.REJECTIONS_MAX_ROWS, "the rejections ledger must be trimmed on load, not only on the next reject() call");
  // The oldest 10 rows (guess-0..guess-9) must have been dropped.
  assert.equal(memory.previouslyRejected(key, "#guess-0").count, 0);
  assert.equal(memory.previouslyRejected(key, "#guess-9").count, 0);
  // The newest row must have survived.
  const lastIndex = LocatorMemory.REJECTIONS_MAX_ROWS + 9;
  assert.equal(memory.previouslyRejected(key, `#guess-${lastIndex}`).count, 1);
});

// ---------------------------------------------------------------------------
// Legacy quarantine
// ---------------------------------------------------------------------------

test("a row missing required identity fields is quarantined into legacy, never into entries, and never auto-promoted", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  const malformed = {
    schemaVersion: 1,
    salt: TEST_SALT,
    entries: {
      "bad-key": { identity: { schemaVersion: 1, applicationId: "a" }, trust: "trusted", signature: {} },
    },
    legacy: {},
    rejections: [],
  };
  fs.writeFileSync(memoryPath, JSON.stringify(malformed));

  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath, env: {} });

  assert.equal(memory.entries.size, 0, "a malformed row must never be loaded into entries");
  assert.equal(memory.legacy.size, 1, "it must be quarantined into legacy instead");
  const [legacyRow] = [...memory.legacy.values()];
  assert.equal(legacyRow.reason, "missing_identity_field:origin");
  assert.deepEqual(legacyRow.rawEntry, malformed.entries["bad-key"]);

  return memory._queue.then(() => {
    const second = new LocatorMemory({ memoryPath, env: {} });
    assert.equal(second.entries.size, 0, "legacy rows must never be auto-promoted on a later load");
    assert.equal(second.legacy.size, 1);
  });
});

test("a row below the current identity schemaVersion is quarantined", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  const identity = identityFor("#old");
  const key = LocatorIdentity.serialiseIdentity({ ...identity, schemaVersion: 0 });
  const stale = {
    schemaVersion: 1,
    salt: TEST_SALT,
    entries: {
      [key]: {
        identity: { ...identity, schemaVersion: 0 },
        trust: "trusted",
        signature: signatureFor("old"),
        pendingCandidate: null,
        firstSeen: "2024-01-01T00:00:00.000Z",
        lastSeen: "2024-01-01T00:00:00.000Z",
        revocationHistory: [],
      },
    },
    legacy: {},
    rejections: [],
  };
  fs.writeFileSync(memoryPath, JSON.stringify(stale));

  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath, env: {} });
  assert.equal(memory.entries.size, 0);
  assert.equal(memory.legacy.size, 1);
  const [legacyRow] = [...memory.legacy.values()];
  assert.equal(legacyRow.reason, "identity_schema_version_below_current");
});

test("deleteLegacy permanently removes a quarantined row and only that row", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const memoryPath = makeMemoryPath(dir);
  fs.writeFileSync(memoryPath, JSON.stringify({
    schemaVersion: 1,
    salt: TEST_SALT,
    entries: {
      bad1: { identity: {}, trust: "trusted" },
      bad2: { identity: {}, trust: "trusted" },
    },
    legacy: {},
    rejections: [],
  }));

  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath, env: {} });
  assert.equal(memory.legacy.size, 2);
  const [firstId] = [...memory.legacy.keys()];

  assert.equal(memory.deleteLegacy("does-not-exist"), false);
  assert.equal(memory.deleteLegacy(firstId, { actor: "qa-lead" }), true);
  assert.equal(memory.legacy.size, 1);
  assert.equal(memory.legacy.has(firstId), false);
});

// ---------------------------------------------------------------------------
// S-Q8: prototype-pollution-safe keying
// ---------------------------------------------------------------------------

test('a "__proto__" identity key is inert: never touches Object.prototype, never leaks via for...in on a fresh object', (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  // Force the canonical key to literally be "__proto__" by stubbing
  // serialiseIdentity for this one call via a crafted identity object whose
  // own fields happen to serialise that way is impractical (JSON.stringify
  // of an array can't produce a bare "__proto__" string) — so exercise the
  // hazard directly at the Map-keying layer the way an attacker-controlled
  // load-time key would: inject it straight into entries/legacy and prove
  // the store's own Map-based access is unaffected either way.
  memory.entries.set("__proto__", {
    identity: identityFor("#x"),
    trust: "trusted",
    signature: signatureFor("x"),
    pendingCandidate: null,
    firstSeen: "2024-01-01T00:00:00.000Z",
    lastSeen: "2024-01-01T00:00:00.000Z",
    revocationHistory: [],
  });
  memory.legacy.set("__proto__", { rawEntry: {}, reason: "test", loadedAt: "2024-01-01T00:00:00.000Z" });

  assert.equal(memory.entries.get("__proto__").trust, "trusted");
  assert.equal(memory.getEntry("__proto__").trust, "trusted");
  assert.equal(memory.listLegacy()["__proto__"].reason, "test");

  assert.equal(Object.getPrototypeOf({}), Object.prototype, "Object.prototype must be completely untouched");
  assert.equal({}.toString, Object.prototype.toString, "no inherited member was shadowed/poisoned");
  assert.deepEqual({ ...{} }, {}, "a fresh plain object must still have zero own enumerable properties");

  let sawViaForIn = false;
  for (const _k in {}) { void _k; sawViaForIn = true; }
  assert.equal(sawViaForIn, false, '"__proto__" must never appear via for...in on a fresh object');

  // Persisting and reloading must round-trip a literal "__proto__" key
  // safely too, since _toPersistable()/_reload() both go through Map <->
  // plain-object conversion.
  return memory._queue.then(() => {
    const reloaded = new LocatorMemory({ memoryPath: memory.memoryPath, env: {} });
    assert.equal(reloaded.entries.get("__proto__")?.trust ?? reloaded.legacy.get("__proto__") !== undefined, true);
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
  });
});

test('"constructor" and "prototype" identity keys behave like any other key', (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  for (const dangerousKey of ["constructor", "prototype"]) {
    memory.entries.set(dangerousKey, {
      identity: identityFor("#x"),
      trust: "trusted",
      signature: signatureFor("x"),
      pendingCandidate: null,
      firstSeen: "2024-01-01T00:00:00.000Z",
      lastSeen: "2024-01-01T00:00:00.000Z",
      revocationHistory: [],
    });
    assert.equal(memory.getEntry(dangerousKey).trust, "trusted");
  }
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

// ---------------------------------------------------------------------------
// AC-08 / S-Q7: write-failure visibility
// ---------------------------------------------------------------------------

test("a blocked write directory is reported through hasUnpersistedWriteFailure()/lastWriteError(), not just swallowed", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const notADirectory = path.join(dir, "not-a-directory");
  fs.writeFileSync(notADirectory, "i am a file");
  const memoryPath = path.join(notADirectory, "locator_memory.json");

  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath, env: {} });

  return memory._queue.then(() => {
    assert.equal(memory.hasUnpersistedWriteFailure(), true);
    assert.equal(memory.lastWriteError().path, memoryPath);
    assert.equal(typeof memory.lastWriteError().error, "string");

    const identity = identityFor("#still-works");
    const entry = memory.recordEvidence(identity, signatureFor("works"));
    assert.equal(entry.trust, "trusted", "in-memory state must survive a failed write, same as every other Phase 14 store");
    return memory._queue;
  });
});

test("a successful write to the SAME path after a failure clears hasUnpersistedWriteFailure()", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const notADirectory = path.join(dir, "not-a-directory");
  fs.writeFileSync(notADirectory, "i am a file");
  const memoryPath = path.join(notADirectory, "locator_memory.json");

  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath, env: {} });

  return memory._queue.then(() => {
    assert.equal(memory.hasUnpersistedWriteFailure(), true);
    fs.rmSync(notADirectory);
    fs.mkdirSync(notADirectory);
    memory.recordEvidence(identityFor("#now-works"), signatureFor("now-works"));
    return memory._queue.then(() => {
      assert.equal(memory.hasUnpersistedWriteFailure(), false);
    });
  });
});

// S-Q7 (P1): the aggregation discipline LocatorMemory composes (the shared
// AtomicJsonStore.WriteFailureTracker, exposed through
// hasUnpersistedWriteFailure()/lastWriteError()) must never let a later
// success on one path mask an earlier failure on a different path — proven
// directly against the exact tracker instance this store uses internally,
// the same technique tests/regression/p14-persistence.check.cjs uses for
// the shared primitive itself. LocatorMemory manages exactly one file
// today, so the cross-path hazard cannot arise from its own calls — this
// test proves the composed tracker would still protect correctly the
// instant that changes.
test("S-Q7: the composed WriteFailureTracker reports a failed FIRST write even after a SECOND write to a different path succeeds", (t) => {
  const dir = temp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const LocatorMemory = loadLocatorMemory();
  const memory = new LocatorMemory({ memoryPath: makeMemoryPath(dir), env: {} });

  const pathA = path.join(dir, "a.json");
  const pathB = path.join(dir, "b.json");
  memory._writeFailures.record(pathA, { ok: false, error: "simulated ENOSPC" });
  memory._writeFailures.record(pathB, { ok: true });

  assert.equal(memory.hasUnpersistedWriteFailure(), true,
    "a failed first write must remain visible even though a later write to a different path succeeded");
  assert.equal(memory.lastWriteError().path, pathA, "the reported failure must name the path that actually failed");
});
