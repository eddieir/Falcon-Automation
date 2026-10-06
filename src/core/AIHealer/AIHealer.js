const Logger = require("../../../utils/Logger");
const HealingReport = require("./HealingReport");
const HealingTrust = require("./HealingTrust");
const AdaptiveRetry = require("./AdaptiveRetry");
const SharedLocatorMemory = require("../locator/sharedLocatorMemory");
const LocatorIdentity = require("../locator/LocatorIdentity");
const ElementSignature = require("../locator/ElementSignature");
const CandidateMatcher = require("../locator/CandidateMatcher");
const SelectorBuilder = require("../locator/SelectorBuilder");
const DefaultElementFactsCollector = require("../locator/ElementFactsCollector");

/**
 * Locator healing preserves authored Tier 1 evidence and scopes reviewed
 * alternatives by application, page, action, and original selector.
 * Deterministic matches and inference successes remain proposals until approved.
 * Legacy selector-only history is inspectable but never automatically replayed.
 */
const PRE_CAPTURE_TIMEOUT_MS = 150;

class AIHealer {
    constructor(page, { locatorMemory, elementFactsCollector } = {}) {
        this.page = page;
        this._openai = null; // lazy-init to avoid import cost when not needed
        this._retry  = new AdaptiveRetry({ maxAttempts: 3, baseDelayMs: 500 });
        // Phase 14: injectable so tests never touch real data/locator_memory.json.
        // Every existing caller still constructs `new AIHealer(page)` with one
        // argument — the options object defaults to `{}` so that keeps working
        // unchanged. The default is `sharedLocatorMemory.shared()` — the SAME
        // process-wide instance `Dashboard` defaults to — not a private
        // AIHealer-only singleton: two defaults that each thought they owned
        // "the" shared copy is exactly the lost-update bug a prior round of
        // this phase shipped (AIHealer's own singleton vs. Dashboard's
        // per-instance default colliding in the one process `falcon.js` runs
        // both in). See `src/core/locator/sharedLocatorMemory.js`.
        this._locatorMemory = locatorMemory !== undefined ? locatorMemory : SharedLocatorMemory.shared();
        this._collector = elementFactsCollector || DefaultElementFactsCollector;
    }

    /**
     * Attempt to click a selector with progressive fallback.
     *
     * Tier 1 now uses AdaptiveRetry so the wait between attempts is
     * proportional to the failure type (timeout → wait longer; stale
     * element → let DOM settle; network → retry quickly; hard error → bail
     * immediately rather than wasting two more attempts).
     *
     * @param {string} selector - CSS selector to target
     * @param {string} description - Human-readable label for logging
     */
    async healAndClick(selector, description = "Element") {
        return this._healAndPerform("click", selector, description);
    }

    /**
     * Same three-tier chain as healAndClick(), but fills a value into the
     * resolved selector instead of clicking it.
     *
     * @param {string} selector    - CSS selector to target
     * @param {string} value       - Value to fill
     * @param {string} description - Human-readable label for logging
     */
    async healAndType(selector, value, description = "Element") {
        return this._healAndPerform("type", selector, description, value);
    }

    /**
     * Same three-tier chain as healAndClick(), but selects an option on the
     * resolved selector instead of clicking it.
     *
     * @param {string} selector    - CSS selector to target
     * @param {string} value       - Option value to select
     * @param {string} description - Human-readable label for logging
     */
    async healAndSelect(selector, value, description = "Element") {
        return this._healAndPerform("select", selector, description, value);
    }

    /**
     * Shared Tier 1 entry point for every supported action. Resolves the
     * selector once via AdaptiveRetry, then performs the caller's action
     * against it; on exhaustion, hands off to the Tier 2/3 chain for the
     * same action.
     */
    async _healAndPerform(action, selector, description, value) {
        try {
            let captured = null;
            await this._retry.execute(async () => {
                Logger.info(`🔹 Tier 1: Trying ${description} (${selector})`);
                await this.page.waitForSelector(selector, { timeout: 2000 });
                // Read the element while it is still the one being acted on.
                // Re-read on every retry attempt so the evidence always comes
                // from the attempt that actually succeeds.
                captured = await this._preCaptureEvidence(action, selector, selector);
                await this._performAction(action, selector, value);
            }, description);
            // Persistence only after success, and fire-and-forget (Phase 14
            // EP-5 §8): a slow or failing write cannot add latency or a new
            // failure mode to a Tier 1 success that has already happened.
            void this._persistCapturedEvidence(captured);
            return; // Tier 1 succeeded
        } catch (error) {
            Logger.error(`❌ Tier 1 exhausted for ${description}. Engaging Tier 2/3 healing.`);
            await this.healSelector(selector, description, action, value);
        }
    }

