const Logger = require("../../utils/Logger");
const ClickExplorer = require("./ClickExplorer");
const DOMIssueScanner = require("./DOMIssueScanner");
const TestGenerator = require("./TestGenerator");
const TestRunner = require("./TestRunner");

const DEFAULTS = {
    maxPages: 20,
    sameOriginOnly: true,
    budgetMs: 600_000,
    pageTimeoutMs: 20_000,
    dedupe: true,
    repeat: 1,
};

/**
 * SiteSweep — Phase 10 whole-app coverage orchestrator.
 *
 * Before Phase 10 the product explored a site, discarded every page it found,
 * and generated scenarios for the entry URL only; the flagship 11-page demo
 * only worked because a demo script hardcoded the URL list and looped by hand.
 * SiteSweep is that loop, promoted into the product and given the three things
 * a hand-rolled loop never had: hard bounds (page cap + wall-clock budget),
 * cross-page scenario deduplication, and an explicit account of every page it
 * did *not* test. "What Falcon deliberately didn't cover" is part of the
 * coverage story, so nothing is ever silently dropped from the result.
 */
class SiteSweep {
    /**
     * @param {import('playwright').BrowserContext} context
     * @param {Object} opts
     * @param {number}  [opts.maxPages=20]          Hard cap on pages tested
     * @param {boolean} [opts.sameOriginOnly=true]  Refuse to leave the entry origin
     * @param {number}  [opts.budgetMs=600000]      Total wall-clock budget for the sweep
     * @param {number}  [opts.pageTimeoutMs=20000]  Per-page navigation timeout
     * @param {boolean} [opts.dedupe=true]          Skip scenarios already run on an earlier page
     * @param {number}  [opts.repeat=1]             Times to re-execute each page's generated plan
     * @param {Function}[opts.onEvent]              (name, payload) => void, for dashboard streaming
     */
    constructor(context, opts = {}) {
        this.context = context;
        this.maxPages = Number.isFinite(opts.maxPages) ? opts.maxPages : DEFAULTS.maxPages;
        this.sameOriginOnly = opts.sameOriginOnly !== false;
        this.budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : DEFAULTS.budgetMs;
        this.pageTimeoutMs = Number.isFinite(opts.pageTimeoutMs) ? opts.pageTimeoutMs : DEFAULTS.pageTimeoutMs;
        this.dedupe = opts.dedupe !== false;
        this.repeat = Number.isFinite(opts.repeat) ? opts.repeat : DEFAULTS.repeat;
        this.onEvent = typeof opts.onEvent === "function" ? opts.onEvent : null;

        // Signature → the URL that first ran it. Lives on the instance, not on
        // the module, so two sweeps in one process never contaminate each other.
        this._seenSignatures = new Map();
    }

    /**
     * Normalize a discovered URL into a stable frontier key.
     *
     * Strips the fragment (same document, never a separate page) and any
     * trailing slash below the root, but preserves the query string — for most
     * apps `?id=2` genuinely is a different page, so collapsing it would hide
     * real coverage. Returns null for anything that is not a navigable HTTP(S)
     * page (`mailto:`, `tel:`, `javascript:`, or unparseable junk).
     *
     * @param {string} raw
     * @returns {string|null}
     */
    static normalizeUrl(raw) {
        if (typeof raw !== "string" || !raw.trim()) return null;

        let parsed;
        try {
            parsed = new URL(raw.trim());
        } catch {
            return null;
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

        parsed.hash = "";
        if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
            parsed.pathname = parsed.pathname.slice(0, -1);
        }
        return parsed.toString();
    }

