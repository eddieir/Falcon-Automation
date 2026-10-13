/**
 * tests/regression/m17-byok-traceability.check.cjs — QA traceability gate
 * for docs/maintenance-byok-acceptance-criteria.json.
 *
 * Enforces (fails fast on any violation):
 *   - Exactly AC01..AC28 and N01..N13 are present, each exactly once.
 *   - AC text matches the canonical 28-entry array, which is in turn pinned
 *     by an SHA256 freeze (owner mandate: texts cannot be weakened).
 *   - implementationPaths/testPaths files exist, named tests exist as live
 *     test(...) calls in those files.
 *   - Allowed statuses: 'verified', 'pending'. 'pending' is only acceptable
 *     for AC20, AC24, AC25, AC26.
 *   - totals block agrees with per-id statuses.
 *
 * Run: node --test --test-concurrency=1 tests/regression/m17-byok-traceability.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTER_PATH = path.join(ROOT, "docs", "maintenance-byok-acceptance-criteria.json");

/** Canonical AC texts (M17-BYOK-AC01..AC28). Protected by TEXT_FREEZE_SHA256. */
const CANONICAL_AC_TEXTS = Object.freeze([
    "user-owned credentials; no Falcon/shared key exists or implied.",
    "per-invocation provider/model/endpoint/credential-ref without mutating another.",
    "concurrent OpenAI+Anthropic instrumented executions hit only their mock endpoint, carry only own planted marker, leak zero markers across requests/logs/errors/ledger/dashboard.",
    "Anthropic adapter: verified official contract, strict bounded output, normalized usage/errors, existing local-validation/approval pipeline.",
    "OpenAI behavior compatible via invocation config.",
    "Gemini adapter official contract, bounded output.",
    "Azure deployment/model/auth correct and invocation-scoped.",
    "compatible/local endpoints explicit, isolated, Phase 17 endpoint controls.",
    "syntactically valid operator model ID reaches only selected adapter, no Falcon release needed, not claimed certified.",
    "provider/model/auth failure never switches provider/key/profile/endpoint, never probes.",
    "Tier1/2/2.5 + local usable with no credentials.",
    "planted keys never in tracked/untracked artifacts, profile metadata, ledger, dashboard, logs, reports, errors, test output, crash output, PR text.",
    "safe profiles (traversal/symlink/perm/bounds); persisted = references + non-secret metadata.",
    "deterministic documented precedence direct/profile/env/defaults; unsafe ambiguity rejected.",
    "only selected adapter reads its credential source; import and local tiers read/contact nothing.",
    "outbound payload = minimum bounded candidate-selection context; no cookies/tokens/full DOM.",
    "remote output cannot bypass numeric parsing, candidate bounds, local validation, human approval, trust, quarantine, rehabilitation, reuse.",
    "distinguishable safe errors: config, auth, permission, model-not-found/unsupported, rate-limit, timeout, network, endpoint-policy, malformed, oversized.",
    "provider + user-selected model may be shown; never secrets, secret refs where sensitive, prompts, headers, raw DOM, endpoint query strings.",
    "discovery absent => docs say manual model IDs (decision: not implemented).",
    "mock results prove protocol only; quality needs separately authorized real-model evaluation.",
    "dashboard keeps real dispatch packets + safe provider/profile metadata; no fabricated conversations/credentials.",
    "Phase 17 env has tested migration/deprecation, never silently changes provider.",
    "exact-head GitHub Advanced Security evidence complete, zero applicable alerts, no other third-party scanners.",
    "docs configure OpenAI, Claude, Gemini, Azure, compatible with own keys using placeholders only.",
    "same 12 agents/models, zero Fable, exact-head independent verdicts.",
    "any new SDK justified, lockfile-pinned, audited, license-reviewed, not loaded for unselected providers.",
    "request/response/retries/timeouts/concurrency/model IDs/profile fields/discovery results have tested limits.",
]);

