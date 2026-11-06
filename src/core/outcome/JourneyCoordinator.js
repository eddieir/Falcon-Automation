"use strict";

/**
 * JourneyCoordinator.js — WP-77I-S2 in-process multi-journey worker pool.
 *
 * Binds every journey's contract (via ExecutionBinding.bind) sequentially,
 * BEFORE any journey executes, then runs whole journeys (never split
 * assertions) through a bounded pool of in-process workers. After every
 * worker has finished, every issued binding is re-validated sequentially
 * (ExecutionBinding.revalidate) so a contract revoked mid-run cannot be
 * trusted retroactively. Output order is always the sorted-by-journeyId
 * order, regardless of which worker finished first.
 *
 * Pure control-flow module: no filesystem access of its own (all disk I/O is
 * delegated to ExecutionBinding/ContractStore); `run()` never throws — every
 * failure path (bad config, a journey executor that throws or returns a
 * malformed value) is converted to a closed-set code or a privacy-safe
 * failed row, never raw error text.
 */

const path = require("path");

const ExecutionBinding = require("./ExecutionBinding");

const MAX_WORKERS = 8;

const CODES = Object.freeze({
    SHARD_UNSUPPORTED: "SHARD_UNSUPPORTED",
    WORKERS_INVALID: "WORKERS_INVALID",
    NO_JOURNEYS: "NO_JOURNEYS",
    CONTRACT_REQUIRED: "CONTRACT_REQUIRED",
    DUPLICATE_JOURNEY: "DUPLICATE_JOURNEY",
    RUN_ERROR: "RUN_ERROR",
});

function fail(code) {
    return { ok: false, code };
}

function hasValidContract(plan) {
    const contract = plan && plan.contract;
    return !!contract
        && typeof contract.file === "string" && contract.file.length > 0
        && typeof contract.journeyId === "string" && contract.journeyId.length > 0;
}

/**
 * Pure, never throws. Validates the whole-run configuration before any
 * binding or execution is attempted. Closed-set failure codes only — never
 * contract text, file contents, or journey identifiers.
 */
function validateConfig(args) {
    try {
        const journeys = args && args.journeys;
        const workers = args && args.workers;
        // Sharding is out of scope for this in-process coordinator; a caller
        // that supplies a non-null shard explicitly asked for a mode this
        // module does not implement — fail closed rather than silently
        // ignoring it.
        const shard = args && Object.prototype.hasOwnProperty.call(args, "shard") ? args.shard : null;
        if (shard !== null) return fail(CODES.SHARD_UNSUPPORTED);

        if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS) {
            return fail(CODES.WORKERS_INVALID);
        }

        if (!Array.isArray(journeys) || journeys.length === 0) return fail(CODES.NO_JOURNEYS);

        const seenJourneyIds = new Set();
        const seenFiles = new Set();
        for (const j of journeys) {
            const plan = j && j.plan;
            if (!hasValidContract(plan)) return fail(CODES.CONTRACT_REQUIRED);
            const { journeyId } = plan.contract;
            const file = path.resolve(plan.contract.file);
            if (seenJourneyIds.has(journeyId) || seenFiles.has(file)) return fail(CODES.DUPLICATE_JOURNEY);
            seenJourneyIds.add(journeyId);
            seenFiles.add(file);
        }

        return { ok: true };
    } catch {
        return fail(CODES.RUN_ERROR);
    }
}

function journeyIdOfPlan(plan) {
    return plan && plan.contract && typeof plan.contract.journeyId === "string" ? plan.contract.journeyId : "";
}

/**
 * Run every journey to completion. Never throws.
 *
 * Steps (see module header): validate -> sort by journeyId -> bind every
 * journey sequentially (before any execution) -> run whole journeys through
 * a bounded worker pool, storing results by index for deterministic output
 * order -> revalidate every issued binding sequentially, in order -> return
 * one entry per journey.
 */