    /**
     * The deduplication signature. Deliberately conservative: two scenarios
     * collapse only when they are byte-identical instructions, so a shared nav
     * bar stops producing eleven copies of itself while two genuinely different
     * interactions can never be mistaken for one.
     */
    static signatureOf(scenario) {
        // `description` is part of the signature, not decoration. PageAnalyser
        // falls back to `tag[type=…]` and structural nth-of-type paths when an
        // element has no distinguishing attribute, so on a templated app
        // /users' "Delete user" and /reports' "Export" can both come back as
        // `button[type="submit"]`. Signing on locator alone would collapse them
        // and report Export as covered by a run that never touched it — which
        // is the one thing a coverage feature must never do. Shared chrome
        // still dedupes, because a nav link carries the same description on
        // every page it appears on.
        return [
            scenario.action,
            scenario.locator,
            scenario.value ?? "",
            scenario.description ?? "",
        ].join("::");
    }

    /** Ceiling on anchors read from one page — see _harvestLinks(). */
    static MAX_HARVESTED_LINKS = 500;

    /** A listener that throws must not take the sweep down with it. */
    _emit(name, payload) {
        if (!this.onEvent) return;
        try {
            this.onEvent(name, payload);
        } catch (error) {
            Logger.warning(`⚠️  SiteSweep event listener threw on "${name}": ${error.message}`);
        }
    }

    /**
     * @param {string} entryUrl
     * @returns {Promise<SweepResult>}
     */
    async run(entryUrl) {
        const startedAt = Date.now();

        const entry = SiteSweep.normalizeUrl(entryUrl);
        if (!entry) throw new Error(`SiteSweep requires an http(s) entry URL, received: ${entryUrl}`);

        const discovered = await this._discover(entry);
        const { pages, queue, outOfScope } = this._plan(entry, discovered);

        let budgetExhausted = false;
        for (let i = 0; i < queue.length; i++) {
            const record = queue[i];

            if (Date.now() - startedAt >= this.budgetMs) {
                budgetExhausted = true;
                for (const remaining of queue.slice(i)) {
                    remaining.status = "skipped";
                    remaining.reason = "budget-exhausted";
                }
                Logger.warning(`⏱  Sweep budget of ${this.budgetMs}ms exhausted — ${queue.length - i} page(s) skipped.`);
                break;
            }

            await this._sweepPage(record, i, queue.length);
        }

        const coverage = SiteSweep.summarize(pages);
        coverage.budgetExhausted = budgetExhausted;
        coverage.linksOutOfScope = outOfScope.length;

        Logger.info(
            `🗺  Sweep complete: ${coverage.pagesTested} tested, ${coverage.pagesSkipped} skipped, ` +
            `${coverage.pagesUnreachable} unreachable | ${coverage.scenariosGenerated} scenario(s) generated, ` +
            `${coverage.scenariosDeduplicated} deduped`
        );

        const result = { entryUrl: entry, pages, coverage };

        // Pages that were never opened (max-pages, budget-exhausted,
        // cross-origin, unsupported-scheme) emit no pageStart/pageComplete of
        // their own, because nothing was ever navigated to. That list is
        // precisely the half of a coverage story that says what Falcon did
        // *not* look at, so a consumer reconstructing coverage from the
        // streamed events alone would silently under-report. This final event
        // carries the whole result so the dashboard can reconcile.
        this._emit("sweepComplete", result);

        return result;
    }

    /**
     * Run ClickExplorer from the entry page to map the frontier. Exploration is
     * best-effort: a crawler that dies halfway still leaves us the entry URL and
     * whatever it reached, which is strictly better than aborting the run.
     */
    async _discover(entry) {
        let page;
        try {
            page = await this.context.newPage();
            await page.goto(entry, { waitUntil: "load", timeout: this.pageTimeoutMs });

            // Harvest before exploring, not after: ClickExplorer navigates the
            // page as it clicks, so anything read afterwards describes wherever
            // it happened to end up rather than the entry page.
            const linked = await this._harvestLinks(page);

            const explorer = new ClickExplorer(page);
            await explorer.explore();

            let visitedPages = explorer.visitedPages;
            if (!(visitedPages instanceof Set)) {
                Logger.warning("⚠️  ClickExplorer.visitedPages is not a Set — defaulting to empty Set");
                visitedPages = new Set();
            }
            return [...linked, ...visitedPages];
        } catch (error) {
            Logger.warning(`⚠️  Exploration from ${entry} failed (${error.message}) — sweeping the entry page only.`);
            return [];
        } finally {
            if (page) await page.close().catch(() => {});
        }
    }