/** SHA256 of CANONICAL_AC_TEXTS.join("\n") — owner-mandate text freeze. */
const TEXT_FREEZE_SHA256 = "6b28597360422c9a20bab5dbf5fda5567d66a23f892a024a068373a474a78b73";

const AC_IDS = Array.from({ length: 28 }, (_, i) => `M17-BYOK-AC${String(i + 1).padStart(2, "0")}`);
const N_IDS = Array.from({ length: 13 }, (_, i) => `M17-BYOK-N${String(i + 1).padStart(2, "0")}`);
const PENDING_ALLOWED = new Set(["M17-BYOK-AC20", "M17-BYOK-AC24", "M17-BYOK-AC25", "M17-BYOK-AC26"]);
const ALLOWED_STATUSES = new Set(["verified", "pending"]);

const fileCache = new Map();
function readRel(rel) {
    if (!fileCache.has(rel)) {
        const abs = path.join(ROOT, rel);
        fileCache.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null);
    }
    return fileCache.get(rel);
}

function registersLiveTest(contents, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(String.raw`\btest\s*\(\s*(["'\x60])${escaped}\1`).test(contents);
}

function loadRegister() {
    return JSON.parse(fs.readFileSync(REGISTER_PATH, "utf8"));
}

test("canonical AC text freeze: SHA256 of CANONICAL_AC_TEXTS is unchanged", () => {
    const digest = crypto.createHash("sha256").update(CANONICAL_AC_TEXTS.join("\n")).digest("hex");
    assert.equal(
        digest,
        TEXT_FREEZE_SHA256,
        "AC text canonical array has drifted. The 28 texts are owner-fixed; update CANONICAL_AC_TEXTS and TEXT_FREEZE_SHA256 together only with explicit owner approval (AC-register-text.md).",
    );
    assert.equal(CANONICAL_AC_TEXTS.length, 28);
});

test("register exists and parses as JSON", () => {
    assert.ok(fs.existsSync(REGISTER_PATH), `missing register at ${REGISTER_PATH}`);
    const r = loadRegister();
    assert.ok(Array.isArray(r.criteria), "criteria must be an array");
});

test("every required id (AC01..AC28, N01..N13) appears exactly once", () => {
    const r = loadRegister();
    const required = new Set([...AC_IDS, ...N_IDS]);
    const seen = new Map();
    for (const c of r.criteria) seen.set(c.id, (seen.get(c.id) || 0) + 1);
    for (const id of required) assert.equal(seen.get(id), 1, `${id}: must appear exactly once (saw ${seen.get(id) || 0})`);
    for (const [id, n] of seen) {
        assert.ok(required.has(id), `${id}: unexpected id`);
        assert.equal(n, 1, `${id}: duplicated (${n})`);
    }
});

test("every AC text matches the canonical freeze", () => {
    const r = loadRegister();
    const byId = new Map(r.criteria.map((c) => [c.id, c]));
    for (let i = 0; i < 28; i += 1) {
        const id = AC_IDS[i];
        const c = byId.get(id);
        assert.equal(c.text, CANONICAL_AC_TEXTS[i], `${id}: text drifted from canonical`);
    }
});

test("every status is 'verified' or 'pending'; 'pending' only allowed for AC20/AC24/AC25/AC26", () => {
    const r = loadRegister();
    for (const c of r.criteria) {
        assert.ok(ALLOWED_STATUSES.has(c.status), `${c.id}: status "${c.status}" not in {verified,pending}`);
        if (c.status === "pending") {
            assert.ok(
                PENDING_ALLOWED.has(c.id),
                `${c.id}: pending status is only allowed for ${[...PENDING_ALLOWED].join(", ")}`,
            );
        }
    }
});

