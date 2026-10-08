"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Limits = require("./Limits");
const Schemas = require("./Schemas");
const SafeFs = require("./SafeFs");
const Planning = require("./Planning");

class BundleError extends Error {
    constructor(code, detail) {
        super(`${code}${detail ? " " + String(detail).slice(0, 120) : ""}`);
        this.name = "BundleError";
        this.code = code;
    }
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const clean = (v, max) => String(v === undefined || v === null ? "" : v).replace(CONTROL, "?").slice(0, max);
const sha = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const dur = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(Limits.DURATION_MAX_MS, Math.round(v))) : 0);
const ANALYSIS_MAX_BYTES = 4 * 1024 * 1024;

function shardOrSingle(shard) {
    return shard && Number.isInteger(shard.index) ? { index: shard.index, total: shard.total } : { index: 1, total: 1 };
}

/** Map one executed/derived result row to the strict fragment row shape. */
function toRow(r, scnByName, fallbackRep) {
    const raw = r && r.status;
    const status = ["passed", "failed", "unavailable", "skipped", "deduped"].includes(raw) ? raw : "skipped";
    const errorType = raw === "quarantined" ? "quarantined"
        : (status === "failed" || status === "unavailable") && r.errorType ? clean(r.errorType, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "-") || null
            : raw && status !== raw ? clean(raw, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "-") : null;
    const name = clean(r && r.name, 200) || "unnamed";
    let error = r && r.error ? clean(r.error, Limits.FRAGMENT_MAX_ERROR) : null;
    if (status === "deduped" && r.firstRunOn) error = clean(`firstRunOn ${r.firstRunOn}`, Limits.FRAGMENT_MAX_ERROR);
    const scn = scnByName && scnByName.has(name) ? scnByName.get(name) : null;
    const rep = Number.isInteger(r && r.repetition) ? r.repetition : status === "deduped" ? null : fallbackRep;
    return {
        scenario: name, scn, rep, status,
        durationMs: dur(r && (r.durationMs !== undefined ? r.durationMs : r.duration)),
        errorType, error,
    };
}

function toIssue(u) {
    const o = { type: clean(u && u.type, 40) || "unknown", message: clean(u && (u.message || u.description), Limits.ERROR_MAX) };
    if (u && u.selector) o.selector = clean(u.selector, Limits.SELECTOR_MAX) || undefined;
    if (u && u.severity) o.severity = clean(u.severity, 20);
    if (o.selector === undefined) delete o.selector;
    while (Buffer.byteLength(JSON.stringify(o)) > Limits.FRAGMENT_MAX_UI_ISSUE_BYTES) o.message = o.message.slice(0, Math.floor(o.message.length / 2));
    return o;
}

function buildFragment({ runId, shard, page }) {
    const scnByName = new Map();
    (page.scenarioNames || []).forEach((n, i) => { if (!scnByName.has(n)) scnByName.set(n, i); });
    const rows = (page.results || []).slice(0, Limits.FRAGMENT_MAX_ROWS).map((r) => toRow(r, scnByName, 1));
    const status = page.disposition === "completed" ? (page.status === "unreachable" || page.taskFailed ? "failed" : "ok")
        : page.disposition === "task-failed" ? "failed" : "not-run";
    const f = {
        schema: "falcon.fragment", v: 1, runId, shard, pageOrdinal: page.ordinal, status,
        results: rows,
        uiIssues: (page.uiIssues || []).slice(0, Limits.FRAGMENT_MAX_UI_ISSUES).map(toIssue),
    };
    const err = page.reason && status !== "ok" ? clean(page.reason, Limits.FRAGMENT_MAX_ERROR) : null;
    if (err) f.error = err;
    return f;
}

function verdictCounts(fragments) {
    const c = { passed: 0, failed: 0, skipped: 0, deduped: 0, unavailable: 0 };
    for (const f of fragments) for (const r of f.results) c[r.status]++;
    return c;
}

async function put(root, rel, text) {
    const file = SafeFs.resolveUnder(root, ...rel);
    const w = await SafeFs.writeAtomicPrivate(file, text);
    if (!w.ok) throw new BundleError("BUNDLE_WRITE_FAILED", w.error);
}