    /**
     * Read every anchor target off the page.
     *
     * ClickExplorer discovers pages by clicking, which bounds discovery to the
     * handful of elements it is willing to click and misses anything behind a
     * link it can't reach — in practice it frequently returns the entry page
     * alone, which would leave this sweep with nothing to sweep. A site's
     * navigation already names its own pages in plain href attributes, so
     * reading them costs one evaluate and finds pages a click-driven crawl
     * never reaches. The `href` IDL property resolves against the document, so
     * relative and root-relative paths both come back absolute.
     *
     * Best-effort by design: a page that blocks evaluation still gets swept
     * using whatever ClickExplorer found.
     */
    async _harvestLinks(page) {
        try {
            const hrefs = await page.$$eval("a[href]", (anchors) => anchors.map((a) => a.href).filter(Boolean));
            // A link-farm or a paginated index can carry tens of thousands of
            // anchors. Every one of them would become a page record in the
            // report and a row in the dashboard's replay buffer, so cap what we
            // take. The cap is far above any real navigation and well above
            // maxPages, so it only ever bites pathological pages.
            if (hrefs.length > SiteSweep.MAX_HARVESTED_LINKS) {
                Logger.warning(
                    `⚠️  ${hrefs.length} links on the entry page — considering the first ` +
                    `${SiteSweep.MAX_HARVESTED_LINKS}.`
                );
                return hrefs.slice(0, SiteSweep.MAX_HARVESTED_LINKS);
            }
            return hrefs;
        } catch (error) {
            Logger.warning(`⚠️  Could not read links from ${await page.url?.() ?? "the entry page"} (${error.message}) — using click-based discovery alone.`);
            return [];
        }
    }

    /**
     * Turn raw discovered URLs into the ordered page-record list plus the queue
     * of records that will actually be visited. The entry URL is always first,
     * so a truncated sweep still covers the page the user pointed us at.
     */
    _plan(entry, discovered) {
        const seen = new Set();
        const eligible = [];
        const rejected = [];
        const entryOrigin = new URL(entry).origin;

        for (const raw of [entry, ...discovered]) {
            const normalized = SiteSweep.normalizeUrl(raw);
            // Unparseable URLs still need a stable key, or `mailto:x` listed
            // twice would be reported as two separate skipped pages.
            const key = normalized ?? String(raw).trim();
            if (seen.has(key)) continue;
            seen.add(key);

            if (!normalized) {
                rejected.push({ url: key, reason: "unsupported-scheme" });
            } else if (this.sameOriginOnly && new URL(normalized).origin !== entryOrigin) {
                rejected.push({ url: normalized, reason: "cross-origin" });
            } else {
                eligible.push(normalized);
            }
        }

        const pages = [];
        const queue = [];

        eligible.forEach((url, index) => {
            const record = SiteSweep._blankRecord(url);
            if (index >= this.maxPages) {
                record.status = "skipped";
                record.reason = "max-pages";
            } else {
                queue.push(record);
            }
            pages.push(record);
        });

        // `rejected` is deliberately NOT added to `pages`. A mailto: address or
        // a link to someone else's domain is not a page of the application that
        // Falcon failed to cover, and counting it as one wrecks the number this
        // whole phase exists to produce: an entry page with forty external
        // links and a dozen mailto: links would report "11 of 53 pages tested"
        // and fill the not-covered list with email addresses. They are returned
        // as a count instead, so nothing is hidden and the ratio still means
        // something.
        return { pages, queue, outOfScope: rejected };
    }

    static _blankRecord(url) {
        return {
            url,
            status: "skipped",
            reason: undefined,
            scenariosGenerated: 0,
            scenariosDeduplicated: 0,
            results: [],
            uiIssues: [],
            durationMs: 0,
        };
    }

