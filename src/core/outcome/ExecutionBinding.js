"use strict";

/**
 * ExecutionBinding.js — WP-77N (GS12) runtime binding of an on-disk business
 * assertion contract to the approval-lifecycle store, performed once before
 * the browser starts. `bind()` re-reads and re-verifies the contract file
 * directly (never trusting any earlier read by a CLI step), recomputes its
 * digest, and only returns the contract when that exact digest is recorded
 * APPROVED for the given journeyId in the resolved store. The returned
 * contract is deep-frozen so nothing downstream can mutate what the runner
 * evaluates against the page — there is no second read between the digest
 * check and evaluation (no TOCTOU window).
 *
 * A matching digest binds *content* only; it does not authenticate who
 * approved it (documented local trust boundary — the approval store itself,
 * not this module, is the authority on who may approve).
 *
 * Fails closed on every path: `bind()` never throws. Reason strings are a
 * fixed closed set of codes only — never contract text, expected values, or
 * file contents — so a binding failure cannot leak evidence into logs/UI.
 */

const fs = require("fs");

const Contract = require("./Contract");
const ContractStore = require("./ContractStore");
const Schemas = require("../parallel/Schemas");

// WP-77IS (M1): issuance state lives HERE, in module scope, and nowhere else.
// There is no registry module, no claim function and no exported way to add
// to `issuedBindings`: the only writer is `bind()` below, on its ok path. So
// no import order, and no module that merely `require`s this one, can obtain
// the ability to mint an issued binding. `isIssued` is read-only. This does
// not defend against code with full execution privileges in the same
// process (it could patch modules or use the debugger); it defends against
// untrusted data and ordinary importers.
const issuedBindings = new WeakSet();

function isIssued(binding) {
    return binding !== null && typeof binding === "object" && issuedBindings.has(binding);
}

const CODES = Object.freeze({
    BAD_ARGS: "BAD_ARGS",
    STORE_ROOT_INVALID: "STORE_ROOT_INVALID",
    STORE_MISSING: "STORE_MISSING",
    STORE_BROKEN: "STORE_BROKEN",
    CONTRACT_UNREADABLE: "CONTRACT_UNREADABLE",
    CONTRACT_INVALID: "CONTRACT_INVALID",
    JOURNEY_MISMATCH: "JOURNEY_MISMATCH",
    NOT_APPROVED: "NOT_APPROVED",
    BINDING_ERROR: "BINDING_ERROR",
});

// Mirrors ContractStore's readStoreFile bounded-read shape: nonblocking,
// non-symlink, fstat/lstat dev+ino cross-check, bounded read loop.
async function readContractFile(file) {
    let fh = null;
    try {
        try {
            fh = await fs.promises.open(
                file,
                fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0)
            );
        } catch {
            return { ok: false };
        }
        const st = await fh.stat();
        if (!st.isFile()) return { ok: false };
        if (st.size > Contract.ALLOWED.MAX_PAYLOAD_BYTES) return { ok: false };
        let lst;
        try { lst = await fs.promises.lstat(file); } catch { return { ok: false }; }
        if (lst.isSymbolicLink() || lst.dev !== st.dev || lst.ino !== st.ino) return { ok: false };

        const buf = Buffer.alloc(st.size + 1);
        let off = 0;
        for (;;) {
            const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
            if (bytesRead === 0) break;
            off += bytesRead;
            if (off > st.size || off > Contract.ALLOWED.MAX_PAYLOAD_BYTES) return { ok: false };
            if (off >= buf.length) break;
        }
        let text;
        try {
            text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, off));
        } catch { return { ok: false }; }
        return { ok: true, text };
    } catch {
        return { ok: false };
    } finally {
        if (fh) { try { await fh.close(); } catch { /* ignore */ } }
    }
}

function deepFreeze(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
}

function fail(code, reason) {
    return { ok: false, code, reason: reason || code };
}

async function bind(args) {
    try {
        const contractFile = args && args.contractFile;
        const journeyId = args && args.journeyId;
        const storeRoot = args && args.storeRoot;
        const repoRoot = args && args.repoRoot;

        if (typeof contractFile !== "string" || contractFile.length === 0) return fail(CODES.BAD_ARGS, "contractFile");
        if (typeof journeyId !== "string" || !Schemas.isJourneyId(journeyId)) return fail(CODES.BAD_ARGS, "journeyId");

        const rootRes = ContractStore.resolveStoreRoot(storeRoot, repoRoot);
        if (!rootRes.ok) return fail(CODES.STORE_ROOT_INVALID, "resolve_failed");
        const root = rootRes.root;

        let rootLstat;
        try {
            rootLstat = await fs.promises.lstat(root);
        } catch (e) {
            if (e && e.code === "ENOENT") return fail(CODES.STORE_MISSING, "root_missing");
            return fail(CODES.STORE_ROOT_INVALID, "root_unstattable");
        }
        if (rootLstat.isSymbolicLink() || !rootLstat.isDirectory()) return fail(CODES.STORE_ROOT_INVALID, "root_not_plain_directory");

        const read = await readContractFile(contractFile);
        if (!read.ok) return fail(CODES.CONTRACT_UNREADABLE, "unreadable");

        const parsed = Contract.parse(read.text);
        if (!parsed.ok) return fail(CODES.CONTRACT_INVALID, "parse_failed");

        const contract = parsed.value;
        const digest = parsed.digest;

        const assertions = Array.isArray(contract.assertions) ? contract.assertions : [];
        if (assertions.some((a) => !a || typeof a.required !== "boolean")) {
            return fail(CODES.CONTRACT_INVALID, "assertion_required_flag_invalid");
        }

        if (contract.journeyId !== journeyId) return fail(CODES.JOURNEY_MISMATCH, "journey_mismatch");

        const statusRes = await ContractStore.status(root, journeyId, digest);
        if (!statusRes.ok) return fail(CODES.BINDING_ERROR, "status_lookup_failed");
        if (statusRes.integrity === "missing") return fail(CODES.STORE_MISSING, "store_missing");
        if (statusRes.integrity === "broken") return fail(CODES.STORE_BROKEN, "store_broken");
        if (statusRes.status !== "APPROVED") return fail(CODES.NOT_APPROVED, `status:${statusRes.status}`);

        const assertionIds = assertions.map((a) => a.id);
        // WP-77I/S4 + WP-77IS (repair): register the exact object returned
        // on the ok path as "issued" before handing it back, AND freeze the
        // outer object itself (the contract was already deep-frozen). Without
        // freezing the outer object, a caller could reassign
        // `binding.contract` after issuance and flip a required FAIL into a
        // trusted PASSED/INTERACTION_ONLY result downstream — the frozen
        // contract alone does not protect the `contract` property slot
        // itself. This is the only place anything can enter `issuedBindings`,
        // so downstream code (Verification) can tell a binding that
        // genuinely passed digest/approval checks apart from a hand-built
        // object literal with the same-looking fields.
        const binding = Object.freeze({
            ok: true,
            journeyId,
            digest,
            contract: deepFreeze(contract),
            assertionIds: Object.freeze(assertionIds),
        });
        issuedBindings.add(binding);
        return binding;
    } catch {
        return fail(CODES.BINDING_ERROR, "binding_error");
    }
}

