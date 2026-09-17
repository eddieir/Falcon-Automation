const Logger = require("../../utils/Logger");

/**
 * ClickExplorer — recursive web crawler for autonomous UI exploration.
 *
 * Discovers and clicks interactive elements depth-first, recording visited
 * URLs to prevent cycles.  Designed to work alongside ExploratoryAI: the
 * crawler surfaces pages; ExploratoryAI analyses each one for defects.
 *
 * Key fix (Phase 1):
 *   The previous implementation built selectors using `[innerText="…"]`,
 *   which is NOT a valid CSS attribute selector — innerText is a DOM property,
 *   not an HTML attribute.  This caused every `waitForSelector()` call to fail
 *   silently or throw, making the crawler unable to click anything on real pages.
 *
 *   Selectors are now built from actual HTML attributes in priority order:
 *     data-testid  →  id  →  aria-label  →  name  →  text-based Playwright locator
 *   This matches Playwright best-practice locator guidance and produces selectors
 *   that survive minor DOM restructuring.
 */
class ClickExplorer {
    constructor(page) {
        this.page = page;
        this.visitedPages = new Set();
        this.maxDepth = 2;
        this.exploredElements = []; // audit log for reporting
    }

    async explore(depth = 0) {
        if (depth > this.maxDepth) {
            Logger.info("🛑 Reached max exploration depth, stopping navigation.");
            return;
        }

        const currentUrl = await this.page.url();
        if (this.visitedPages.has(currentUrl)) {
            Logger.info(`🔄 Skipping already visited page: ${currentUrl}`);
            return;
        }

        Logger.info(`🌍 Exploring page: ${currentUrl}`);
        this.visitedPages.add(currentUrl);

        // Build a list of clickable elements with valid, attribute-based selectors
        const clickableElements = await this.page.evaluate(() => {
            /**
             * Derive the most stable CSS selector from an element's attributes.
             * Priority: data-testid > id > aria-label > name > (fallback = null)
             * The caller handles the null case with a text-based Playwright locator.
             */
            function buildSelector(el) {
                const tag = el.tagName.toLowerCase();

                const testId = el.getAttribute("data-testid");
                if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

                if (el.id) return `#${CSS.escape(el.id)}`;

                const ariaLabel = el.getAttribute("aria-label");
                if (ariaLabel) return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;

                const name = el.getAttribute("name");
                if (name) return `${tag}[name="${CSS.escape(name)}"]`;

                const type = el.getAttribute("type");
                if (type) return `${tag}[type="${CSS.escape(type)}"]`;

                // Return null — caller will fall back to getByText()
                return null;
            }

            return [...document.querySelectorAll("a, button")].map((el) => ({
                selector: buildSelector(el),
                text: (el.innerText || el.textContent || "").trim().substring(0, 100),
                href: el.getAttribute("href") || null,
                newTab: el.getAttribute("target") === "_blank",
            }));
        });

        // Process a bounded slice to avoid unbounded execution time
        const candidates = clickableElements.filter((el) => el.text).slice(0, 5);

        for (const element of candidates) {
            try {
                Logger.info(`🖱 Exploring: "${element.text}"`);

                let clicked = false;

                if (element.selector) {
                    // Attribute-based selector — preferred path
                    try {
                        await this.page.waitForSelector(element.selector, {
                            state: "visible",
                            timeout: 4000,
                        });
                        await this.page.click(element.selector);
                        clicked = true;
                    } catch {
                        Logger.warning(
                            `⚠️ Attribute selector failed for "${element.text}", falling back to text locator.`
                        );
                    }
                }

                if (!clicked && element.text) {
                    // Text-based fallback — getByText is tolerant of DOM changes
                    try {
                        await this.page.getByText(element.text, { exact: true }).first().click({ timeout: 4000 });
                        clicked = true;
                    } catch {
                        Logger.warning(`⚠️ Text locator also failed for "${element.text}".`);
                    }
                }

                if (!clicked) continue;

                this.exploredElements.push({
                    url: currentUrl,
                    element: element.text,
                    selector: element.selector,
                    depth,
                    timestamp: new Date().toISOString(),
                });

                if (element.newTab) {
                    Logger.info("🔄 Detected new tab — staying on current page.");
                    // Do not follow new tabs: stay in the same browser context
                    continue;
                }

                await this.page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
                await this.explore(depth + 1);
                if (this.page.url() !== currentUrl) {
                    await this.page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
                }
            } catch (error) {
                Logger.warning(`⚠️ Failed to explore "${element.text}": ${error.message}`);
            }
        }
    }

    /** Returns the audit log of every element visited during this run. */
    getExplorationLog() {
        return {
            visitedPages: Array.from(this.visitedPages),
            exploredElements: this.exploredElements,
        };
    }
}

module.exports = ClickExplorer;
