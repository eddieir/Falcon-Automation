const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const Logger = require("../../utils/Logger");

// pixelmatch ships ESM-only. A plain require() throws ERR_REQUIRE_ESM on
// Node <20.19 (it only happens to work on newer Node via unflagged
// require(esm)), so load it lazily via dynamic import instead.
let _pixelmatch = null;
async function getPixelmatch() {
    if (!_pixelmatch) {
        _pixelmatch = (await import("pixelmatch")).default;
    }
    return _pixelmatch;
}

/**
 * VisualRegression — pixel-level screenshot comparison engine.
 *
 * Phase 3 feature: adds baseline-capture and diff-comparison capabilities
 * to every test that extends BaseTest.  This lets the suite detect
 * unintentional visual regressions (layout shifts, colour changes, missing
 * elements) without writing explicit locator assertions for every pixel.
 *
 * Directory layout inside reports/:
 *   reports/baselines/<name>.png   — golden reference (updated by captureBaseline)
 *   reports/screenshots/<name>.png — most recent actual screenshot
 *   reports/diffs/<name>-diff.png  — pixel diff image (red = changed pixels)
 *   reports/visual-regression.json — cumulative run summary
 *
 * Usage in a test:
 *   const vr = new VisualRegression(page);
 *   await vr.captureBaseline("login-page");    // first run
 *   await vr.compare("login-page");             // subsequent runs
 */
class VisualRegression {
    /**
     * @param {import('playwright').Page} page
     * @param {Object} opts
     * @param {number} [opts.threshold=0.1]     - Per-pixel colour tolerance (0–1)
     * @param {number} [opts.diffThreshold=0.5] - Max allowed % of changed pixels
     *                                            before the comparison is marked failed
     */
    constructor(page, { threshold = 0.1, diffThreshold = 0.5 } = {}) {
        this.page           = page;
        this.threshold      = threshold;
        this.diffThreshold  = diffThreshold;

        const root = process.cwd();
        this.baselineDir    = path.join(root, "reports", "baselines");
        this.screenshotDir  = path.join(root, "reports", "screenshots");
        this.diffDir        = path.join(root, "reports", "diffs");
        this.summaryPath    = path.join(root, "reports", "visual-regression.json");

        this._ensureDirs();
    }

    _ensureDirs() {
        for (const dir of [this.baselineDir, this.screenshotDir, this.diffDir]) {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Capture a baseline screenshot for a named checkpoint.
     * Call this on the first run (or to deliberately update the golden reference).
     *
     * @param {string} name - Unique checkpoint name, e.g. "login-page"
     * @returns {string} Absolute path to the saved baseline image.
     */
    async captureBaseline(name) {
        const filePath = path.join(this.baselineDir, `${name}.png`);
        await this.page.screenshot({ path: filePath, fullPage: true });
        Logger.info(`📸 [VisualRegression] Baseline saved: ${filePath}`);
        return filePath;
    }

    /**
     * Compare the current page against a stored baseline.
     *
     * @param {string} name - Must match a baseline captured with captureBaseline().
     * @returns {{
     *   name: string,
     *   status: "passed"|"failed"|"no-baseline",
     *   diffPixels: number,
     *   totalPixels: number,
     *   diffPercent: number,
     *   diffPath: string|null
     * }}
     */
    async compare(name) {
        const baselinePath   = path.join(this.baselineDir,   `${name}.png`);
        const screenshotPath = path.join(this.screenshotDir, `${name}.png`);
        const diffPath       = path.join(this.diffDir,       `${name}-diff.png`);

        if (!fs.existsSync(baselinePath)) {
            Logger.warning(`⚠️  [VisualRegression] No baseline for "${name}" — run captureBaseline() first.`);
            const result = { name, status: "no-baseline", diffPixels: 0, totalPixels: 0, diffPercent: 0, diffPath: null };
            this._appendToSummary(result);
            return result;
        }

        // Take the actual screenshot
        await this.page.screenshot({ path: screenshotPath, fullPage: true });

        // Decode both PNGs
        const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
        const actual   = PNG.sync.read(fs.readFileSync(screenshotPath));

        const { width, height } = baseline;

        // Handle dimension mismatch gracefully
        if (actual.width !== width || actual.height !== height) {
            Logger.warning(
                `⚠️  [VisualRegression] Dimension mismatch for "${name}": ` +
                `baseline ${width}×${height} vs actual ${actual.width}×${actual.height}.`
            );
            const result = {
                name,
                status: "failed",
                diffPixels: -1,
                totalPixels: width * height,
                diffPercent: 100,
                diffPath: null,
                reason: "dimension-mismatch",
            };
            this._appendToSummary(result);
            return result;
        }

        const totalPixels = width * height;
        const diff = new PNG({ width, height });

        const pixelmatch = await getPixelmatch();
        const diffPixels = pixelmatch(
            baseline.data,
            actual.data,
            diff.data,
            width,
            height,
            { threshold: this.threshold }
        );

        // Save the diff image regardless of pass/fail for inspection
        fs.writeFileSync(diffPath, PNG.sync.write(diff));

        const diffPercent = (diffPixels / totalPixels) * 100;
        const status = diffPercent <= this.diffThreshold ? "passed" : "failed";

        const result = {
            name,
            status,
            diffPixels,
            totalPixels,
            diffPercent: parseFloat(diffPercent.toFixed(4)),
            diffPath,
        };

        if (status === "passed") {
            Logger.info(`✅ [VisualRegression] "${name}" passed — ${diffPixels} px changed (${diffPercent.toFixed(2)}%)`);
        } else {
            Logger.error(
                `❌ [VisualRegression] "${name}" FAILED — ${diffPixels} px changed ` +
                `(${diffPercent.toFixed(2)}% > threshold ${this.diffThreshold}%). ` +
                `Diff: ${diffPath}`
            );
        }

        this._appendToSummary(result);
        return result;
    }

    /**
     * Append a comparison result to the cumulative JSON summary.
     *
     * Serialised through a shared, class-level promise queue: two
     * compare()/captureBaseline() calls racing on the same summary file
     * would otherwise each read the same pre-write array and clobber each
     * other's entry on write.
     * @private
     */
    _appendToSummary(result) {
        VisualRegression._writeQueue = VisualRegression._writeQueue.then(async () => {
            let summary = [];
            try {
                if (fs.existsSync(this.summaryPath)) {
                    summary = JSON.parse(await fs.promises.readFile(this.summaryPath, "utf8"));
                }
            } catch { /* ignore corrupt file */ }

            summary.push({ ...result, timestamp: new Date().toISOString() });
            await fs.promises.writeFile(this.summaryPath, JSON.stringify(summary, null, 2), "utf8");
        }).catch(() => {}); // never let a summary-write failure crash the caller
        return VisualRegression._writeQueue;
    }

    /**
     * Capture a baseline on first run, or compare against it on every
     * subsequent run. Centralises the "does a baseline exist yet" policy
     * that call sites previously duplicated with their own fs.existsSync
     * checks and manual path-joining.
     *
     * @param {string} name
     * @returns {Promise<{status: string, [key: string]: any}>}
     */
    async snapshot(name) {
        const baselinePath = path.join(this.baselineDir, `${name}.png`);
        if (!fs.existsSync(baselinePath)) {
            await this.captureBaseline(name);
            return { name, status: "baseline-captured" };
        }
        return this.compare(name);
    }
}

VisualRegression._writeQueue = Promise.resolve();

module.exports = VisualRegression;