    /** Test one page in place, mutating its record. Never throws. */
    async _sweepPage(record, index, total) {
        const startedAt = Date.now();
        let page;

        // pageStart fires before navigation, not after it as the phase plan's
        // step ordering implies: a streaming consumer pairs start with complete,
        // and an unreachable page that only ever emitted "complete" would either
        // be dropped from the live view or arrive as a half-built row.
        // 1-based on the wire: this payload exists to be read ("Page 3 of 11"),
        // and a consumer that treats the first page as the start of a new sweep
        // needs that signal to be unambiguous — with a 0-based index, both the
        // first and second page look like "page <= 1".
        this._emit("pageStart", { url: record.url, index: index + 1, total });

        try {
            page = await this.context.newPage();
            const response = await page.goto(record.url, { waitUntil: "load", timeout: this.pageTimeoutMs });

            // Playwright resolves goto() on a 404 or a 500 — it only rejects
            // when navigation itself fails. Without this check an error page
            // counts as a tested page: it generates no scenarios, so it quietly
            // inflates pagesTested and drags the headline coverage number away
            // from what was actually exercised. An error status is a finding
            // about the app, not a page worth sweeping.
            const status = response?.status();
            if (status !== undefined && status >= 400) {
                throw new Error(`HTTP ${status}`);
            }
        } catch (error) {
            record.status = "unreachable";
            record.reason = error.message;
            record.durationMs = Date.now() - startedAt;
            // A page of the app under test that will not load is a finding, not
            // a footnote. Page status alone is tallied only into `coverage`,
            // which nothing gates on, so a sweep where ten of eleven pages
            // returned 500 and one static page passed would exit 0. Recording
            // it as a failed scenario puts it in front of whoever reads the
            // report and lets it fail the build like any other failure.
            record.results = [
                { name: `Load ${record.url}`, status: "failed", error: error.message },
            ];
            Logger.warning(`⚠️  Unreachable: ${record.url} (${error.message})`);
            if (page) await page.close().catch(() => {});
            this._emit("pageComplete", { url: record.url, summary: SiteSweep._summaryOf(record) });
            return;
        }

        // `deduped`/`kept` are hoisted so the catch below can release dedupe
        // claims. Salvaging whatever verdicts were already reached before a
        // mid-plan throw comes from `error.partialResults`, which
        // TestRunner.runRepeatedTestPlan attaches to the error it rethrows —
        // a crash partway through must not discard verdicts already reached,
        // or a page that genuinely broke could hand back a green exit code.
        let deduped = [];
        let kept = [];

        try {
            record.uiIssues = await this._detectIssues(page, record.url);

            const testPlan = await this._generate(page, record.url);
            const scenarios = Array.isArray(testPlan.test_scenarios) ? testPlan.test_scenarios : [];
            record.scenariosGenerated = scenarios.length;

            const applied = this._applyDedupe(scenarios, record.url);
            deduped = applied.deduped;
            kept = applied.kept;
            record.scenariosDeduplicated = deduped.length;

            const repeatedPlan = { ...testPlan, test_scenarios: kept };
            const results = await TestRunner.runRepeatedTestPlan(page, repeatedPlan, this.repeat);

            // Deduped scenarios are appended, never executed — that is what keeps
            // them out of FlakinessTracker, which TestRunner feeds from inside
            // runScenario(). Their only existence is as a reporting row.
            record.results = [...(Array.isArray(results) ? results : []), ...deduped];
            record.status = "tested";
            record.reason = undefined;
        } catch (error) {
            // The page loaded, so it is not "unreachable" — generation or
            // execution broke partway through. Keep every verdict already
            // reached, then record the breakage itself as a failed scenario so
            // it reaches the report and the exit code instead of being visible
            // only as a page-level status nothing tallies.
            const salvaged = Array.isArray(error?.partialResults) ? error.partialResults : [];

            // Release the dedupe claims this page made but never honoured, so a
            // later page runs those scenarios itself instead of reporting them
            // as already covered here.
            const reached = new Set(salvaged.map((r) => r.name));
            for (const scenario of kept) {
                if (!reached.has(scenario.description)) {
                    this._seenSignatures.delete(SiteSweep.signatureOf(scenario));
                }
            }

            record.results = [
                ...salvaged,
                ...deduped,
                { name: `Sweep of ${record.url}`, status: "failed", error: error.message },
            ];
            record.status = "tested";
            record.reason = error.message;
            Logger.warning(
                `⚠️  Sweep of ${record.url} failed after ${salvaged.length} scenario(s): ${error.message}`
            );
        } finally {
            record.durationMs = Date.now() - startedAt;
            await page.close().catch(() => {});
        }

        this._emit("pageComplete", { url: record.url, summary: SiteSweep._summaryOf(record) });
    }