    /**
     * Perform one action against an already-resolved selector. Shared by
     * every tier so Tier 2/3 recovery genuinely performs the interaction
     * (fill/selectOption) rather than reporting a healed pass on a click
     * that never happened.
     */
    async _performAction(action, selector, value) {
        if (action === "type") {
            await this.page.fill(selector, value);
        } else if (action === "select") {
            await this.page.selectOption(selector, value);
        } else {
            await this.page.click(selector);
        }
    }

    /**
     * Tier 2 → Tier 3 fallback chain.
     * Tries scoped reviewed evidence before requesting an inferred proposal.
     *
     * `action` defaults to "click" so this method keeps working exactly as
     * before for existing callers that only ever healed clicks directly.
     */
    async healSelector(selector, description, action = "click", value) {
        // Unscoped legacy alternatives remain inspectable, but cannot authorize replay.
        // --- Tier 2.5: LocatorMemory evidence-based healing ---
        if (this._locatorMemory) {
            const identityResult = LocatorIdentity.buildIdentity({
                url: typeof this.page.url === "function" ? this.page.url() : undefined,
                action,
                originalSelector: selector,
            });
            if (identityResult.status === "built") {
                const healed = await this._tryLocatorMemory(identityResult.identity, selector, description, action, value);
                if (healed) return;
            }
            // A refused identity (unparseable/unsupported-scheme URL, e.g. a
            // test double with no page.url()) falls straight through to
            // Tier 3 without logging — identical in effect to Tier 2.5 never
            // having been consulted at all.
        }

        // --- Tier 3: LLM inference ---
        Logger.info(`🤖 Asking AI to infer locator for: ${selector}`);
        // Tier 3 invocation is recorded inside getAlternativeSelector(),
        // immediately before the model request is actually issued — not
        // here. Recording it at this call site would count every attempt
        // that never reached OpenAI at all (missing API key, a DOM snapshot
        // that throws), inflating a counter labelled "Tier 3 invocations"
        // with calls where no model was ever invoked.
        const aiSuggestedLocator = await this.getAlternativeSelector(selector);

        if (aiSuggestedLocator) {
            Logger.info(`🤖 AI suggested: ${aiSuggestedLocator}`);
            let captured;
            try {
                const count = await this._matchCount(aiSuggestedLocator);
                if (count !== 1) {
                    throw new Error(`AI-suggested locator "${aiSuggestedLocator}" is ambiguous (${count} matches)`);
                }

                captured = await this._preCaptureEvidence(action, selector, aiSuggestedLocator);
                await this._performAction(action, aiSuggestedLocator, value);
            } catch (clickErr) {
                Logger.error(`🔥 AI-suggested locator "${aiSuggestedLocator}" also failed: ${clickErr.message}`);
                HealingReport.log({
                    original: selector,
                    resolved: null,
                    tier: "LLM",
                    description,
                    error: clickErr.message,
                    action,
                });
                // Wrap rather than rethrow raw: whatever reaches the result
                // row (TestRunner puts `error.message` straight into it)
                // must say a healed attempt was made and still failed, not
                // just surface a bare Playwright timeout against a selector
                // that no longer exists. The original message is kept
                // in-line (AdaptiveRetry.classify() matches on substrings
                // like "timeout", so appending it — rather than discarding
                // it — keeps error-type classification working) and also
                // attached as `cause` for anyone inspecting the error object
                // directly.
                {
                    // AC-05 seam (Q6): a plain additive property, not a new
                    // exception subclass — the message text above is
                    // untouched so AdaptiveRetry.classify() (which matches on
                    // message substrings) keeps working. TestRunner reads
                    // this code to distinguish "chain exhausted" from any
                    // other failure and report it as its own "unavailable"
                    // status instead of a plain "failed".
                    const err = new Error(
                        `AI-Healer could not resolve ${description} (${selector}) after healing — ` +
                        `the healed attempt against "${aiSuggestedLocator}" also failed: ${clickErr.message}`,
                        { cause: clickErr }
                    );
                    err.code = "TARGET_UNAVAILABLE";
                    throw err;
                }
            }

            // The catch above always throws, so only a successful action
            // reaches the bookkeeping below. A failure here must never be
            // reported as the action having failed.
            if (captured) {
                this._recordPendingCandidateSafe(captured.identity, {
                    selector: aiSuggestedLocator, signature: captured.signature, source: "inference",
                });
            }
            // Phase 8: not persisted to LocatorStore yet — an unreviewed
            // guess is not trusted for reuse just because it worked once.
            // It sits in HealingTrust until a human approves it. This
            // trust gate is unconditional — it applies the same way
            // whichever action was healed.
            HealingTrust.recordPending({
                original: selector,
                suggested: aiSuggestedLocator,
                description,
                scoped: Boolean(captured),
            });
            HealingReport.log({
                original: selector,
                resolved: aiSuggestedLocator,
                tier: "LLM",
                description,
                trust: "pending",
                action,
            });
        } else {
            const msg = `AI-Healer could not resolve ${description} (${selector}): element not found after healing`;
            Logger.error(`🔥 ${msg}`);
            HealingReport.log({ original: selector, resolved: null, tier: "LLM", description, action });
            const err = new Error(msg);
            err.code = "TARGET_UNAVAILABLE";
            throw err;
        }
    }

