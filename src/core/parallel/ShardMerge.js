"use strict";

/**
 * ShardMerge - the coordinator-only merge of shard bundles (architecture 3.5).
 *
 *   merge({ inputDir, expectTotal, paths: { dataDir, reportsDir }, beforeStep, env })
 *     -> { code, reportPath, stateMerge, diagnostics? }
 *
 * code 0 PASSED, 1 validated but not PASSED, 2 rejected input (nothing was
 * written), 3 state not durable (inputs kept, no PASSED report published).
 *
 * Replay: manifest.json files are kept after a successful merge (fragments and
 * journals are deleted). A re-run therefore still learns the runId and
 * inputDigest, finds the receipt, and returns the recorded outcome.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Logger = require("../../../utils/Logger");
const Limits = require("./Limits");
const Schemas = require("./Schemas");
const SafeFs = require("./SafeFs");
const Planning = require("./Planning");
const Reducers = require("./Reducers");
const ReportManager = require("../ReportManager");
const AtomicJsonStore = require("../util/AtomicJsonStore");
const LocatorMemory = require("../locator/LocatorMemory");
const { RunLedger } = require("../history/RunLedger");
const { buildRunRecord } = require("../history/RunRecord");

const MAX_DIAGNOSTICS = 20;
const MAX_CONFLICTS = 50;
const SHARD_DIR = /^shard-(\d{1,2})-of-(\d{1,2})$/;
const COMMON = ["runId", "commit", "configFp", "frontierDigest", "planDigest"];

class Reject extends Error {
    constructor(code, where) { super(code); this.rejectCode = code; this.where = where || ""; }
}

const clean = (s, n = 80) => String(s === undefined ? "" : s).replace(/[^\x20-\x7e]/g, "?").slice(0, n);
const diag = (e) => ({ code: clean(e.rejectCode || e.code || "REJECTED", 60), where: clean(e.where, 100) });
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function runUuid(runId) {
    const h = sha(`falcon-run:${runId}`);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function readChecked(shardDir, sub, ref, maxBytes, maxDepth, where) {
    let file;
    try { file = SafeFs.resolveUnder(shardDir, sub, ref.name); } catch (e) { throw new Reject(e.code || "PATH_INVALID", where); }
    // One bounded read: the bytes that are hashed are the bytes that were parsed.
    const r = await SafeFs.readBoundedJson(file, { maxBytes, maxDepth });
    if (!r.ok) throw new Reject(r.code, where);
    if (r.bytes !== ref.bytes) throw new Reject("BYTES_MISMATCH", where);
    if (r.sha256 !== ref.sha256) throw new Reject("SHA_MISMATCH", where);
    return r.value;
}

/** The writer digests only analysed pages (those below --max-pages), so trailing unanalysed pages carry no signatures. */
function planDigestMatches(lists, expected) {
    let end = lists.length;
    for (;;) {
        if (Planning.planDigest(lists.slice(0, end)) === expected) return true;
        if (end === 0 || lists[end - 1].length > 0) return false;
        end--;
    }
}

/**
 * The manifest's frontier/plan digests must match the signatures recorded in analysis.json.
 * A bundle without analysis.json is accepted (older writers); one with a mismatch is rejected.
 */
async function checkAnalysis(dir, m, name) {
    const file = SafeFs.resolveUnder(dir, "analysis.json");
    const r = await SafeFs.readBoundedJson(file, { maxBytes: 4 * 1024 * 1024, maxDepth: 8 });
    if (!r.ok) {
        if (r.code === "READ_NOT_FOUND") return;
        throw new Reject("ANALYSIS_" + r.code, `${name}/analysis.json`);
    }
    const a = r.value;
    if (!a || a.schema !== "falcon.shard-analysis" || a.runId !== m.runId || !Array.isArray(a.pages) || a.pages.length !== m.pages.length
        || a.pages.some((p, i) => !p || p.ordinal !== m.pages[i].ordinal || p.url !== m.pages[i].url || !Array.isArray(p.signatures))) {
        throw new Reject("ANALYSIS_INVALID", `${name}/analysis.json`);
    }
    if (Planning.frontierDigest(m.pages.map((p) => p.url)) !== m.frontierDigest) throw new Reject("FRONTIER_DIGEST_MISMATCH", name);
    if (!planDigestMatches(a.pages.map((p) => p.signatures), m.planDigest)) throw new Reject("PLAN_DIGEST_MISMATCH", name);
}

