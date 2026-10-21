#!/usr/bin/env node
"use strict";

/**
 * Fail-closed check that the Playwright packages and the Chromium build that
 * CI installs are exactly the pinned ones.
 *
 * What it verifies, against the reference file expected-browser.json:
 *   1. package.json declares `playwright` and `@playwright/test` as the exact
 *      expected version (no range operator).
 *   2. The installed `playwright`, `playwright-core` and `@playwright/test`
 *      packages report that version.
 *   3. The installed `playwright-core` browsers.json lists Chromium (and the
 *      headless shell) at the expected revision and browser version.
 *   4. Chromium actually launches from a directory carrying the expected
 *      revision, and the running browser reports the expected version.
 *
 * What it does not do: it is not a hash or provenance check of the browser
 * binary, and it does not prove the build is genuine; it detects a different
 * revision or version from the one recorded in the reference file.
 *
 * Usage: node scripts/playwright/verify-pin.js [--expected=<file>] [--root=<dir>] [--no-launch]
 *   --expected  alternative reference file (used by the regression test to
 *               prove that wrong values fail); defaults to the file beside
 *               this script. CI passes no arguments.
 *   --root      repository root holding package.json and node_modules.
 *   --no-launch skip step 4 (used only by the regression test).
 *
 * Exit codes: 0 verified; 1 any mismatch, unreadable input or launch failure;
 * 2 usage error. Output goes to stdout (one result line per check) and a
 * mismatch to stderr.
 */

const fs = require("fs");
const path = require("path");

const EXACT = /^\d+\.\d+\.\d+$/;

function parseArgs(argv) {
    const opts = { expected: path.join(__dirname, "expected-browser.json"), root: path.join(__dirname, "..", ".."), launch: true };
    for (const arg of argv) {
        if (arg.startsWith("--expected=")) opts.expected = path.resolve(arg.slice("--expected=".length));
        else if (arg.startsWith("--root=")) opts.root = path.resolve(arg.slice("--root=".length));
        else if (arg === "--no-launch") opts.launch = false;
        else return null;
    }
    return opts;
}

function readJson(file, label) {
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (error) {
        throw new Error(`${label}: cannot read ${file} (${error.code || error.message})`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${label}: ${file} is not valid JSON`);
    }
}

function loadExpected(file) {
    const ref = readJson(file, "reference");
    const ok =
        ref && typeof ref === "object" &&
        typeof ref.playwright === "string" && EXACT.test(ref.playwright) &&
        ref.chromium && typeof ref.chromium === "object" &&
        typeof ref.chromium.revision === "string" && /^\d+$/.test(ref.chromium.revision) &&
        typeof ref.chromium.browserVersion === "string" && /^\d+(\.\d+){3}$/.test(ref.chromium.browserVersion);
    if (!ok) throw new Error(`reference: ${file} does not have the expected shape`);
    return ref;
}

function installedDir(root, name) {
    return path.join(root, "node_modules", ...name.split("/"));
}

function checkDeclared(root, expected, failures, report) {
    const pkg = readJson(path.join(root, "package.json"), "package.json");
    for (const name of ["playwright", "@playwright/test"]) {
        const declared = (pkg.dependencies && pkg.dependencies[name]) || (pkg.devDependencies && pkg.devDependencies[name]);
        if (declared !== expected.playwright) {
            failures.push(`package.json declares ${name} as ${JSON.stringify(declared)}, expected exactly ${expected.playwright}`);
        } else {
            report.push(`declared ${name}@${declared}`);
        }
    }
}

function checkInstalled(root, expected, failures, report) {
    for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
        const version = readJson(path.join(installedDir(root, name), "package.json"), `installed ${name}`).version;
        if (version !== expected.playwright) {
            failures.push(`installed ${name} is ${version}, expected ${expected.playwright}`);
        } else {
            report.push(`installed ${name}@${version}`);
        }
    }
}

function checkMetadata(root, expected, failures, report) {
    const meta = readJson(path.join(installedDir(root, "playwright-core"), "browsers.json"), "browsers.json");
    const list = Array.isArray(meta.browsers) ? meta.browsers : [];
    for (const name of ["chromium", "chromium-headless-shell"]) {
        const entry = list.find((b) => b && b.name === name);
        if (!entry) {
            failures.push(`browsers.json has no ${name} entry`);
        } else if (String(entry.revision) !== expected.chromium.revision || entry.browserVersion !== expected.chromium.browserVersion) {
            failures.push(`browsers.json ${name} is revision ${entry.revision} / ${entry.browserVersion}, expected ${expected.chromium.revision} / ${expected.chromium.browserVersion}`);
        } else {
            report.push(`metadata ${name} revision ${entry.revision} version ${entry.browserVersion}`);
        }
    }
}

async function checkLaunched(root, expected, failures, report) {
    let browser;
    try {
        const { chromium } = require(path.join(installedDir(root, "playwright"), "index.js"));
        const executable = chromium.executablePath();
        const match = /chromium(?:[-_]headless[-_]shell)?-(\d+)/.exec(executable);
        if (!match || match[1] !== expected.chromium.revision) {
            failures.push(`launch path revision is ${match ? match[1] : "not found"}, expected ${expected.chromium.revision}`);
        } else {
            report.push(`launch path revision ${match[1]}`);
        }
        browser = await chromium.launch({ headless: true });
        const version = browser.version();
        if (version !== expected.chromium.browserVersion) {
            failures.push(`launched browser reports ${version}, expected ${expected.chromium.browserVersion}`);
        } else {
            report.push(`launched browser version ${version}`);
        }
    } catch (error) {
        failures.push(`launch failed: ${String(error.message).split("\n")[0]}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

async function main(argv) {
    const opts = parseArgs(argv);
    if (!opts) {
        process.stderr.write("usage: verify-pin.js [--expected=<file>] [--root=<dir>] [--no-launch]\n");
        return 2;
    }
    const failures = [];
    const report = [];
    try {
        const expected = loadExpected(opts.expected);
        checkDeclared(opts.root, expected, failures, report);
        checkInstalled(opts.root, expected, failures, report);
        checkMetadata(opts.root, expected, failures, report);
        if (opts.launch) await checkLaunched(opts.root, expected, failures, report);
    } catch (error) {
        failures.push(error.message);
    }
    for (const line of report) process.stdout.write(`ok: ${line}\n`);
    if (failures.length > 0) {
        for (const line of failures) process.stderr.write(`FAIL: ${line}\n`);
        process.stderr.write("playwright pin verification failed\n");
        return 1;
    }
    process.stdout.write("playwright pin verified\n");
    return 0;
}

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}

module.exports = { main, loadExpected };