async function run(args) {
    try {
        const journeys = args && args.journeys;
        const workers = args && args.workers;
        const storeRoot = args && args.storeRoot;
        const repoRoot = args && args.repoRoot;
        const executeJourney = args && args.executeJourney;

        const validation = validateConfig({ journeys, workers, shard: null });
        if (!validation.ok) return validation;
        if (typeof executeJourney !== "function") return fail(CODES.RUN_ERROR);

        const sorted = journeys.slice().sort((a, b) => {
            const ja = journeyIdOfPlan(a && a.plan);
            const jb = journeyIdOfPlan(b && b.plan);
            return ja < jb ? -1 : (ja > jb ? 1 : 0);
        });

        // Bind EVERY journey sequentially, before any journey executes.
        const bindings = [];
        for (const j of sorted) {
            const contract = j.plan.contract;
            let binding;
            try {
                binding = await ExecutionBinding.bind({
                    contractFile: contract.file,
                    journeyId: contract.journeyId,
                    storeRoot,
                    repoRoot,
                });
            } catch {
                binding = Object.freeze({ ok: false, code: "BINDING_ERROR", reason: "binding_error" });
            }
            if (binding && typeof binding === "object" && !Object.isFrozen(binding)) binding = Object.freeze(binding);
            bindings.push(binding);
        }

        const n = sorted.length;
        const results = new Array(n);
        const workerCount = Math.min(workers, n);
        let nextIndex = 0;

        async function worker() {
            for (;;) {
                const idx = nextIndex;
                nextIndex += 1;
                if (idx >= n) return;
                // Each journey gets its own deep copy of the plan: no object
                // is shared between concurrently running journeys.
                const plan = structuredClone(sorted[idx].plan);
                const binding = bindings[idx];
                let outcome;
                let cleanupFailed = false;
                try {
                    const r = await executeJourney({ plan, binding, index: idx });
                    cleanupFailed = !!(r && r.cleanupFailed === true);
                    if (!r || !Array.isArray(r.rows)) throw new Error("malformed_executor_result");
                    outcome = { rows: r.rows, pages: r.pages };
                } catch (e) {
                    // Never carry the thrown error's message/text downstream:
                    // a privacy-safe, closed-set failure row only. A cleanup
                    // failure that accompanied the error is still recorded.
                    cleanupFailed = cleanupFailed || !!(e && e.cleanupFailed === true);
                    outcome = { rows: [{ name: "journey", status: "failed", error: "JOURNEY_EXECUTION_ERROR" }] };
                }
                outcome.cleanupFailed = cleanupFailed;
                results[idx] = outcome;
            }
        }

        const pool = [];
        for (let i = 0; i < workerCount; i++) pool.push(worker());
        await Promise.all(pool);

        // Revalidate every issued binding sequentially, in sorted order,
        // AFTER every worker has finished — a contract revoked mid-run must
        // never be trusted retroactively.
        const entries = new Array(n);
        for (let i = 0; i < n; i++) {
            const binding = bindings[i];
            const outcome = results[i] || { rows: [] };
            const entry = {
                binding,
                rows: outcome.rows,
                journeyId: journeyIdOfPlan(sorted[i].plan),
            };
            if (outcome.pages !== undefined) entry.pages = outcome.pages;
            if (outcome.cleanupFailed === true) entry.cleanupFailed = true;
            if (binding && binding.ok === true && ExecutionBinding.isIssued(binding)) {
                let rv;
                try {
                    rv = await ExecutionBinding.revalidate(binding, { storeRoot, repoRoot });
                } catch {
                    rv = { ok: false, code: "LOOKUP_FAILED" };
                }
                entry.revalidation = Object.freeze(
                    rv && rv.code ? { ok: !!(rv && rv.ok), code: rv.code } : { ok: !!(rv && rv.ok) }
                );
            }
            entries[i] = entry;
        }

        return { ok: true, entries };
    } catch {
        return fail(CODES.RUN_ERROR);
    }
}

/**
 * Run one journey in its own execution context and always close that context.
 * Execution and cleanup are handled SEPARATELY:
 *  - the journey's own outcome is never replaced by a cleanup failure;
 *  - a failed `close()` is flagged as `cleanupFailed: true` (a boolean, never
 *    error text) on the returned value, or on the error thrown for a journey
 *    that itself failed, so the coordinator can report it. An uncertain
 *    teardown means isolation is uncertain: Verification turns the flag into
 *    an integrity breach (never PASSED, never BUSINESS_VERIFIED);
 *  - an execution error is re-thrown as a fresh, message-free Error so no
 *    error text can travel to a report.
 * A context that cannot be opened propagates as an ordinary execution
 * failure (there is nothing to clean up).
 */
async function runIsolated(openContext, work) {
    const context = await openContext();
    let outcome;
    let failed = false;
    try {
        outcome = await work(context);
    } catch {
        failed = true;
    }
    let cleanupFailed = false;
    try {
        await context.close();
    } catch {
        cleanupFailed = true;
    }
    if (failed) {
        const err = new Error("JOURNEY_EXECUTION_ERROR");
        err.cleanupFailed = cleanupFailed;
        throw err;
    }
    return cleanupFailed && outcome !== null && typeof outcome === "object"
        ? { ...outcome, cleanupFailed: true }
        : outcome;
}

module.exports = {
    runIsolated,
    MAX_WORKERS,
    CODES,
    validateConfig,
    run,
};