/** Stage A: list shard dirs and validate manifests only. */
async function loadManifests(inputDir, expectTotal, expect) {
    let names;
    try { names = (await fs.promises.readdir(inputDir)).filter((n) => SHARD_DIR.test(n)).sort(); } catch { throw new Reject("INPUT_DIR_UNREADABLE", "inputDir"); }
    if (names.length === 0) throw new Reject("NO_SHARDS", "inputDir");
    if (names.length > Limits.MAX_SHARDS) throw new Reject("TOO_MANY_SHARDS", "inputDir");
    const shards = [];
    for (const name of names) {
        const dir = path.join(inputDir, name);
        const st = await fs.promises.lstat(dir);
        if (st.isSymbolicLink() || !st.isDirectory()) throw new Reject("SHARD_DIR_INVALID", name);
        let file;
        try { file = SafeFs.resolveUnder(dir, "manifest.json"); } catch (e) { throw new Reject(e.code || "PATH_INVALID", name); }
        const mr = await SafeFs.readBoundedJson(file, { maxBytes: Limits.MANIFEST_MAX_BYTES, maxDepth: Limits.MANIFEST_MAX_DEPTH });
        if (!mr.ok) throw new Reject(mr.code, `${name}/manifest.json`);
        const raw = mr.value;
        const v = Schemas.validateManifest(raw);
        if (!v.ok) throw new Reject("MANIFEST_" + v.code, `${name}${v.path.slice(1)}`);
        const [, i, n] = SHARD_DIR.exec(name);
        if (raw.shard.index !== Number(i) || raw.shard.total !== Number(n)) throw new Reject("SHARD_NAME_MISMATCH", name);
        const digest = mr.sha256;
        if (expect && expect.runId && raw.runId !== expect.runId) throw new Reject("UNEXPECTED_RUNID", name);
        if (expect && expect.commit && raw.commit !== expect.commit) throw new Reject("UNEXPECTED_COMMIT", name);
        await checkAnalysis(dir, raw, name);
        shards.push({ name, dir, m: raw, digest });
    }
    const total = shards[0].m.shard.total;
    if (expectTotal !== undefined && expectTotal !== null && expectTotal !== total) throw new Reject("TOTAL_UNEXPECTED", "expectTotal");
    const seen = new Set();
    for (const s of shards) {
        if (s.m.shard.total !== total) throw new Reject("MIXED_TOTAL", s.name);
        if (seen.has(s.m.shard.index)) throw new Reject("DUPLICATE_SHARD", s.name);
        seen.add(s.m.shard.index);
        for (const k of COMMON) if (s.m[k] !== shards[0].m[k]) throw new Reject("MIXED_" + k.toUpperCase(), s.name);
    }
    if (shards.length !== total) throw new Reject("MISSING_SHARD", `${shards.length}/${total}`);
    shards.sort((a, b) => a.m.shard.index - b.m.shard.index);
    return { shards, total, runId: shards[0].m.runId, inputDigest: sha(shards.map((s) => s.digest).sort().join("\n")) };
}

/** Page table + ownership checks. Returns pages by ordinal with owner shard. */
function buildPageTable(shards, total) {
    const first = shards[0].m.pages;
    const table = first.map((p) => ({ ordinal: p.ordinal, url: Schemas.storedUrl(p.url), rawUrl: p.url, urlId: p.urlId, owner: null, ref: null }));
    table.forEach((p, i) => { if (p.ordinal !== i) throw new Reject("BAD_ORDINAL", `ordinal ${p.ordinal}`); });
    for (const s of shards) {
        if (s.m.pages.length !== table.length) throw new Reject("PAGE_TABLE_MISMATCH", s.name);
        s.m.pages.forEach((pg, i) => {
            const t = table[i];
            if (pg.ordinal !== t.ordinal || pg.url !== t.rawUrl || pg.urlId !== t.urlId) throw new Reject("PAGE_TABLE_MISMATCH", `${s.name} page ${i}`);
            const mine = Planning.shardOf(pg.ordinal, total) === s.m.shard.index;
            if (pg.assigned !== mine) throw new Reject("BAD_ASSIGNMENT", `${s.name} page ${i}`);
            if (!pg.assigned) {
                if (pg.fragment !== null || pg.journal !== null) throw new Reject("UNASSIGNED_HAS_FILES", `${s.name} page ${i}`);
                return;
            }
            if (t.owner !== null) throw new Reject("DUPLICATE_PAGE_OWNER", `page ${i}`);
            if (pg.disposition === "not-run") throw new Reject("PAGE_NOT_RUN", `page ${i}`);
            if (pg.fragment === null) throw new Reject("FRAGMENT_MISSING", `page ${i}`);
            t.owner = s; t.pg = pg;
        });
    }
    for (const t of table) if (t.owner === null) throw new Reject("PAGE_UNOWNED", `page ${t.ordinal}`);
    return table;
}

