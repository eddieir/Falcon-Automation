"use strict";

const crypto = require("crypto");
const Logger = require("../../../utils/Logger");
const SiteSweep = require("../SiteSweep");
const TestRunner = require("../TestRunner");
const Limits = require("./Limits");
const Planning = require("./Planning");
const { runBounded } = require("./Scheduler");
const ParallelMode = require("./ParallelMode");
const StateJournal = require("./StateJournal");
const ShardBundle = require("./ShardBundle");
const Schemas = require("./Schemas");

const nowMs = () => Number(process.hrtime.bigint()) / 1e6; // monotonic
const elapsed = (t0) => Math.max(0, Math.round(nowMs() - t0));

const AUTH_STATE_MAX_BYTES = 1024 * 1024;
const MAX_ERROR = Limits.ERROR_MAX;
const bound = (e) => String(e && e.message !== undefined ? e.message : e).replace(/[^\x20-\x7e]/g, "?").slice(0, MAX_ERROR);

function configFingerprint({ entryUrl, maxPages, dedupe, sameOriginOnly, repeat }) {
    return crypto.createHash("sha256")
        .update(Planning.canonicalJson({ entryUrl, maxPages, dedupe, sameOriginOnly, repeat, schema: 1 }))
        .digest("hex");
}

async function takeAuthState(context) {
    if (!context || typeof context.storageState !== "function") return null;
    let state;
    try { state = await context.storageState(); } catch { return null; }
    if (!state) return null;
    const empty = (!state.cookies || state.cookies.length === 0) && (!state.origins || state.origins.length === 0);
    if (empty) return null;
    if (Buffer.byteLength(JSON.stringify(state)) > AUTH_STATE_MAX_BYTES) {
        throw new Error("AUTH_STATE_TOO_LARGE: parallel mode refuses to start");
    }
    return state;
}

async function withContext(browser, auth, fn) {
    const options = auth ? { storageState: structuredClone(auth) } : undefined;
    const ctx = options ? await browser.newContext(options) : await browser.newContext();
    let page = null;
    try {
        page = await ctx.newPage();
        return await fn(page);
    } finally {
        if (page) await page.close().catch(() => {});
        await ctx.close().catch(() => {});
    }
}