    async _detectIssues(page, url) {
        try {
            const issues = await new DOMIssueScanner(page).detectUIIssues();
            if (Array.isArray(issues)) return issues;
            Logger.warning(`⚠️  detectUIIssues() did not return an array for ${url} — defaulting to []`);
        } catch (error) {
            Logger.warning(`⚠️  detectUIIssues() failed on ${url} (${error.message}) — defaulting to []`);
        }
        return [];
    }

    async _generate(page, url) {
        const testPlan = await new TestGenerator(page).generateTestScenarios();
        if (!testPlan || typeof testPlan !== "object") {
            Logger.warning(`⚠️  generateTestScenarios() returned no plan for ${url} — treating as empty.`);
            return { url, test_scenarios: [] };
        }
        return testPlan;
    }

    /**
     * Split a page's scenarios into the ones to run and the ones already run
     * on an earlier page. `deduped` rows carry `firstRunOn` so the report can
     * say *where* the scenario actually ran rather than just that it vanished.
     */
    _applyDedupe(scenarios, url) {
        if (!this.dedupe) return { kept: scenarios, deduped: [] };

        const kept = [];
        const deduped = [];

        for (const scenario of scenarios) {
            const signature = SiteSweep.signatureOf(scenario);
            const firstRunOn = this._seenSignatures.get(signature);
            if (firstRunOn === undefined) {
                // Claimed here, before execution, so the rest of this page's
                // scenarios dedupe against it. If this page later throws, the
                // claim is released in _sweepPage's catch — otherwise every
                // later page would report the scenario as deduped against a
                // page that never actually ran it, asserting coverage that
                // does not exist.
                this._seenSignatures.set(signature, url);
                kept.push(scenario);
            } else {
                deduped.push({ name: scenario.description, status: "deduped", firstRunOn });
            }
        }

        return { kept, deduped };
    }

    /**
     * Fold the page records into the coverage block. Kept static and pure so
     * the report layer can recompute it from a persisted `pages` array.
     */
    static summarize(pages = []) {
        const coverage = {
            pagesDiscovered: pages.length,
            pagesTested: 0,
            pagesSkipped: 0,
            pagesUnreachable: 0,
            scenariosGenerated: 0,
            scenariosDeduplicated: 0,
            budgetExhausted: false,
        };

        for (const page of pages) {
            if (page.status === "tested") coverage.pagesTested++;
            else if (page.status === "unreachable") coverage.pagesUnreachable++;
            else coverage.pagesSkipped++;

            coverage.scenariosGenerated += page.scenariosGenerated || 0;
            coverage.scenariosDeduplicated += page.scenariosDeduplicated || 0;
        }

        return coverage;
    }

    /** The per-page payload carried by `pageComplete`. */
    static _summaryOf(record) {
        const tally = { passed: 0, failed: 0, skipped: 0, quarantined: 0, deduped: 0, unavailable: 0 };
        for (const result of record.results) {
            if (Object.hasOwn(tally, result.status)) tally[result.status]++;
        }

        return {
            url: record.url,
            status: record.status,
            reason: record.reason,
            scenariosGenerated: record.scenariosGenerated,
            scenariosDeduplicated: record.scenariosDeduplicated,
            uiIssues: record.uiIssues.length,
            durationMs: record.durationMs,
            ...tally,
        };
    }
}

module.exports = SiteSweep;
