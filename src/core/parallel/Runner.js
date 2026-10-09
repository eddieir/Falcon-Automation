"use strict";

/**
 * Runner - the parallel/shard/merge entry logic used by falcon.js (architecture 3.1, 3.6).
 *
 * Nothing here runs unless --workers>1, --shard or the merge command was given;
 * the default run never reaches this module.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Logger = require("../../../utils/Logger");
const ParallelMode = require("./ParallelMode");
const ParallelSweep = require("./ParallelSweep");
const ShardMerge = require("./ShardMerge");
const SafeFs = require("./SafeFs");
const Limits = require("./Limits");

const RUN_ID_PATTERN = Limits.RUN_ID_PATTERN;

const TIMINGS_FILE = "timings.json";
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

const MERGE_FLAG = /^--(input|expect-total|expect-run-id|expect-commit)=/;

/** Directories used by merge. Test seam only honoured under a test preload. */
function defaultPaths(repoRoot, env = process.env) {
    const seam = globalThis.__FALCON_TEST_SEAMS__;
    if (seam && seam.parallelPaths === true && env.FALCON_TEST_PARALLEL_PATHS) {
        try {
            const p = JSON.parse(env.FALCON_TEST_PARALLEL_PATHS);
            if (p && typeof p.dataDir === "string" && typeof p.reportsDir === "string") return p;
        } catch { /* fall through to defaults */ }
    }
    return { dataDir: path.join(repoRoot, "data"), reportsDir: path.join(process.cwd(), "reports") };
}

/** Strict validation of the merge command line: only --input / --expect-total, no empties. */
function checkMergeArgv(argv) {
    for (const a of argv.slice(1)) {
        if (!MERGE_FLAG.test(a)) return `Unknown or malformed argument for merge: ${JSON.stringify(String(a).slice(0, 40))}`;
    }
    return null;
}

/** Strict --expect-run-id / --expect-commit parsing for merge. Returns {ok, expectRunId, expectCommit} or {ok:false, message}. */
function parseMergeExpect(argv) {
    const out = { ok: true, expectRunId: null, expectCommit: null };
    const seen = new Set();
    for (const a of argv.slice(1)) {
        const m = /^--(expect-run-id|expect-commit)=([\s\S]*)$/.exec(a);
        if (!m) continue;
        if (seen.has(m[1])) return { ok: false, message: `Duplicate flag --${m[1]}` };
        seen.add(m[1]);
        if (m[1] === "expect-run-id") {
            if (!RUN_ID_PATTERN.test(m[2])) return { ok: false, message: "--expect-run-id must match ^[a-z0-9][a-z0-9-]{5,62}$" };
            out.expectRunId = m[2];
        } else {
            if (!/^[0-9a-f]{40}$/.test(m[2])) return { ok: false, message: "--expect-commit must be 40 lowercase hex characters" };
            out.expectCommit = m[2];
        }
    }
    return out;
}

async function runMerge({ merge, paths }) {
    try {
        const t0 = nowMs();
        const r = await ShardMerge.merge({
            inputDir: path.resolve(merge.input), expectTotal: merge.expectTotal === null ? undefined : merge.expectTotal,
            expectRunId: merge.expectRunId || undefined, expectCommit: merge.expectCommit || undefined, paths,
        });
        if (!r.replay && (r.code === 0 || r.code === 1) && r.reportPath) await addMergeMs(r.reportPath, Math.max(0, Math.round(nowMs() - t0)));
        if (r.code === 0 || r.code === 1) Logger.info(`merge: report ${r.reportPath}, code ${r.code}`);
        else for (const d of (r.diagnostics || []).slice(0, 5)) Logger.error(`merge: ${d.code} ${d.where}`);
        return r.code;
    } catch (error) {
        Logger.error(`merge: unexpected failure (${String(error && error.code || "error").slice(0, 40)})`);
        return 3;
    }
}

/** Best effort: add the merge wall time (VOLATILE) to a report that already carries execution.timings. */
async function addMergeMs(reportPath, mergeMs) {
    try {
        const report = JSON.parse(await fs.promises.readFile(reportPath, "utf8"));
        if (!report.execution || !report.execution.timings) return;
        report.execution.timings.mergeMs = mergeMs;
        const w = await SafeFs.writeAtomicPrivate(reportPath, JSON.stringify(report, null, 2));
        if (!w.ok) throw new Error(w.error);
    } catch {
        Logger.warning("merge: could not record mergeMs");
    }
}

function newRunId() {
    return `local-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Run a sharded or multi-worker sweep. Returns the process exit code.
 * Shard mode writes a bundle and returns that shard's code; local multi-worker
 * mode also merges the single bundle in-process.
 */
async function run({ browser, parsed, url, sweepOpts, emit, repoRoot, commit, startedAt }) {
    const shard = parsed.shard;
    const workers = parsed.workers;
    const mode = shard ? "shard" : "workers";
    const runId = parsed.runId || newRunId();
    const root = path.join(process.cwd(), "reports", "shards", runId);
    const shardInfo = shard || { index: 1, total: 1 };
    const bundleDir = path.join(root, `shard-${shardInfo.index}-of-${shardInfo.total}`);
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });

    const state = { configured: workers, active: workers, completed: 0, pending: 0, failed: 0 };
    emit("workerState", { ...state });
    ParallelMode.setActive(true);
    let result;
    try {
        const context = await browser.newContext();
        try {
            result = await ParallelSweep.run({
                context, browser, entryUrl: url, runId, commit: commit || "unknown", bundleDir, shard, workers,
                startedAt, ...sweepOpts,
            });
        } finally {
            await context.close().catch(() => {});
        }
    } finally {
        ParallelMode.setActive(false);
    }

    if (result.timings) {
        // Sidecar next to the manifest: the manifest timing allow-list is closed.
        const w = await SafeFs.writeAtomicPrivate(path.join(bundleDir, TIMINGS_FILE), JSON.stringify(result.timings));
        if (!w.ok) Logger.warning("could not write shard timings");
    }

    const mine = result.pages.filter((p) => p.assigned);
    emit("runPlan", { mode, workers, shard: shard ? { index: shard.index, total: shard.total } : null, pagesTotal: result.pages.length });
    emit("workerState", {
        configured: workers, active: 0,
        completed: mine.filter((p) => p.disposition === "completed").length,
        pending: mine.filter((p) => p.disposition === "not-run" || p.disposition === "skipped").length,
        failed: mine.filter((p) => p.disposition === "task-failed").length,
    });

    if (shard) {
        Logger.info(`shard ${shard.index}/${shard.total}: bundle written to ${bundleDir}, exit ${result.exit.code}`);
        return result.exit.code;
    }
    return runMerge({ merge: { input: root, expectTotal: 1 }, paths: defaultPaths(repoRoot) });
}

module.exports = { TIMINGS_FILE, run, runMerge, checkMergeArgv, parseMergeExpect, addMergeMs, defaultPaths, newRunId };