async function loadPayloads(table, runId) {
    let bytes = 0;
    let evCount = 0;
    const events = [];
    const rows = [];
    const uiIssues = [];
    const snaps = [];
    for (const t of table) {
        const { owner, pg } = t;
        const h = owner.m;
        const where = `page ${t.ordinal}`;
        const frag = await readChecked(owner.dir, "fragments", pg.fragment, Limits.FRAGMENT_MAX_BYTES, Limits.FRAGMENT_MAX_DEPTH, where + " fragment");
        const fv = Schemas.validateFragment(frag);
        if (!fv.ok) throw new Reject("FRAGMENT_" + fv.code, where);
        if (frag.runId !== runId || frag.pageOrdinal !== t.ordinal || frag.shard.index !== h.shard.index || frag.shard.total !== h.shard.total) throw new Reject("FRAGMENT_HEADER_MISMATCH", where);
        bytes += pg.fragment.bytes;
        frag.results.forEach((r, idx) => rows.push({ t, r, idx }));
        frag.uiIssues.forEach((u) => uiIssues.push({ ...u, message: Schemas.redactText(u.message), page: t.url }));
        t.status = frag.status;
        t.fragError = typeof frag.error === "string" ? frag.error : null;
        // A page that never ran tasks (unreachable, analysis failure) has no journal; a page that
        // reports ok must have one.
        if (pg.journal === null) {
            if ((pg.disposition === "completed" || pg.disposition === "task-failed") && frag.status !== "failed") throw new Reject("JOURNAL_MISSING", where);
            continue;
        }
        const j = await readChecked(owner.dir, "journals", pg.journal, Limits.JOURNAL_MAX_BYTES, Limits.JOURNAL_FILE_MAX_DEPTH, where + " journal");
        const jv = Schemas.validateJournal(j);
        if (!jv.ok) throw new Reject("JOURNAL_" + jv.code, `${where}${jv.path.slice(1)}`);
        for (const k of ["runId", "commit", "configFp", "planDigest"]) if (j[k] !== h[k]) throw new Reject("JOURNAL_HEADER_MISMATCH", where);
        if (j.pageOrdinal !== t.ordinal || j.shard.index !== h.shard.index || j.shard.total !== h.shard.total) throw new Reject("JOURNAL_HEADER_MISMATCH", where);
        if (pg.journal.events !== j.count && pg.journal.events !== j.count - 1) throw new Reject("JOURNAL_COUNT_MISMATCH", where);
        bytes += pg.journal.bytes;
        snaps.push(j.snapshotAt);
        for (const e of j.events) {
            if (e.type === "task.end") continue;
            events.push({ pageOrdinal: t.ordinal, url: t.url, seq: e.seq, id: e.id, type: e.type, scn: e.scn, rep: e.rep, at: e.at, p: e.p });
            if (++evCount > Limits.MERGE_MAX_EVENTS) throw new Reject("TOO_MANY_EVENTS", "events");
        }
        if (bytes > Limits.MERGE_MAX_BYTES) throw new Reject("MERGE_TOO_LARGE", "bytes");
    }
    return { events, rows, uiIssues, snapshotAt: snaps.length ? snaps.slice().sort()[0] : new Date(0).toISOString() };
}

/** Same id + different payload (or other malformed events) -> Reject. */
function checkEvents(events) {
    try { return Reducers.orderEvents(events); } catch (e) {
        throw new Reject(e && e.code === "EVENT_ID_CONFLICT" ? "EVENT_ID_CONFLICT" : "EVENTS_INVALID", "events");
    }
}

const STORE_MAX_BYTES = 8 * 1024 * 1024;

class StoreUnreadable extends Error {
    constructor(code) { super(code); this.name = "StoreUnreadable"; this.code = code; }
}