    /**
     * Tier 2.5 core (EP-5 §8 step 2-5). Only ever called once an identity has
     * been built; `entry` is looked up first so a cold identity (the common
     * case) costs exactly zero DOM queries — `ElementFactsCollector.collect`
     * is never invoked unless trusted evidence already exists.
     *
     * Returns `true` if the action was performed successfully against a
     * LocatorMemory-resolved selector (caller returns immediately, mirroring
     * Tier 2's own early `return`); `false` for every other outcome (no
     * evidence, refused match, a resolved selector that turned out
     * non-unique, or an accepted candidate whose action itself failed) — all
     * of which fall through to Tier 3 exactly like Tier 2 having nothing.
     */
    async _tryLocatorMemory(identity, selector, description, action, value) {
        const entry = this._locatorMemory.getTrusted(identity);
        if (!entry) {
            HealingReport.log({ original: selector, resolved: null, tier: "LocatorMemory", description, action, status: "no_candidate" });
            return false;
        }

        const facts = await this._collector.collect(this.page, {
            action,
            expectedSelectValue: action === "select" ? value : undefined,
        });

        if (!facts || facts.length === 0) {
            HealingReport.log({ original: selector, resolved: null, tier: "LocatorMemory", description, action, status: "no_candidate" });
            return false;
        }

        const liveCandidates = facts.map((f) => ({
            selector: f.selector,
            signature: ElementSignature.capture(
                {
                    tagName: f.tagName,
                    role: f.role,
                    accessibleName: f.accessibleName,
                    attributes: f.attributes,
                    structuralPath: f.structuralPath,
                    ownText: f.ownText,
                    contentEditable: f.contentEditable,
                    boundingBoxBucket: f.boundingBoxBucket,
                },
                // Shared salt (F14-1): the same LocatorMemory instance that
                // holds `entry.signature` is the only legitimate source for
                // this — a mismatched salt makes every hashed field compare
                // unequal and Tier 2.5 would silently never accept anything.
                { salt: this._locatorMemory.salt }
            ),
            state: f.state,
            contentEditable: f.contentEditable,
            selectOptionAbsent: f.selectOptionAbsent,
        }));

        const approved = typeof this._locatorMemory.getApprovedAlternatives === "function"
            ? this._locatorMemory.getApprovedAlternatives(identity) : [];
        for (const alternative of approved) {
            try {
                if (await this._matchCount(alternative.selector) !== 1) continue;
                const current = await this._collector.collectOne(this.page, alternative.selector, {
                    action, expectedSelectValue: action === "select" ? value : undefined,
                });
                if (!current) continue;
                const candidate = {
                    selector: alternative.selector,
                    signature: ElementSignature.capture({ ...current, accessibleName: current.accessibleName }, { salt: this._locatorMemory.salt }),
                    state: current.state, contentEditable: current.contentEditable,
                    selectOptionAbsent: current.selectOptionAbsent,
                };
                const checked = CandidateMatcher.evaluate({ storedSignature: alternative.signature, liveCandidates: [candidate], action });
                // Reviewed exact evidence can be sparse (for example an unnamed
                // input). Reuse still requires every live safety gate and exact
                // evidence equality; discovery continues to use the full threshold.
                const withoutTimestamp = ({ capturedAt, ...evidence }) => evidence;
                const unchanged = JSON.stringify(withoutTimestamp(alternative.signature)) === JSON.stringify(withoutTimestamp(candidate.signature));
                if (checked.status !== "accepted" && !(checked.reason === "below_threshold" && unchanged)) continue;
                await this._performAction(action, alternative.selector, value);
                HealingReport.log({ original: selector, resolved: alternative.selector, tier: "LocatorMemory", description, action, status: "approved_reuse" });
                return true;
            } catch (_) { /* A reviewed selector must still pass current live guards. */ }
        }

        const matchResult = CandidateMatcher.evaluate({ storedSignature: entry.signature, liveCandidates, action });

        if (matchResult.status !== "accepted") {
            HealingReport.log({
                original: selector,
                resolved: null,
                tier: "LocatorMemory",
                description,
                action,
                status: matchResult.status,
                reason: matchResult.reason || null,
            });
            return false;
        }

        const winnerCandidate = liveCandidates.find((c) => c.selector === matchResult.winner.selector);
        const winnerFacts = facts.find((f) => f.selector === matchResult.winner.selector);
        if (!winnerCandidate || !winnerFacts) {
            // Structurally should be unreachable — `matchResult.winner.selector`
            // always comes from one of the candidates `evaluate()` was given —
            // but an unexplained mismatch is never trusted enough to act on.
            HealingReport.log({ original: selector, resolved: null, tier: "LocatorMemory", description, action, status: "refused", reason: "winner_not_found" });
            return false;
        }

        const built = SelectorBuilder.build({
            tagName: winnerFacts.tagName,
            attributes: winnerFacts.attributes,
            role: winnerFacts.role,
            accessibleNameApprox: winnerFacts.accessibleName,
            ancestorIdentity: winnerFacts.ancestorIdentity,
            structuralChain: winnerFacts.structuralChain,
        });

        if (built.status !== "built") {
            HealingReport.log({ original: selector, resolved: null, tier: "LocatorMemory", description, action, status: "refused", reason: built.reason || "selector_build_failed" });
            return false;
        }

        const resolvedSelector = built.selector;

        // Defence in depth (EP-5 §8 step 5): re-check uniqueness against the
        // live page immediately before executing, regardless of what
        // SelectorBuilder itself could verify from pure, caller-supplied
        // facts alone — the same guard Tier 2 already applies to stored
        // alternatives.
        const count = await this._matchCount(resolvedSelector);
        if (count !== 1) {
            HealingReport.log({ original: selector, resolved: null, tier: "LocatorMemory", description, action, status: "refused", reason: "non_unique_live_selector" });
            return false;
        }

        try {
            await this._performAction(action, resolvedSelector, value);
        } catch (err) {
            Logger.warning(`⚠️ LocatorMemory candidate ${resolvedSelector} also failed: ${err.message}`);
            // Accepted-but-failed is NOT persisted as trust of any kind —
            // neither a refresh nor a proposal — and is not a hard failure;
            // it falls through to Tier 3 exactly like Tier 2 having nothing.
            HealingReport.log({ original: selector, resolved: null, tier: "LocatorMemory", description, action, status: "failed" });
            return false;
        }

        HealingReport.log({ original: selector, resolved: resolvedSelector, tier: "LocatorMemory", description, action, status: "accepted" });

        // Only a successful authored Tier 1 action creates ground-truth evidence.
        this._recordPendingCandidateSafe(identity, {
            selector: resolvedSelector,
            signature: winnerCandidate.signature,
            contributions: matchResult.winner.contributions,
            total: matchResult.winner.total,
            winner: matchResult.winner,
            runnerUp: matchResult.runnerUp,
            margin: matchResult.margin,
            alternativesConsidered: matchResult.alternativesConsidered,
            evidence: matchResult.winner.evidence,
        });

        return true;
    }

