/**
 * tests/regression/m17-byok-docs.check.cjs — M17-BYOK-AC20 / M17-BYOK-AC25
 * static documentation checks for docs/maintenance-byok-operations.md,
 * README.md, and .env.example.
 *
 * Scope: these are pure text/static checks against the shipped docs and
 * config template — no network, no provider SDKs, no process spawn beyond
 * reading package.json / the filesystem.
 *
 * Run: node --test --test-concurrency=1 tests/regression/m17-byok-docs.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BYOK_DOC_PATH = path.join(REPO_ROOT, "docs", "maintenance-byok-operations.md");
const README_PATH = path.join(REPO_ROOT, "README.md");
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, ".env.example");
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");

const byokDoc = fs.readFileSync(BYOK_DOC_PATH, "utf8");
const readme = fs.readFileSync(README_PATH, "utf8");
const envExample = fs.readFileSync(ENV_EXAMPLE_PATH, "utf8");
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));

const PROVIDERS = ["openai", "anthropic", "gemini", "azure-openai", "openai-compatible"];

// Key-shaped-string heuristics: a real-looking secret, not a placeholder.
// Matches common provider key prefixes and long opaque single-token strings.
const KEY_SHAPE_PATTERNS = [
    /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI-style
    /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic-style
    /AIza[A-Za-z0-9_-]{20,}/g, // Gemini/Google-style
    /ghp_[A-Za-z0-9]{20,}/g, // GitHub token-style
    /xox[abp]-[A-Za-z0-9-]{20,}/g, // Slack token-style
    /AKIA[A-Z0-9]{12,}/g, // AWS access key-style
    // Generic opaque token heuristic: a standalone, *unbroken* alphanumeric
    // run of 32+ chars (no hyphens/underscores) that mixes letters and
    // digits — the shape of a raw base64/hex secret. Hyphenated or
    // underscored slugs (npm script names, doc anchors, lowercase-word
    // identifiers like "axonradar-04-full-sweep-totals") never match
    // because the run breaks at each "-"/"_".
    /\b(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}\b/g,
];

function assertNoKeyShapedStrings(content, label) {
    for (const pattern of KEY_SHAPE_PATTERNS) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const found = match[0];
            assert.fail(`${label} contains a key-shaped string: "${found}"`);
        }
    }
}

test("AC25: docs/maintenance-byok-operations.md documents all five providers with a placeholder-only example each", () => {
    for (const provider of PROVIDERS) {
        assert.match(
            byokDoc,
            new RegExp(`--llm-provider=${provider.replace("-", "\\-")}`),
            `expected a --llm-provider=${provider} example in the BYOK doc`,
        );
    }
    // Every provider example uses a placeholder key, never a literal value.
    assert.match(byokDoc, /<your-key>/, "expected <your-key> placeholder usage");
    assert.doesNotMatch(byokDoc, /export\s+\w*API_KEY=[^\s<][^\s]*/, "no API key example may assign a non-placeholder literal value");
});

test("AC25: README.md references BYOK provider configuration without real-looking keys", () => {
    assertNoKeyShapedStrings(readme, "README.md");
});

test("AC25/AC20: no key-shaped (real-looking) strings anywhere in the BYOK doc or .env.example", () => {
    assertNoKeyShapedStrings(byokDoc, "docs/maintenance-byok-operations.md");
    assertNoKeyShapedStrings(envExample, ".env.example");
});

test("AC20: docs state there is no model discovery, no allowlist, and no certification claim", () => {
    assert.match(byokDoc, /model discovery is not implemented/i, "expected an explicit no-model-discovery statement");
    assert.match(byokDoc, /type model ids? manually/i, "expected an explicit manual model-id statement");
    assert.match(byokDoc, /no allowlist/i, "expected an explicit no-allowlist statement");
    assert.match(byokDoc, /no certification claim/i, "expected an explicit no-certification-claim statement");
});

