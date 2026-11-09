const crypto = require("node:crypto");
const SiteSweep = require("./SiteSweep");

/**
 * JourneyExplorer — bounded, deterministic discovery and replay of 2–5 step
 * UI journeys (issue #78).
 *
 * A "state" is what the page looks like, not where it is: normalized URL
 * (query keys only, never values), the sorted set of interactive elements,
 * form-field shape (filled/empty, never the value) and the names of the
 * cookies in scope (never their values). Two actions that land on the same
 * state are one state, so shared chrome and toggles cannot blow up the graph.
 *
 * Traversal is breadth-first from the entry URL. Each state is reached by
 * replaying its recorded path from a fresh navigation, so exploration needs
 * no browser history and a stale in-page state can never leak across branches.
 *
 * Refusals are explicit and reported, never silently skipped: destructive or
 * ambiguous controls, cross-origin targets, new tabs, form submits and
 * anything over budget. Nothing here uses a model or randomness.
 */

const DEFAULTS = { maxSteps: 3, maxActions: 40, maxStates: 25, maxJourneys: 10 };
const HARD_MAX_STEPS = 5;
const MIN_JOURNEY_STEPS = 2;

// Verbs that change or destroy something. Matched on label, href and selector.
const DESTRUCTIVE = /\b(delete|remove|destroy|drop|purge|erase|wipe|cancel|unsubscribe|deactivate|reset|pay|buy|purchase|checkout|order|confirm|sign.?out|log.?out|transfer|send)\b/i;

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const short = (value) => sha(value).slice(0, 12);

/** Query keys without values: values can carry tokens, ids and PII. */
function safeUrl(raw) {
    const normalized = SiteSweep.normalizeUrl(raw);
    if (!normalized) return null;
    const u = new URL(normalized);
    const keys = [...new Set(u.searchParams.keys())].sort();
    return u.origin + u.pathname + (keys.length ? `?${keys.join("&")}` : "");
}

/** In-page snapshot. Returns plain data; values are reduced to booleans. */
function snapshotInPage() {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const controls = [...document.querySelectorAll("a, button")]
        .filter((el) => el.getClientRects().length)
        .map((el) => `${el.tagName.toLowerCase()}|${clean(el.innerText || el.textContent)}|${el.getAttribute("href") || ""}`)
        .sort();
    const fields = [...document.querySelectorAll("input, select, textarea")]
        .map((el) => `${el.tagName.toLowerCase()}|${el.getAttribute("name") || el.id || ""}|${el.type || ""}|${el.type === "checkbox" || el.type === "radio" ? el.checked : !!el.value}`)
        .sort();
    const dialogs = [...document.querySelectorAll("dialog[open], [role=dialog]")]
        .filter((el) => el.getClientRects().length).length;
    return { controls, fields, dialogs };
}

