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
        if (assertions.some((a) => !a || a.required !== true)) {
            return fail(CODES.CONTRACT_INVALID, "optional_assertion_unsupported");
        }

        if (contract.journeyId !== journeyId) return fail(CODES.JOURNEY_MISMATCH, "journey_mismatch");

        const statusRes = await ContractStore.status(root, journeyId, digest);
        if (!statusRes.ok) return fail(CODES.BINDING_ERROR, "status_lookup_failed");
        if (statusRes.integrity === "missing") return fail(CODES.STORE_MISSING, "store_missing");
        if (statusRes.integrity === "broken") return fail(CODES.STORE_BROKEN, "store_broken");
        if (statusRes.status !== "APPROVED") return fail(CODES.NOT_APPROVED, `status:${statusRes.status}`);

        const assertionIds = assertions.map((a) => a.id);
        return {
            ok: true,
            journeyId,
            digest,
            contract: deepFreeze(contract),
            assertionIds: Object.freeze(assertionIds),
        };
    } catch {
        return fail(CODES.BINDING_ERROR, "binding_error");
    }
}

module.exports = { bind, CODES };