const REVALIDATE_CODES = Object.freeze({
    UNISSUED: "UNISSUED",
    DIGEST_MISMATCH: "DIGEST_MISMATCH",
    NOT_APPROVED: "NOT_APPROVED",
    STORE_MISSING: "STORE_MISSING",
    STORE_BROKEN: "STORE_BROKEN",
    LOOKUP_FAILED: "LOOKUP_FAILED",
    JOURNEY_MISMATCH: "JOURNEY_MISMATCH",
});

/**
 * WP-77I/S4 (merge-time revalidation, for DEV-02's in-process worker merge).
 * Never throws; never reads/returns contract text, only closed reason codes.
 *
 * Re-checks, at merge time, that a binding a worker handed back is still (a)
 * actually issued by `bind()` — never a hand-built object literal, even one
 * with matching-looking fields — and (b) still APPROVED in the store for its
 * own proven digest, recomputed fresh from the binding's own frozen
 * `contract` (never trusting any cached digest the binding merely carries).
 * A lookup failure is a closed LOOKUP_FAILED code, never read as approved.
 */
async function revalidate(binding, args) {
    try {
        if (!isIssued(binding)) {
            return { ok: false, code: REVALIDATE_CODES.UNISSUED };
        }

        const journeyId = binding.journeyId;
        const digest = binding.digest;
        if (typeof journeyId !== "string" || !Schemas.isJourneyId(journeyId)) {
            return { ok: false, code: REVALIDATE_CODES.UNISSUED };
        }
        if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
            return { ok: false, code: REVALIDATE_CODES.UNISSUED };
        }

        if (!binding.contract || binding.contract.journeyId !== journeyId) {
            return { ok: false, code: REVALIDATE_CODES.JOURNEY_MISMATCH };
        }

        let recomputed;
        try {
            recomputed = Contract.digestOf(binding.contract);
        } catch {
            return { ok: false, code: REVALIDATE_CODES.UNISSUED };
        }
        if (recomputed !== digest) {
            return { ok: false, code: REVALIDATE_CODES.DIGEST_MISMATCH };
        }

        const storeRoot = args && args.storeRoot;
        const repoRoot = args && args.repoRoot;
        const rootRes = ContractStore.resolveStoreRoot(storeRoot, repoRoot);
        if (!rootRes.ok) return { ok: false, code: REVALIDATE_CODES.LOOKUP_FAILED };
        const root = rootRes.root;

        // WP-77IS (repair): identical root pre-check to bind() — without
        // this, a missing store root was being reported as STORE_BROKEN
        // (via ContractStore.status's chain-read failure) instead of the
        // more specific STORE_MISSING bind() reports for the same condition.
        let rootLstat;
        try {
            rootLstat = await fs.promises.lstat(root);
        } catch (e) {
            if (e && e.code === "ENOENT") return { ok: false, code: REVALIDATE_CODES.STORE_MISSING };
            return { ok: false, code: REVALIDATE_CODES.LOOKUP_FAILED };
        }
        if (rootLstat.isSymbolicLink() || !rootLstat.isDirectory()) {
            return { ok: false, code: REVALIDATE_CODES.LOOKUP_FAILED };
        }

        let statusRes;
        try {
            statusRes = await ContractStore.status(root, journeyId, digest);
        } catch {
            return { ok: false, code: REVALIDATE_CODES.LOOKUP_FAILED };
        }
        if (!statusRes || !statusRes.ok) return { ok: false, code: REVALIDATE_CODES.LOOKUP_FAILED };
        if (statusRes.integrity === "missing") return { ok: false, code: REVALIDATE_CODES.STORE_MISSING };
        if (statusRes.integrity === "broken") return { ok: false, code: REVALIDATE_CODES.STORE_BROKEN };
        if (statusRes.status !== "APPROVED") return { ok: false, code: REVALIDATE_CODES.NOT_APPROVED };

        return { ok: true };
    } catch {
        return { ok: false, code: REVALIDATE_CODES.LOOKUP_FAILED };
    }
}

module.exports = {
    bind,
    CODES,
    readContractFile,
    isIssued,
    revalidate,
    REVALIDATE_CODES,
};