test("AC20: .env.example optional BYOK entries are genuinely blank, not fake placeholders", () => {
    const optionalKeys = [
        "FALCON_LLM_PROVIDER",
        "FALCON_LLM_API_KEY",
        "FALCON_LLM_MODEL",
        "FALCON_LLM_AZURE_RESOURCE",
        "FALCON_LLM_AZURE_HOST_SUFFIX",
        "FALCON_LLM_AZURE_DEPLOYMENT",
        "FALCON_LLM_ENDPOINT",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "FALCON_LLM_PROFILE_DIR",
    ];
    for (const key of optionalKeys) {
        const re = new RegExp(`^${key}=(.*)$`, "m");
        const match = envExample.match(re);
        assert.ok(match, `expected ${key}= to appear in .env.example`);
        assert.equal(match[1].trim(), "", `${key} must be genuinely blank in .env.example, got "${match[1]}"`);
    }
});

test("every `node ...` command referenced in the BYOK doc points at a real file", () => {
    const nodeCommandPattern = /node\s+((?:\.\/)?[\w./-]+\.js)/g;
    const seen = new Set();
    let match;
    while ((match = nodeCommandPattern.exec(byokDoc)) !== null) {
        seen.add(match[1]);
    }
    assert.ok(seen.size > 0, "expected at least one `node ...` command in the BYOK doc");
    for (const relPath of seen) {
        const resolved = path.join(REPO_ROOT, relPath);
        assert.ok(fs.existsSync(resolved), `referenced file does not exist: ${relPath}`);
    }
});

test("every `npm run ...` script referenced in the BYOK doc exists in package.json", () => {
    const npmRunPattern = /npm run ([\w:-]+)/g;
    const seen = new Set();
    let match;
    while ((match = npmRunPattern.exec(byokDoc)) !== null) {
        seen.add(match[1]);
    }
    assert.ok(seen.size > 0, "expected at least one `npm run ...` reference in the BYOK doc");
    for (const scriptName of seen) {
        assert.ok(
            Object.hasOwn(packageJson.scripts || {}, scriptName),
            `referenced npm script does not exist in package.json: ${scriptName}`,
        );
    }
});

test("every `npm run ...` script referenced in README.md exists in package.json", () => {
    const npmRunPattern = /npm run ([\w:-]+)/g;
    const seen = new Set();
    let match;
    while ((match = npmRunPattern.exec(readme)) !== null) {
        seen.add(match[1]);
    }
    for (const scriptName of seen) {
        assert.ok(
            Object.hasOwn(packageJson.scripts || {}, scriptName),
            `referenced npm script does not exist in package.json: ${scriptName}`,
        );
    }
});

test("no --llm-provider example in the BYOK doc contradicts the CONFIG_CONFLICT rule", () => {
    // The only example that intentionally shows two different providers next
    // to each other must be explicitly labeled as refused/conflicting, never
    // presented as something that silently succeeds.
    const conflictSection = byokDoc.slice(
        byokDoc.indexOf("### New: Per-Invocation Flags"),
        byokDoc.indexOf("### Rollback"),
    );
    assert.ok(conflictSection.length > 0, "expected the Per-Invocation Flags section to exist");
    assert.match(conflictSection, /CONFIG_CONFLICT/, "expected the conflicting-provider example to mention CONFIG_CONFLICT");
    assert.match(conflictSection, /refused/i, "expected the conflicting-provider example to state it is refused");
});

test("the invocation provider context propagation statement covers whole-app, --single-page, and in-process parallel/sharded runs", () => {
    const section = byokDoc.slice(byokDoc.indexOf("## Where the Invocation Provider Context Applies"));
    assert.ok(section.length > 0, "expected a provider-context propagation section");
    assert.match(section, /whole-app/i);
    assert.match(section, /--single-page/);
    assert.match(section, /parallel/i);
    assert.match(section, /SiteSweep/);
    assert.match(section, /ParallelSweep/);
    assert.match(section, /CONFIG_CONFLICT/);
    assert.match(section, /per field/i);
});

test("profile and config error details are described as fixed, value-free strings", () => {
    assert.match(byokDoc, /[Ff]ixed,? (?:non-secret,? )?value-free/, "expected an explicit fixed/value-free error-detail statement");
});

test("docs contain no AI attribution text", () => {
    const aiAttributionPatterns = [/generated with claude/i, /co-authored-by:\s*claude/i, /written by claude/i, /claude code/i];
    for (const doc of [byokDoc, readme]) {
        for (const pattern of aiAttributionPatterns) {
            assert.doesNotMatch(doc, pattern, `found AI attribution text matching ${pattern} in a doc`);
        }
    }
});