async function write(opts) {
    const { dir, runId, commit, configFp, frontierDigest, planDigest, pages } = opts;
    if (typeof dir !== "string" || !dir) throw new BundleError("BUNDLE_DIR_INVALID");
    const shard = shardOrSingle(opts.shard);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    for (const sub of ["fragments", "journals"]) await fs.promises.mkdir(path.join(dir, sub), { recursive: true, mode: 0o700 });

    const manifestPages = [];
    const frags = [];
    for (const page of pages) {
        let fragRef = null;
        let jRef = null;
        if (page.assigned) {
            const frag = buildFragment({ runId, shard, page });
            const v = Schemas.validateFragment(frag);
            if (!v.ok) throw new BundleError("BUNDLE_FRAGMENT_INVALID", `${v.code} ${v.path}`);
            const text = JSON.stringify(frag);
            const name = `page-${page.ordinal}.json`;
            await put(dir, ["fragments", name], text);
            fragRef = { name, bytes: Buffer.byteLength(text), sha256: sha(text) };
            frags.push(frag);
        }
        if (page.journal) {
            const v = Schemas.validateJournal(page.journal);
            if (!v.ok) throw new BundleError("BUNDLE_JOURNAL_INVALID", `${v.code} ${v.path}`);
            const text = JSON.stringify(page.journal);
            const name = `page-${page.ordinal}.json`;
            await put(dir, ["journals", name], text);
            jRef = { name, bytes: Buffer.byteLength(text), sha256: sha(text), events: page.journal.count };
        }
        manifestPages.push({
            ordinal: page.ordinal, url: page.url, assigned: !!page.assigned,
            disposition: page.disposition, fragment: fragRef, journal: jRef,
        });
    }

    const analysis = {
        schema: "falcon.shard-analysis", v: 1, runId,
        pages: pages.map((p) => ({
            ordinal: p.ordinal, url: p.url, status: p.analysisStatus || p.status,
            reason: p.analysisReason ? clean(p.analysisReason, Limits.ERROR_MAX) : null,
            signatures: (p.signatures || []).map((s) => clean(s, Limits.MANIFEST_MAX_STRING)),
        })),
    };
    await put(dir, ["analysis.json"], JSON.stringify(analysis));

    const counts = verdictCounts(frags);
    const hasPageFailure = pages.some((p) => p.disposition === "task-failed");
    const code = counts.failed > 0 || counts.unavailable > 0 || hasPageFailure || opts.infrastructureError ? 1 : 0;
    const startedAt = new Date(opts.startedAt || Date.now());
    const endedAt = new Date(opts.endedAt || Date.now());
    const manifest = {
        schema: "falcon.shard-manifest", v: 1, runId, shard,
        attempt: Number.isInteger(opts.attempt) ? opts.attempt : 1,
        commit: commit || "unknown", configFp, frontierDigest, planDigest,
        pages: manifestPages, exit: { code, verdictCounts: counts },
        timing: { startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), wallMs: Math.max(0, endedAt - startedAt) },
        limits: { workers: opts.limits ? opts.limits.workers : 1, budgetMs: opts.limits && opts.limits.budgetMs !== undefined ? opts.limits.budgetMs : null },
    };
    if (opts.ref) manifest.ref = opts.ref;
    const mv = Schemas.validateManifest(manifest);
    if (!mv.ok) throw new BundleError("BUNDLE_MANIFEST_INVALID", `${mv.code} ${mv.path}`);
    await put(dir, ["manifest.json"], JSON.stringify(manifest));
    return { dir, manifest, exit: manifest.exit };
}

async function readJson(dir, rel, maxBytes, maxDepth, errCode) {
    let file;
    try { file = SafeFs.resolveUnder(dir, ...rel); } catch (e) { throw new BundleError(errCode, e.code); }
    const r = await SafeFs.readBoundedJson(file, { maxBytes, maxDepth });
    if (!r.ok) throw new BundleError(errCode, `${r.code} ${rel.join("/")}`);
    const raw = await fs.promises.readFile(file, "utf8");
    return { value: r.value, bytes: Buffer.byteLength(raw), sha256: sha(raw) };
}