/** Missing file = empty. A present but oversize/symlinked/non-regular/unreadable file fails closed. */
function readStore(file, fallback) {
    let st;
    try { st = fs.lstatSync(file); } catch (e) {
        if (e && e.code === "ENOENT") return fallback;
        throw new StoreUnreadable("STORE_STAT_FAILED");
    }
    if (st.isSymbolicLink()) throw new StoreUnreadable("STORE_SYMLINK");
    if (!st.isFile()) throw new StoreUnreadable("STORE_NOT_REGULAR");
    if (st.size > STORE_MAX_BYTES) throw new StoreUnreadable("STORE_TOO_LARGE");
    try { fs.accessSync(file, fs.constants.R_OK); } catch { throw new StoreUnreadable("STORE_UNREADABLE"); }
    return AtomicJsonStore.readJsonSync(file, fallback, { maxBytes: STORE_MAX_BYTES });
}

async function persistIfChanged(file, fresh, next) {
    if (Schemas.canonicalJson(fresh) === Schemas.canonicalJson(next)) return { ok: true };
    return AtomicJsonStore.writeJsonAtomic(file, next);
}

function buildRows(rows) {
    const key = (x) => [x.t.ordinal, x.r.status === "deduped" ? 1 : 0, x.r.scn === null ? -1 : x.r.scn, x.r.rep === null ? 0 : x.r.rep, x.idx];
    rows.sort((a, b) => { const ka = key(a); const kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
    return rows.map(({ t, r }) => ({
        name: r.scenario, status: r.status, duration: r.durationMs, page: t.url, pageOrdinal: t.ordinal,
        scn: r.scn, rep: r.rep, ...(r.error ? { error: Schemas.redactText(r.error) } : {}), ...(r.errorType ? { errorType: r.errorType } : {}),
        ...(r.description ? { description: r.description } : {}),
    }));
}

const TIMING_KEYS = ["discoveryMs", "analysisMs", "executionMs"];

/** Per-stage max across shards (shards run concurrently); null unless every shard has valid numbers. */
async function readTimings(shards) {
    const out = {};
    for (const k of TIMING_KEYS) out[k] = 0;
    for (const s of shards) {
        let t;
        try {
            const r = await SafeFs.readBoundedJson(SafeFs.resolveUnder(s.dir, "timings.json"), { maxBytes: 4096, maxDepth: 3 });
            if (!r.ok) return null;
            t = r.value;
        } catch { return null; }
        for (const k of TIMING_KEYS) {
            if (!t || !Number.isFinite(t[k]) || t[k] < 0 || t[k] > 7 * 24 * 3600 * 1000) return null;
            out[k] = Math.max(out[k], t[k]);
        }
    }
    return out;
}

async function merge({ inputDir, expectTotal, expectRunId, expectCommit, paths, beforeStep, env } = {}) {
    const step = async (name) => { if (typeof beforeStep === "function") await beforeStep(name); };
    const rejected = (e) => {
        Logger.error(`ShardMerge: input rejected (${clean(e.rejectCode || e.code, 60)})`);
        return { code: 2, reportPath: null, stateMerge: null, diagnostics: [diag(e)].slice(0, MAX_DIAGNOSTICS) };
    };
    if (!inputDir || !paths || !paths.dataDir || !paths.reportsDir) return rejected(new Reject("ARGS_INVALID", "options"));
    const { dataDir, reportsDir } = paths;
    const reportPath = path.join(reportsDir, "test-report.json");
    const receiptPath = path.join(reportsDir, "merge", "receipts");

    let loaded;
    let table;
    let payload;
    let receiptFile;
    try {
        loaded = await loadManifests(inputDir, expectTotal, { runId: expectRunId, commit: expectCommit });
        if (!Limits.RUN_ID_PATTERN.test(loaded.runId)) throw new Reject("RUN_ID_INVALID", "runId");
        receiptFile = path.join(receiptPath, `${loaded.runId}.json`);
        const rc = await SafeFs.readBoundedJson(receiptFile, { maxBytes: 64 * 1024, maxDepth: 6 });
        if (rc.ok) {
            const r = rc.value;
            if (!r || r.schema !== "falcon.merge-receipt" || r.inputDigest !== loaded.inputDigest) throw new Reject("RECEIPT_DIGEST_MISMATCH", "receipt");
            Logger.info(`ShardMerge: run already merged (code ${r.code})`);
            return { code: r.code, reportPath, stateMerge: r.stateMerge, replay: true };
        }
        if (rc.code !== "READ_NOT_FOUND") throw new Reject("RECEIPT_" + rc.code, "receipt");
        table = buildPageTable(loaded.shards, loaded.total);
        payload = await loadPayloads(table, loaded.runId);
        checkEvents(payload.events);
    } catch (e) {
        if (e instanceof Reject) return rejected(e);
        return rejected(new Reject("VALIDATION_FAILED", clean(e && e.code)));
    }

    const { runId, shards } = loaded;
    const stateMerge = { eventsApplied: 0, duplicates: 0, conflicts: [] };
    const addConflicts = (list) => {
        for (const c of list || []) if (stateMerge.conflicts.length < MAX_CONFLICTS) stateMerge.conflicts.push({ code: clean(c.code, 40), key: c.key == null ? null : clean(c.key, 100), detail: c.detail == null ? undefined : clean(c.detail, 100) });
    };
    const fail3 = (what, err) => {
        Logger.error(`ShardMerge: state not durable at ${what}${err ? " (" + clean(err, 60) + ")" : ""}`);
        return { code: 3, reportPath: null, stateMerge, diagnostics: [{ code: "NON_DURABLE", where: clean(what) }] };
    };

    try {
        const ordered = checkEvents(payload.events);
        stateMerge.eventsApplied = ordered.length;
        stateMerge.duplicates = payload.events.length - ordered.length;
        const events = ordered;
        const f = (n) => path.join(dataDir, n);

        // 3. fixed store order, each against the fresh canonical file
        await step("scenario_history");
        const histFresh = readStore(f("scenario_history.json"), {});
        const quar = readStore(f("quarantine_decisions.json"), []);
        const flaky = Reducers.reduceFlakiness(histFresh, events, runId, quar);
        let w = await persistIfChanged(f("scenario_history.json"), histFresh, flaky.scenarios);
        if (!w.ok) return fail3("scenario_history", w.error);
        addConflicts(flaky.conflicts);

        await step("healing_pending");
        const pendFresh = readStore(f("healing_pending.json"), {});
        const dec = readStore(f("healing_decisions.json"), []);
        const pend = Reducers.reduceHealingPending(pendFresh, dec, events, payload.snapshotAt, runId);
        w = await persistIfChanged(f("healing_pending.json"), pendFresh, pend.pending);
        if (!w.ok) return fail3("healing_pending", w.error);
        // Derived from events + the resulting canonical entries (not from "was it applied just now"),
        // so a rerun after a partial apply reports the same conflicts.
        addConflicts(pend.conflicts.filter((c) => c.code !== "rejected_after_snapshot"));
        {
            const snap = Date.parse(payload.snapshotAt);
            const keys = [...new Set(events.filter((e) => e.type === "healing.pending" && e.p && typeof e.p.original === "string").map((e) => e.p.original))].sort();
            addConflicts(keys.filter((k) => {
                const pr = pend.pending[k] && pend.pending[k].previouslyRejected;
                return pr && pr.count > 0 && Date.parse(pr.lastRejectedAt) > snap;
            }).map((k) => ({ code: "rejected_after_snapshot", key: k })));
        }

        await step("locator_store");
        const storeFresh = readStore(f("locator_store.json"), {});
        const store = Reducers.reduceLocatorStore(storeFresh, events, runId, []);
        w = await persistIfChanged(f("locator_store.json"), storeFresh, store.store);
        if (!w.ok) return fail3("locator_store", w.error);
        addConflicts(store.conflicts);

        await step("locator_memory");
        const mem = new LocatorMemory({ memoryPath: f("locator_memory.json"), env: env || process.env });
        const mr = await mem.applyMerge(events, runId, payload.snapshotAt);
        addConflicts(mr.conflicts);
        if (!mr.ok) return fail3("locator_memory", mr.error);

        // report content (pure)
        const starts = shards.map((s) => s.m.timing.startedAt).sort();
        const ends = shards.map((s) => s.m.timing.endedAt).sort();
        const wallMs = Math.max(0, Date.parse(ends[ends.length - 1]) - Date.parse(starts[0]));
        const tests = buildRows(payload.rows);
        const count = (d) => table.filter((t) => t.pg.disposition === d).length;
        const healingEvents = Reducers.buildHealingLog(events);
        const coverage = {
            pagesDiscovered: table.length,
            pagesTested: table.filter((t) => t.pg.disposition === "completed" && t.status === "ok").length,
            pagesSkipped: count("skipped"),
            pagesUnreachable: table.filter((t) => t.pg.disposition === "task-failed" || (t.pg.disposition === "completed" && t.status !== "ok")).length,
            scenariosGenerated: tests.length, scenariosDeduplicated: tests.filter((t) => t.status === "deduped").length,
            budgetExhausted: table.some((t) => t.pg.disposition === "skipped" && t.fragError === "budget-exhausted"),
        };
        const pages = table.map((t) => ({
            ordinal: t.ordinal, url: t.url, disposition: t.pg.disposition,
            status: t.pg.disposition === "skipped" ? "skipped" : t.status === "ok" ? "tested" : "failed",
        }));
        const timings = await readTimings(shards);
        const report = ReportManager.buildReport({
            tests, uiIssues: payload.uiIssues, healingEvents, coverage, pages, timings,
            runId, duration: `${(wallMs / 1000).toFixed(2)}s`,
        });
        report.stateMerge = { eventsApplied: stateMerge.eventsApplied, duplicates: stateMerge.duplicates, conflicts: stateMerge.conflicts };
        const code = report.result === "PASSED" ? 0 : 1;

        // 4. one history append (idempotent by runId, honours FALCON_RUN_HISTORY)
        await step("run_history");
        const ledger = new RunLedger({ filePath: f("run_history.json"), env: env || process.env });
        const quarantineCount = Object.values(flaky.scenarios).filter((s) => s && s.quarantined === true).length;
        const rec = buildRunRecord({
            runId: runUuid(runId), report, coverage, healLog: healingEvents,
            pendingDepth: Object.keys(pend.pending).length, quarantineCount, repeat: 1, durationMs: wallMs,
            incomplete: false, git: { sha: shards[0].m.commit, branch: shards[0].m.ref }, now: new Date(ends[ends.length - 1]),
        });
        const hr = await ledger.append(rec);
        if (!hr.ok) Logger.warning("ShardMerge: run history append failed; merge continues");

        // 5. reports then receipt
        await step("healing_logs");
        w = await AtomicJsonStore.writeJsonAtomic(path.join(reportsDir, "healing_logs.json"), healingEvents);
        if (!w.ok) return fail3("healing_logs", w.error);
        await step("exploratory");
        w = await AtomicJsonStore.writeJsonAtomic(path.join(reportsDir, "exploratory_test_results.json"), {
            summary: { uiIssuesCount: payload.uiIssues.length, pagesExploredCount: pages.length },
            uiIssues: payload.uiIssues, exploredPages: pages.map((p) => p.url),
        });
        if (!w.ok) return fail3("exploratory", w.error);
        await step("report");
        w = await AtomicJsonStore.writeJsonAtomic(reportPath, report);
        if (!w.ok) return fail3("report", w.error);
        const dropReport = async () => { try { await fs.promises.unlink(reportPath); } catch { /* best effort */ } };
        await step("receipt");
        w = await AtomicJsonStore.writeJsonAtomic(receiptFile, { schema: "falcon.merge-receipt", v: 1, runId, inputDigest: loaded.inputDigest, code, stateMerge: report.stateMerge });
        if (!w.ok) { await dropReport(); return fail3("receipt", w.error); }

        // 6. delete state-carrying bundle files only now
        await step("cleanup");
        for (const t of table) {
            for (const [sub, ref] of [["fragments", t.pg.fragment], ["journals", t.pg.journal]]) {
                if (!ref) continue;
                try { await fs.promises.unlink(SafeFs.resolveUnder(t.owner.dir, sub, ref.name)); } catch { /* best effort */ }
            }
        }
        Logger.info(`ShardMerge: merged ${ordered.length} event(s) from ${shards.length} shard(s); result ${report.result}`);
        return { code, reportPath, stateMerge: report.stateMerge };
    } catch (e) {
        if (e && e.name === "ReducerError") return fail3("reducer", e.code);
        if (e && e.name === "StoreUnreadable") return fail3("state_read", e.code);
        throw e;
    }
}

module.exports = { merge, runUuid, checkEvents };