    /**
     * Read the element a Tier 1/Tier 2 interaction is about to act on, and
     * build the identity it would be scoped to, BEFORE the interaction runs
     * (EP-5 §8, AC-18). Returns `{ identity, signature }`, or `null` when
     * there is nothing to record — which includes every failure mode, since
     * no evidence is always an acceptable outcome here and a broken
     * collector must never change whether the interaction itself happens.
     *
     * This is awaited by its callers, so it is bounded by
     * PRE_CAPTURE_TIMEOUT_MS: a collector that hangs resolves to `null`
     * rather than stalling the interaction behind it.
     *
     * `identitySelector` is the selector the identity is scoped to (always
     * the ORIGINAL selector the caller asked to heal — the one that might
     * break again later and trigger a Tier 2.5 lookup for this exact
     * identity); `liveSelector` is whichever selector resolves the element
     * right now (the same selector for a Tier 1 success, or the stored
     * alternative for a Tier 2 success).
     */
    async _preCaptureEvidence(action, identitySelector, liveSelector) {
        try {
            if (!this._locatorMemory) return null;
            // Built from the PRE-interaction URL. After a navigating click
            // this is the only moment the correct page is still current.
            const identityResult = LocatorIdentity.buildIdentity({
                url: typeof this.page.url === "function" ? this.page.url() : undefined,
                action,
                originalSelector: identitySelector,
            });
            if (identityResult.status !== "built") return null;

            const facts = await this._withTimeout(
                this._collector.collectOne(this.page, liveSelector),
                PRE_CAPTURE_TIMEOUT_MS
            );
            if (!facts) return null;

            const signature = ElementSignature.capture(
                {
                    tagName: facts.tagName,
                    role: facts.role,
                    accessibleName: facts.accessibleName,
                    attributes: facts.attributes,
                    structuralPath: facts.structuralPath,
                    ownText: facts.ownText,
                    contentEditable: facts.contentEditable,
                    boundingBoxBucket: facts.boundingBoxBucket,
                },
                { salt: this._locatorMemory.salt }
            );

            return { identity: identityResult.identity, signature };
        } catch (err) {
            Logger.warning(`AIHealer: best-effort evidence capture skipped (${err.message}).`);
            return null;
        }
    }