class JourneyExplorer {
    /**
     * @param {import('playwright').Page} page
     * @param {Object} [opts]
     * @param {number} [opts.maxSteps=3]     Journey depth cap (2–5)
     * @param {number} [opts.maxActions=40]  Total clicks, replays included
     * @param {number} [opts.maxStates=25]   Distinct states recorded
     * @param {number} [opts.maxJourneys=10] Journeys reported
     */
    constructor(page, opts = {}) {
        this.page = page;
        const num = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);
        this.maxSteps = Math.min(num(opts.maxSteps, DEFAULTS.maxSteps), HARD_MAX_STEPS);
        this.maxActions = num(opts.maxActions, DEFAULTS.maxActions);
        this.maxStates = num(opts.maxStates, DEFAULTS.maxStates);
        this.maxJourneys = num(opts.maxJourneys, DEFAULTS.maxJourneys);
        this.actions = 0;
    }

    /** Stable identity of the current page state. */
    async stateId() {
        const snap = await this.page.evaluate(snapshotInPage);
        const cookies = (await this.page.context().cookies()).map((c) => c.name).sort();
        return short(JSON.stringify([safeUrl(this.page.url()), snap, cookies]));
    }

    async _settle() {
        await this.page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
        await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
    }

    /** Spend one action from the budget; false when it is exhausted. */
    _spend() {
        if (this.actions >= this.maxActions) return false;
        this.actions++;
        return true;
    }

    /**
     * Classify the controls on the current page into safe actions and refusals.
     * Order is by label, href then selector so every run sees the same sequence.
     */
    async _actionsHere(origin) {
        // One in-page read, so facts and indexes cannot drift apart. The selector
        // rules mirror ClickExplorer.listCandidates so stored journeys stay comparable.
        const all = await this.page.evaluate(() => {
            const sel = (el) => {
                const tag = el.tagName.toLowerCase();
                const testId = el.getAttribute("data-testid");
                if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
                if (el.id) return `#${CSS.escape(el.id)}`;
                const aria = el.getAttribute("aria-label");
                if (aria) return `${tag}[aria-label="${CSS.escape(aria)}"]`;
                const name = el.getAttribute("name");
                if (name) return `${tag}[name="${CSS.escape(name)}"]`;
                const type = el.getAttribute("type");
                if (type) return `${tag}[type="${CSS.escape(type)}"]`;
                return null;
            };
            return [...document.querySelectorAll("a, button")].map((el, index) => ({
                index,
                selector: sel(el),
                text: (el.innerText || el.textContent || "").trim().substring(0, 100),
                href: el.getAttribute("href") || null,
                newTab: el.getAttribute("target") === "_blank",
                submit: el.tagName === "BUTTON" && el.type === "submit" && !!el.form,
                hint: [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("value"), el.id, el.getAttribute("name")].filter(Boolean).join(" "),
            }));
        });
        const count = (key, fn) => all.filter((c) => fn(c) === key).length;
        const safe = [];
        const refused = [];
        for (const c of all) {
            const label = c.text || c.selector || this._hrefLabel(c.href) || "(unlabeled)";
            const reason = this._refusal(c, origin, count);
            if (reason) refused.push({ label, reason, selector: c.selector, text: c.text });
            else safe.push({ label, index: c.index, newTab: c.newTab, selector: c.selector, text: c.text, href: c.href ? safeUrl(new URL(c.href, this.page.url()).href) : null, rawHref: c.href });
        }
        const key = (a) => `${a.label}\u0000${a.href || ""}\u0000${a.selector || ""}`;
        safe.sort((a, b) => (key(a) < key(b) ? -1 : 1));
        refused.sort((a, b) => (`${a.label}${a.reason}` < `${b.label}${b.reason}` ? -1 : 1));
        return { safe, refused };
    }

    /** Label for a control with no text or selector: path and query keys only. */
    _hrefLabel(href) {
        if (!href) return null;
        try { return safeUrl(new URL(href, this.page.url()).href); } catch { return null; }
    }

    _refusal(c, origin, count) {
        if (!c.text && !c.selector) return "ambiguous: no label or selector";
        const hay = `${c.text} ${c.href || ""} ${c.selector || ""} ${c.hint || ""}`;
        // Split camelCase and separators so btnDelete, delete_x and /deleteAccount match.
        if (DESTRUCTIVE.test(hay.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-/.]+/g, " "))) return "destructive: label matches a state-changing verb";
        if (c.newTab) return "new-tab: Falcon stays in one tab";
        if (c.submit || (c.selector && /type="submit"/.test(c.selector))) return "form-submit: not exercised without an approved contract";
        if (c.href) {
            let target;
            try { target = new URL(c.href, this.page.url()); } catch { return "ambiguous: unparseable href"; }
            if (target.protocol !== "http:" && target.protocol !== "https:") return `unsupported-scheme: ${target.protocol}`;
            if (target.origin !== origin) return "cross-origin: target leaves the entry origin";
        }
        const dupes = c.selector ? count(c.selector, (x) => x.selector) : count(c.text, (x) => (x.selector ? null : x.text));
        if (dupes > 1) return "ambiguous: selector or label matches several controls";
        return null;
    }

    /** A step is only clickable if it matches a control that is live now and passes the refusal rules. */
    _same(a, step) { return (a.selector || null) === (step.selector || null) && (a.text || "") === (step.text || ""); }

    async _live(step, origin) {
        const { safe } = await this._actionsHere(origin);
        return safe.find((a) => this._same(a, step)) || null;
    }

    /**
     * Click one live action. Returns "ok" | "failed" | "budget".
     * It clicks the element that was classified (by index, re-checked first) and never
     * falls back to a text search, which could land on a control that was refused.
     */
    async _click(action) {
        if (!this._spend()) return "budget";
        const loc = this.page.locator("a, button").nth(action.index);
        try {
            const same = await loc.evaluate((el, a) => (el.innerText || el.textContent || "").trim().substring(0, 100) === a.text
                && (el.getAttribute("href") || null) === a.rawHref, action, { timeout: 4000 });
            if (!same) return "failed";
            await loc.click({ timeout: 4000 });
        } catch {
            return "failed";
        }
        await this._settle();
        return "ok";
    }

    /** Navigate to the entry and replay a path. Returns null on success, else { at, result }. */
    async _walk(entryUrl, steps, origin) {
        await this.page.goto(entryUrl, { waitUntil: "domcontentloaded" });
        await this._settle();
        if (new URL(this.page.url()).origin !== origin) return { at: 0, result: "cross-origin" };
        for (let i = 0; i < steps.length; i++) {
            const live = await this._live(steps[i], origin);
            if (!live) return { at: i, result: "failed" };
            const result = await this._click(live);
            if (result !== "ok") return { at: i, result };
            if (new URL(this.page.url()).origin !== origin) return { at: i, result: "cross-origin" };
        }
        return null;
    }

    /**
     * Discover journeys from entryUrl.
     * @returns {Promise<Object>} deterministic report (see `digest`)
     */
    async discover(entryUrl) {
        const entry = SiteSweep.normalizeUrl(entryUrl);
        if (!entry) throw new Error("JourneyExplorer: entry URL must be http(s)");
        const origin = new URL(entry).origin;
        this.actions = 0;

        const states = new Map();      // id -> { id, url, depth, path }
        const equivalent = [];         // actions that landed on an already-known state
        const refusals = [];
        const unreachable = [];
        let budgetExhausted = false;
        let unexplored = 0;

        await this.page.goto(entry, { waitUntil: "domcontentloaded" });
        await this._settle();
        if (new URL(this.page.url()).origin !== origin) throw new Error("JourneyExplorer: entry URL redirected to another origin");
        const rootId = await this.stateId();
        states.set(rootId, { id: rootId, url: safeUrl(entry), depth: 0, path: [] });
        const queue = [rootId];
        const children = new Map();

        while (queue.length) {
            const id = queue.shift();
            const state = states.get(id);
            if (state.depth >= this.maxSteps) continue;

            const fail = await this._walk(entry, state.path, origin);
            if (fail) {
                if (fail.result === "budget") { budgetExhausted = true; unexplored += queue.length + 1; break; }
                unreachable.push({ via: state.path.map((s) => s.label), reason: `replay-${fail.result}` });
                continue;
            }

            const { safe, refused } = await this._actionsHere(origin);
            for (const r of refused) refusals.push({ state: id, label: r.label, reason: r.reason });

            for (let i = 0; i < safe.length; i++) {
                const action = safe[i];
                if (i > 0) {
                    const back = await this._walk(entry, state.path, origin);
                    if (back) { if (back.result === "budget") budgetExhausted = true; unexplored += safe.length - i; break; }
                }
                const live = await this._live(action, origin);
                const result = live ? await this._click(live) : "failed";
                if (result === "budget") { budgetExhausted = true; unexplored += safe.length - i; break; }
                if (result === "failed") { unreachable.push({ state: id, label: action.label, reason: "click-failed" }); continue; }
                if (new URL(this.page.url()).origin !== origin) {
                    refusals.push({ state: id, label: action.label, reason: "cross-origin: navigation left the entry origin" });
                    continue;
                }
                const nextId = await this.stateId();
                if (states.has(nextId)) { equivalent.push({ from: id, label: action.label, to: nextId }); continue; }
                if (states.size >= this.maxStates) { budgetExhausted = true; unexplored++; continue; }
                const step = { label: action.label, selector: action.selector, text: action.text, href: action.href };
                states.set(nextId, { id: nextId, url: safeUrl(this.page.url()), depth: state.depth + 1, path: [...state.path, step] });
                children.set(id, (children.get(id) || 0) + 1);
                queue.push(nextId);
            }
            if (budgetExhausted && this.actions >= this.maxActions) { unexplored += queue.length; break; }
        }

        // Maximal paths only: a journey that is a prefix of a longer one adds nothing.
        const journeys = [...states.values()]
            .filter((s) => s.depth >= MIN_JOURNEY_STEPS && !children.get(s.id))
            .sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1))
            .slice(0, this.maxJourneys)
            .map((s) => ({
                id: s.id,
                entry: safeUrl(entry),
                steps: s.path.map((p, i) => ({ ...p, expect: i === s.path.length - 1 ? s.id : null })),
            }));
        // Record the expected state after every step, not just the last.
        for (const j of journeys) {
            let prefix = [];
            for (const step of j.steps) {
                prefix = [...prefix, step.label];
                const hit = [...states.values()].find((s) => s.path.length === prefix.length && s.path.every((p, k) => p.label === prefix[k]));
                step.expect = hit ? hit.id : step.expect;
            }
        }

        const report = {
            entry: safeUrl(entry),
            limits: { maxSteps: this.maxSteps, maxActions: this.maxActions, maxStates: this.maxStates, maxJourneys: this.maxJourneys },
            coverage: {
                states: states.size,
                journeys: journeys.length,
                actionsUsed: this.actions,
                budgetExhausted,
                unexploredActions: unexplored,
                equivalentTransitions: equivalent.length,
            },
            journeys,
            refusals,
            unreachable,
        };
        report.digest = short(JSON.stringify(report));
        return report;
    }

    /**
     * Replay one journey and compare each step's state to the recorded one.
     * The journey file is untrusted: every step must match a control that is
     * live on the page AND passes the same refusal rules as discovery, and the
     * click uses the live control, never the file's text or selector.
     * @param {Object} journey
     * @param {Object} opts
     * @param {string} opts.allowedOrigin  Required. Origin the caller allows; the file's entry must match it.
     * @returns {Promise<{ok:boolean, divergedAt?:number, reason?:string, expected?:string, actual?:string}>}
     */
    async replay(journey, { allowedOrigin } = {}) {
        this.actions = 0;
        // shortcut: stored entry keeps query keys but no values, so replay starts at the bare path; entries that need a query string cannot be replayed.
        const entry = SiteSweep.normalizeUrl(String((journey && journey.entry) || "").split("?")[0]);
        if (!entry || !allowedOrigin || new URL(entry).origin !== allowedOrigin) return { ok: false, divergedAt: 0, reason: "entry-origin" };
        const origin = allowedOrigin;
        await this.page.goto(entry, { waitUntil: "domcontentloaded" });
        await this._settle();
        if (new URL(this.page.url()).origin !== origin) return { ok: false, divergedAt: 0, reason: "cross-origin" };
        const steps = Array.isArray(journey.steps) ? journey.steps : [];
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i] || {};
            const { safe, refused } = await this._actionsHere(origin);
            const same = (a) => this._same(a, step);
            const live = safe.find(same);
            if (!live) {
                const bad = refused.find(same);
                return { ok: false, divergedAt: i, reason: bad ? `refused: ${bad.reason}` : "step-failed" };
            }
            const result = await this._click(live);
            if (result !== "ok") return { ok: false, divergedAt: i, reason: `step-${result}` };
            if (new URL(this.page.url()).origin !== origin) return { ok: false, divergedAt: i, reason: "cross-origin" };
            const actual = await this.stateId();
            if (step.expect && actual !== step.expect) return { ok: false, divergedAt: i, reason: "state-mismatch", expected: step.expect, actual };
        }
        return { ok: true };
    }
}

module.exports = JourneyExplorer;
module.exports.safeUrl = safeUrl;