async function read(dir) {
    const m = await readJson(dir, ["manifest.json"], Limits.MANIFEST_MAX_BYTES, Limits.MANIFEST_MAX_DEPTH, "BUNDLE_MANIFEST_UNREADABLE");
    const mv = Schemas.validateManifest(m.value);
    if (!mv.ok) throw new BundleError("BUNDLE_MANIFEST_INVALID", `${mv.code} ${mv.path}`);
    const manifest = m.value;
    const fragments = new Map();
    const journals = new Map();
    for (const pg of manifest.pages) {
        if (pg.fragment) {
            const f = await readJson(dir, ["fragments", pg.fragment.name], Limits.FRAGMENT_MAX_BYTES, Limits.FRAGMENT_MAX_DEPTH, "BUNDLE_FRAGMENT_UNREADABLE");
            if (f.sha256 !== pg.fragment.sha256 || f.bytes !== pg.fragment.bytes) throw new BundleError("BUNDLE_FRAGMENT_DIGEST_MISMATCH", pg.fragment.name);
            const fv = Schemas.validateFragment(f.value);
            if (!fv.ok) throw new BundleError("BUNDLE_FRAGMENT_INVALID", `${fv.code} ${fv.path}`);
            if (f.value.runId !== manifest.runId || f.value.pageOrdinal !== pg.ordinal
                || f.value.shard.index !== manifest.shard.index || f.value.shard.total !== manifest.shard.total) {
                throw new BundleError("BUNDLE_FRAGMENT_IDENTITY_MISMATCH", pg.fragment.name);
            }
            fragments.set(pg.ordinal, f.value);
        }
        if (pg.journal) {
            const j = await readJson(dir, ["journals", pg.journal.name], Limits.JOURNAL_MAX_BYTES, Limits.JOURNAL_MAX_DEPTH, "BUNDLE_JOURNAL_UNREADABLE");
            if (j.sha256 !== pg.journal.sha256 || j.bytes !== pg.journal.bytes) throw new BundleError("BUNDLE_JOURNAL_DIGEST_MISMATCH", pg.journal.name);
            const jv = Schemas.validateJournal(j.value);
            if (!jv.ok) throw new BundleError("BUNDLE_JOURNAL_INVALID", `${jv.code} ${jv.path}`);
            if (j.value.runId !== manifest.runId || j.value.pageOrdinal !== pg.ordinal || j.value.count !== pg.journal.events
                || j.value.planDigest !== manifest.planDigest || j.value.configFp !== manifest.configFp) {
                throw new BundleError("BUNDLE_JOURNAL_IDENTITY_MISMATCH", pg.journal.name);
            }
            journals.set(pg.ordinal, j.value);
        }
    }
    const a = await readJson(dir, ["analysis.json"], ANALYSIS_MAX_BYTES, 8, "BUNDLE_ANALYSIS_UNREADABLE");
    const analysis = a.value;
    if (!analysis || analysis.schema !== "falcon.shard-analysis" || analysis.runId !== manifest.runId || !Array.isArray(analysis.pages)
        || analysis.pages.length !== manifest.pages.length) {
        throw new BundleError("BUNDLE_ANALYSIS_INVALID");
    }
    const urls = manifest.pages.map((p) => p.url);
    const sigLists = analysis.pages.map((p) => (Array.isArray(p.signatures) ? p.signatures : null));
    if (sigLists.includes(null) || analysis.pages.some((p, i) => p.ordinal !== manifest.pages[i].ordinal || p.url !== urls[i])) {
        throw new BundleError("BUNDLE_ANALYSIS_INVALID");
    }
    if (Planning.frontierDigest(urls) !== manifest.frontierDigest) {
        throw new BundleError("BUNDLE_FRONTIER_MISMATCH");
    }
    if (Planning.planDigest(sigLists) !== manifest.planDigest) throw new BundleError("BUNDLE_PLAN_DIGEST_MISMATCH");
    return { manifest, fragments, journals, analysis };
}

module.exports = { write, read, BundleError, buildFragment, verdictCounts };