    /**
     * Persist evidence read before a now-successful interaction. Called
     * without `await` on purpose: the interaction has already happened, and
     * its timing, retry semantics and return value must never depend on how
     * long (or whether) the write succeeds. Never rejects.
     */
    async _persistCapturedEvidence(captured) {
        try {
            if (!captured || !this._locatorMemory) return;
            this._locatorMemory.recordEvidence(captured.identity, captured.signature);
        } catch (err) {
            Logger.warning(`AIHealer: evidence persistence skipped (${err.message}).`);
        }
    }

    /**
     * Record a pending candidate after an interaction that already
     * succeeded. The call is synchronous and can throw (a decision in
     * progress, an invalid identity or candidate); that must never turn a
     * completed action into a failed heal, so it is logged and swallowed.
     * Not awaited: there is nothing to wait for.
     */
    _recordPendingCandidateSafe(identity, candidate) {
        if (!this._locatorMemory) return;
        try {
            this._locatorMemory.recordPendingCandidate(identity, candidate);
        } catch (err) {
            Logger.warning(`AIHealer: pending candidate not recorded (${err.message}).`);
        }
    }

    /**
     * Resolve `promise`, or `null` once `ms` has elapsed. The underlying work
     * is abandoned, never cancelled — it cannot be, and it holds nothing the
     * caller needs. The timer is unref'd so a pending pre-capture never keeps
     * the process alive on its own.
     */
    async _withTimeout(promise, ms) {
        let timer = null;
        try {
            return await Promise.race([
                Promise.resolve(promise).catch(() => null),
                new Promise((resolve) => {
                    timer = setTimeout(() => resolve(null), ms);
                    if (typeof timer.unref === "function") timer.unref();
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /**
     * How many elements a selector currently resolves to. Falls back to
     * "assume unique" when the page double doesn't implement page.locator()
     * (e.g. lightweight mocks in unit tests) rather than throwing.
     */
    async _matchCount(selector) {
        if (typeof this.page.locator !== "function") return 1;
        return this.page.locator(selector).count();
    }

    /**
     * Tier 3 core: captures a DOM snapshot and asks the LLM to infer a valid
     * CSS selector that targets the same element as the broken one.
     *
     * Uses gpt-4o-mini for low latency and cost. Temperature 0 ensures
     * deterministic, selector-only output — no prose, no markdown fences.
     *
     * @param {string} originalSelector - The selector that no longer matches
     * @returns {string|null} A new CSS selector, or null on failure
     */
    async getAlternativeSelector(originalSelector) {
        try {
            const openai = await this._getOpenAIClient();

            // Capture a focused DOM snapshot: interactive elements only, truncated
            // to stay well inside the model's context window.
            const domSnapshot = await this.page.evaluate(() => {
                const tags = ["input", "button", "a", "select", "textarea", "label", "[data-testid]", "[aria-label]"];
                const nodes = document.querySelectorAll(tags.join(","));
                const lines = [];
                nodes.forEach((el) => {
                    // Never send entered credential values (passwords) to the LLM.
                    const isPassword = (el.getAttribute("type") || "").toLowerCase() === "password";
                    const attrs = Array.from(el.attributes)
                        .filter((a) => !(isPassword && a.name === "value"))
                        .map((a) => `${a.name}="${a.value}"`)
                        .join(" ");
                    lines.push(`<${el.tagName.toLowerCase()} ${attrs}>`);
                });
                return lines.join("\n").substring(0, 6000);
            });

            const prompt = [
                `A Playwright test is failing because the CSS selector "${originalSelector}" no longer matches any element.`,
                ``,
                `Below is a snapshot of interactive elements currently in the DOM:`,
                `\`\`\``,
                domSnapshot,
                `\`\`\``,
                ``,
                `Your task: return ONE valid CSS selector that most likely targets the same element the broken selector was intended for.`,
                `Rules:`,
                `- Output ONLY the raw CSS selector string. No explanation. No markdown. No quotes around it.`,
                `- Prefer: data-testid, id, aria-label, name, type attributes — in that priority order.`,
                `- The selector must be valid CSS (no innerText, no :contains, no XPath).`,
                `- If you cannot determine a confident match, output: null`,
            ].join("\n");

            // Boundary for "Tier 3 invocation": the client initialised and
            // the DOM snapshot/prompt were built successfully, so a model
            // request is genuinely about to be issued. Counted here — and
            // only here — regardless of what happens next: the request can
            // still throw, return null, resolve ambiguously, or the healed
            // action can later fail; all of those still count, because the
            // model was actually asked.
            HealingTrust.recordTier3Invocation(originalSelector);
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 80,
                temperature: 0,
            });

            const suggested = response.choices[0]?.message?.content?.trim();
            if (!suggested || suggested.toLowerCase() === "null") return null;

            Logger.info(`🤖 LLM inference complete. Selector: ${suggested}`);
            return suggested;
        } catch (err) {
            Logger.error(`🔥 OpenAI API call failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Lazy-initialise the OpenAI client once per AIHealer instance.
     * Throws a clear, actionable error if OPENAI_API_KEY is not set.
     */
    async _getOpenAIClient() {
        if (this._openai) return this._openai;

        if (!process.env.OPENAI_API_KEY) {
            throw new Error(
                "OPENAI_API_KEY environment variable is not set. " +
                "Add it to your .env file or CI secrets to enable Tier 3 AI healing."
            );
        }

        const { default: OpenAI } = await import("openai");
        this._openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        return this._openai;
    }
}

module.exports = AIHealer;