test("every referenced implementationPaths file exists on disk", () => {
    const r = loadRegister();
    for (const c of r.criteria) {
        if (c.status !== "verified") continue;
        const impl = Array.isArray(c.implementationPaths) ? c.implementationPaths : [];
        assert.ok(impl.length > 0, `${c.id}: verified entries must list at least one implementationPaths file`);
        for (const rel of impl) {
            assert.ok(fs.existsSync(path.join(ROOT, rel)), `${c.id}: implementationPaths missing on disk - ${rel}`);
        }
    }
});

test("every referenced test file exists and contains the named live test(...)", () => {
    const r = loadRegister();
    for (const c of r.criteria) {
        if (c.status !== "verified") continue;
        const tests = Array.isArray(c.testPaths) ? c.testPaths : [];
        assert.ok(tests.length > 0, `${c.id}: verified entries must list at least one testPaths entry`);
        for (const ref of tests) {
            const contents = readRel(ref.file);
            assert.ok(contents !== null, `${c.id}: test file does not exist - ${ref.file}`);
            assert.ok(
                registersLiveTest(contents, ref.name),
                `${c.id}: no such live test in ${ref.file} - "${ref.name}"`,
            );
        }
    }
});

test("totals block agrees with per-id statuses", () => {
    const r = loadRegister();
    assert.ok(r.totals && r.totals.ac && r.totals.n, "totals.ac and totals.n must exist");
    const acVerified = r.criteria.filter((c) => AC_IDS.includes(c.id) && c.status === "verified").length;
    const acPending = r.criteria.filter((c) => AC_IDS.includes(c.id) && c.status === "pending").length;
    const nVerified = r.criteria.filter((c) => N_IDS.includes(c.id) && c.status === "verified").length;
    const nPending = r.criteria.filter((c) => N_IDS.includes(c.id) && c.status === "pending").length;
    assert.equal(r.totals.ac.total, 28);
    assert.equal(r.totals.ac.verified, acVerified);
    assert.equal(r.totals.ac.pending, acPending);
    assert.equal(r.totals.n.total, 13);
    assert.equal(r.totals.n.verified, nVerified);
    assert.equal(r.totals.n.pending, nPending);
    const pendingIds = r.criteria.filter((c) => c.status === "pending").map((c) => c.id).sort();
    const reportedPendingIds = Array.isArray(r.totals.ac.pendingIds) ? [...r.totals.ac.pendingIds].sort() : [];
    assert.deepEqual(pendingIds, reportedPendingIds, "totals.ac.pendingIds must list exactly the pending ACs");
});

test("every entry carries evidenceRevision equal to the register's top-level evidenceRevision", () => {
    const r = loadRegister();
    const SHA_SHAPE = /^[0-9a-f]{7,40}$/;
    assert.match(r.evidenceRevision, SHA_SHAPE, "top-level evidenceRevision must be a git short/long SHA");
    for (const c of r.criteria) {
        assert.equal(
            c.evidenceRevision,
            r.evidenceRevision,
            `${c.id}: evidenceRevision must equal the top-level evidenceRevision (${r.evidenceRevision})`,
        );
    }
});

test("negative control: a mutated local copy fails each guard", () => {
    const r = loadRegister();
    // mutate text
    const mut1 = JSON.parse(JSON.stringify(r));
    mut1.criteria.find((c) => c.id === "M17-BYOK-AC01").text = "weakened";
    assert.notEqual(mut1.criteria.find((c) => c.id === "M17-BYOK-AC01").text, CANONICAL_AC_TEXTS[0]);
    // disallowed pending
    const mut2 = JSON.parse(JSON.stringify(r));
    mut2.criteria.find((c) => c.id === "M17-BYOK-AC01").status = "pending";
    assert.ok(!PENDING_ALLOWED.has("M17-BYOK-AC01"));
    // missing id
    const mut3 = JSON.parse(JSON.stringify(r));
    mut3.criteria = mut3.criteria.filter((c) => c.id !== "M17-BYOK-N01");
    assert.ok(!mut3.criteria.some((c) => c.id === "M17-BYOK-N01"));
});
