"use strict";

const Logger = require("../../../utils/Logger");
const ClickExplorer = require("../ClickExplorer");
const SiteSweep = require("../SiteSweep");
const { runBounded } = require("./Scheduler");

// Same bounds as the sequential crawl: two click hops from the entry page and
// five candidates per page. The task cap keeps a hostile page from fanning out.
const MAX_DEPTH = 2;
const MAX_CANDIDATES = 5;
const MAX_TASKS = 400;
const MAX_ERROR = 200;
const MAX_HREF = 2048;

const bound = (e) => String(e && e.message !== undefined ? e.message : e).replace(/[^\x20-\x7e]/g, "?").slice(0, MAX_ERROR);

// One retry for a task that threw: a transient load or click failure on one
// shard must not silently shrink its frontier relative to the others.
async function withRetry(fn) {
    try {
        return await fn();
    } catch (first) {
        return fn();
    }
}

function originOf(url) {
    try { return new URL(url).origin; } catch { return null; }
}

// A link that is never followed: an oversized href, or one that carries
// credentials in the URL. Neither is clicked nor recorded.
function unsafeHref(el, base) {
    if (!el.href) return false;
    const raw = el.href.trim();
    if (raw.length > MAX_HREF) return true;
    try {
        const u = new URL(raw, base);
        return Boolean(u.username || u.password);
    } catch {
        return false;
    }
}

// An anchor whose click can only navigate to its href: an http(s) href, no
// inline handler, not a bare fragment. Returns the normalized destination.
function plainAnchorTarget(el, base) {
    if (!el.href || el.hasHandler) return null;
    const raw = el.href.trim();
    if (!raw || raw.length > MAX_HREF || raw.startsWith("#")) return null;
    try {
        const u = new URL(raw, base);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        if (u.username || u.password) return null;
        return SiteSweep.normalizeUrl(u.href);
    } catch {
        return null;
    }
}

/**
 * Level-synchronous click discovery for parallel and shard runs.
 *
 * The sequential crawl is depth-first on one page and goes back after every
 * click. This does the same hops breadth-first: each (page, candidate) pair is
 * an independent task that opens its own page, loads the URL, clicks that
 * candidate and reads where it landed. The set found at each level is the union
 * of the task results, so it does not depend on task timing or on how many
 * tasks run at once. Every shard therefore computes the same frontier.
 *
 * Differences from the sequential crawl, kept on purpose: pages on another
 * origin are recorded but never opened, links that open in a new tab are not
 * clicked, and clicks on pages two hops away (whose results the sequential
 * crawl discards) are not made.
 */
async function discover(context, entry, { concurrency = 1, pageTimeoutMs = 20000 } = {}) {
    const entryKey = SiteSweep.normalizeUrl(entry);
    if (!entryKey) return [];
    const origin = originOf(entryKey);
    const visited = new Set([entryKey]);
    let frontier = [entryKey];
    let tasksRun = 0;

    // Load a page once and list its candidates. Plain same-document or
    // cross-document anchors name their destination in the href, so those are
    // resolved from the attribute; everything else (buttons, anchors with an
    // inline handler or a bare fragment/script href) still gets a real click.
    let failed = 0;

    async function probeOnce(url) {
        let page;
        try {
            page = await context.newPage();
            await page.goto(url, { waitUntil: "load", timeout: pageTimeoutMs });
            const base = page.url();
            const candidates = (await ClickExplorer.listCandidates(page)).filter((el) => el.text).slice(0, MAX_CANDIDATES);
            const resolved = [];
            const clicks = [];
            candidates.forEach((el, index) => {
                if (el.newTab || unsafeHref(el, base)) return;
                const target = plainAnchorTarget(el, base);
                if (target) resolved.push(target);
                else clicks.push({ url, index });
            });
            return { resolved, clicks };
        } finally {
            if (page) await page.close().catch(() => {});
        }
    }

    async function probeTask(url) {
        try {
            return await withRetry(() => probeOnce(url));
        } catch (error) {
            failed++;
            Logger.warning(`⚠️ Discovery could not load ${url}: ${bound(error)}`);
            return { resolved: [], clicks: [] };
        }
    }

    async function clickOnce({ url, index }) {
        let page;
        try {
            page = await context.newPage();
            await page.goto(url, { waitUntil: "load", timeout: pageTimeoutMs });
            const candidates = (await ClickExplorer.listCandidates(page)).filter((el) => el.text).slice(0, MAX_CANDIDATES);
            const element = candidates[index];
            if (!element || element.newTab) return null;
            if (!(await ClickExplorer.clickElement(page, element))) return null;
            await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
            return SiteSweep.normalizeUrl(page.url());
        } finally {
            if (page) await page.close().catch(() => {});
        }
    }

    async function clickTask(task) {
        try {
            return await withRetry(() => clickOnce(task));
        } catch (error) {
            failed++;
            Logger.warning(`⚠️ Discovery click failed on ${task.url}: ${bound(error)}`);
            return null;
        }
    }

    for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
        if (tasksRun >= MAX_TASKS) {
            Logger.warning(`⚠️ Discovery task cap (${MAX_TASKS}) reached; ${frontier.length} page(s) not explored.`);
            break;
        }
        const probes = frontier.slice(0, MAX_TASKS - tasksRun);
        if (probes.length < frontier.length) Logger.warning(`⚠️ Discovery task cap (${MAX_TASKS}) reached; ${frontier.length - probes.length} page(s) not explored.`);
        tasksRun += probes.length;
        const probed = await runBounded(probes, concurrency, probeTask);

        const found = new Set();
        const clickTasks = [];
        for (const r of probed) {
            if (r.status !== "done") continue;
            for (const url of r.value.resolved) found.add(url);
            clickTasks.push(...r.value.clicks);
        }
        const batch = clickTasks.slice(0, Math.max(0, MAX_TASKS - tasksRun));
        if (batch.length < clickTasks.length) Logger.warning(`⚠️ Discovery task cap (${MAX_TASKS}) reached; ${clickTasks.length - batch.length} click(s) skipped.`);
        tasksRun += batch.length;
        const clicked = await runBounded(batch, concurrency, clickTask);
        for (const r of clicked) if (r.status === "done" && r.value) found.add(r.value);

        frontier = [];
        for (const url of [...found].sort()) {
            if (visited.has(url)) continue;
            visited.add(url);
            if (originOf(url) === origin) frontier.push(url);
        }
    }
    if (failed) Logger.warning(`⚠️ Discovery finished with ${failed} failed task(s); the page set may be incomplete.`);
    return [...visited].sort();
}

module.exports = { discover, MAX_DEPTH, MAX_CANDIDATES, MAX_TASKS };