async function runInJournalMode(opts) {
    const {
        context, entryUrl, runId, commit = "unknown", bundleDir = null,
        maxPages = 20, dedupe = true, sameOriginOnly = true, repeat = 1, pageTimeoutMs = 20000,
    } = opts;
    const shard = opts.shard && Number.isInteger(opts.shard.index) ? { index: opts.shard.index, total: opts.shard.total } : null;
    const workers = Math.max(1, Math.floor(opts.workers) || 1);
    const startedAtMs = opts.startedAt instanceof Date ? opts.startedAt.getTime() : Number.isFinite(opts.startedAt) ? opts.startedAt : Date.now();
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : null;
    const deadline = budgetMs === null ? Infinity : startedAtMs + budgetMs;
    const browser = opts.browser || (context && typeof context.browser === "function" ? context.browser() : null);
    if (!browser) throw new Error("ParallelSweep requires a browser");

    const entry = SiteSweep.normalizeUrl(entryUrl);
    if (!entry) throw new Error(`ParallelSweep requires an http(s) entry URL, received: ${entryUrl}`);
    const cap = Math.min(Number.isFinite(maxPages) ? Math.max(0, Math.floor(maxPages)) : 20, Limits.MAX_PAGES);

    const tDiscovery = nowMs();
    // Stage 1-3: discover once, canonical order, ordinals.
    const sweep = new SiteSweep(context, { maxPages: Limits.MAX_PAGES, sameOriginOnly, budgetMs: budgetMs === null ? undefined : budgetMs, pageTimeoutMs, dedupe, repeat });
    const discovered = await sweep._discover(entry);
    const planned = sweep._plan(entry, discovered);
    const auth = await takeAuthState(context);
    const ordered = Planning.canonicalOrder(entry, planned.pages.map((r) => r.url)).slice(0, Limits.MAX_PAGES);
    // Digest over the stored (query-free) form so writer and readers agree; urlId keeps identity unique.
    const frontierDigest = Planning.frontierDigest(ordered.map(Schemas.storedUrl));
    const configFp = configFingerprint({ entryUrl: entry, maxPages: cap, dedupe, sameOriginOnly, repeat });

    const discoveryMs = elapsed(tDiscovery);

    // Stage 4: analyse every eligible page below the cap.
    const tAnalysis = nowMs();
    const toAnalyse = ordered.slice(0, cap);
    const analysisRuns = await runBounded(toAnalyse, workers, (url) => withContext(browser, auth, async (page) => {
        const t0 = Date.now();
        try {
            const response = await page.goto(url, { waitUntil: "load", timeout: pageTimeoutMs });
            const status = response && response.status();
            if (status !== undefined && status >= 400) throw new Error(`HTTP ${status}`);
        } catch (error) {
            return { unreachable: true, reason: bound(error), durationMs: Date.now() - t0 };
        }
        const uiIssues = await sweep._detectIssues(page, url);
        const plan = await sweep._generate(page, url);
        return { uiIssues, plan, durationMs: Date.now() - t0 };
    }), { deadline });

    const analysisMs = elapsed(tAnalysis);
    const analyses = toAnalyse.map((url, ordinal) => {
        const r = analysisRuns[ordinal];
        const a = { ordinal, url, name: url, scenarios: [], plan: null, uiIssues: [], status: "tested", reason: undefined, durationMs: 0, analysisError: null };
        if (r.status === "not-started") {
            a.budgetExhausted = true; // never silently dropped: reported as skipped / budget-exhausted
        } else if (r.status !== "done") {
            a.analysisError = r.error || "analysis-not-completed";
        } else if (r.value.unreachable) {
            a.status = "unreachable"; a.reason = r.value.reason; a.durationMs = r.value.durationMs;
        } else {
            a.plan = r.value.plan; a.uiIssues = r.value.uiIssues; a.durationMs = r.value.durationMs;
            a.scenarios = Array.isArray(r.value.plan.test_scenarios) ? r.value.plan.test_scenarios : [];
        }
        return a;
    });

    // Stage 5: dedupe in canonical order, pure over ordered analyses.
    const sigsOf = (a) => a.scenarios.map((s) => SiteSweep.signatureOf(s));
    const owners = new Map();
    let keptByOrdinal = null;
    if (dedupe) {
        const deduped = Planning.dedupeInOrder(analyses, sigsOf);
        keptByOrdinal = new Map();
        for (const d of deduped) {
            keptByOrdinal.set(d.ordinal, new Set(d.kept));
            for (const x of d.deduped) if (!owners.has(`${d.ordinal}|${x.signature}`)) owners.set(`${d.ordinal}|${x.signature}`, x.firstRunOn);
        }
    }
    const signatureLists = analyses.map(sigsOf);
    const planDigest = Planning.planDigest(signatureLists);

    const pages = ordered.map((url, ordinal) => {
        const a = analyses[ordinal];
        const assigned = shard ? Planning.shardOf(ordinal, shard.total) === shard.index : true;
        const base = {
            ordinal, url, assigned, status: "skipped", reason: undefined, disposition: "not-run",
            scenariosGenerated: 0, scenariosDeduplicated: 0, results: [], uiIssues: [], durationMs: 0,
            signatures: signatureLists[ordinal] || [], scenarioNames: [], journal: null,
        };
        if (!a) { base.reason = "max-pages"; if (assigned) base.disposition = "skipped"; return base; }
        if (a.budgetExhausted) { base.reason = "budget-exhausted"; if (assigned) base.disposition = "skipped"; return base; }
        base.analysisStatus = a.status; base.analysisReason = a.reason;
        base.uiIssues = a.uiIssues;
        base.scenariosGenerated = a.scenarios.length;
        base.scenarioNames = a.scenarios.map((s) => s.description);
        const kept = [];
        const dedupedRows = [];
        const claimed = new Set();
        a.scenarios.forEach((s, i) => {
            const sig = signatureLists[ordinal][i];
            if (!dedupe || (keptByOrdinal.get(ordinal).has(sig) && !claimed.has(sig))) { claimed.add(sig); kept.push(s); }
            else dedupedRows.push({ name: s.description, status: "deduped", firstRunOn: owners.get(`${ordinal}|${sig}`) });
        });
        a.kept = kept; a.dedupedRows = dedupedRows;
        base.scenariosDeduplicated = dedupedRows.length;
        return base;
    });

    // Stage 7: execute only this process's pages.
    const execList = [];
    for (const p of pages) {
        const a = analyses[p.ordinal];
        if (!a || !p.assigned || a.budgetExhausted) continue;
        if (a.status === "unreachable") {
            p.status = "unreachable"; p.reason = a.reason; p.durationMs = a.durationMs;
            p.results = [{ name: `Load ${Schemas.storedUrl(p.url)}`, status: "failed", error: a.reason }];
            p.disposition = "completed";
            Logger.warning(`Unreachable: ${Schemas.storedUrl(p.url)} (${Schemas.redactText(a.reason)})`);
        } else if (a.analysisError) {
            p.status = "tested"; p.reason = a.analysisError; p.disposition = "task-failed"; p.taskFailed = true;
            p.results = [{ name: `Sweep of ${Schemas.storedUrl(p.url)}`, status: "failed", error: a.analysisError }];
        } else {
            execList.push(p);
        }
    }

    const snapshotAt = new Date(startedAtMs).toISOString();
    const tExecution = nowMs();
    const execRuns = await runBounded(execList, workers, (p) => withContext(browser, auth, async (page) => {
        const a = analyses[p.ordinal];
        const t0 = Date.now();
        const journal = new StateJournal({
            runId, shard: shard || { index: 1, total: 1 }, pageOrdinal: p.ordinal, commit, configFp, planDigest, snapshotAt,
        });
        let results = [];
        let failure = null;
        await ParallelMode.runWithJournal(journal, async () => {
            try {
                await page.goto(p.url, { waitUntil: "load", timeout: pageTimeoutMs });
                const plan = { ...a.plan, test_scenarios: a.kept };
                for (let rep = 1; rep <= Math.max(1, Math.floor(repeat) || 1); rep++) {
                    ParallelMode.setPosition(null, rep);
                    if (rep > 1 && plan.url) await page.goto(plan.url, { waitUntil: "load" }).catch(() => {});
                    try {
                        const out = await TestRunner.runRepeatedTestPlan(page, plan, 1);
                        for (const r of out) results.push({ ...r, repetition: rep });
                    } catch (error) {
                        const partial = Array.isArray(error && error.partialResults) ? error.partialResults : [];
                        for (const r of partial) results.push({ ...r, repetition: rep });
                        throw error;
                    }
                }
            } catch (error) {
                failure = error;
            }
        });
        try { journal.finish(failure ? "failed" : "ok"); } catch (e) { failure = failure || e; }
        return { results, failure, journal: journal.toJSON(), durationMs: Date.now() - t0 };
    }), { deadline });

    const executionMs = elapsed(tExecution);
    execRuns.forEach((r, i) => {
        const p = execList[i];
        const a = analyses[p.ordinal];
        if (r.status === "not-started") {
            p.status = "skipped"; p.reason = "budget-exhausted"; p.disposition = "skipped";
            return;
        }
        const v = r.status === "done" ? r.value : { results: [], failure: new Error(r.error), journal: null, durationMs: 0 };
        p.durationMs = v.durationMs;
        p.journal = v.journal;
        p.status = "tested";
        if (v.failure) {
            p.disposition = "task-failed"; p.taskFailed = true; p.reason = bound(v.failure);
            p.results = [...v.results, ...a.dedupedRows, { name: `Sweep of ${Schemas.storedUrl(p.url)}`, status: "failed", error: bound(v.failure) }];
            Logger.warning(`Sweep of ${Schemas.storedUrl(p.url)} failed after ${v.results.length} scenario(s): ${Schemas.redactText(p.reason)}`);
        } else {
            p.disposition = "completed";
            p.results = [...v.results, ...a.dedupedRows];
        }
    });

    // Unassigned pages with a pending reason keep disposition not-run; fill coverage.
    const coverageRecords = pages.map((p) => ({ ...p, status: p.status }));
    const coverage = SiteSweep.summarize(coverageRecords);
    coverage.budgetExhausted = pages.some((p) => p.reason === "budget-exhausted");
    coverage.linksOutOfScope = planned.outOfScope.length;

    const result = {
        runId, shard, entryUrl: entry, workers, configFp, frontierDigest, planDigest,
        pages, coverage, budgetExhausted: coverage.budgetExhausted,
        startedAt: startedAtMs, endedAt: Date.now(),
        timings: { discoveryMs, analysisMs, executionMs },
    };
    if (bundleDir) {
        const written = await ShardBundle.write({
            dir: bundleDir, runId, shard, commit, configFp, frontierDigest, planDigest, pages,
            startedAt: startedAtMs, endedAt: result.endedAt, limits: { workers, budgetMs },
            ref: opts.ref, attempt: opts.attempt,
        });
        result.exit = written.exit;
        result.bundleDir = bundleDir;
    }
    return result;
}

/**
 * Run the staged sweep with journal mode forced on, so a direct caller can
 * never let a page task write canonical state. The previous mode is restored
 * afterwards.
 */
async function run(opts) {
    const previous = ParallelMode.isActive();
    ParallelMode.setActive(true);
    try {
        return await runInJournalMode(opts);
    } finally {
        ParallelMode.setActive(previous);
    }
}

module.exports = { run, configFingerprint };
