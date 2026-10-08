"use strict";
// Static checks of the CI and security workflows (text based, no YAML parser).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "..", "..", ".github", "workflows");
const load = (n) => fs.readFileSync(path.join(dir, n), "utf8");
const files = { "ci.yml": load("ci.yml"), "security.yml": load("security.yml") };

// Split the jobs: block into { name: text } by two-space-indented keys.
function jobs(text) {
    const start = text.indexOf("\njobs:\n");
    assert.ok(start >= 0, "jobs: block missing");
    const out = {};
    let cur = null;
    for (const line of text.slice(start + 6).split("\n")) {
        const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
        if (m) { cur = m[1]; out[cur] = ""; } else if (cur) out[cur] += line + "\n";
    }
    return out;
}
const stripComments = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

for (const [name, text] of Object.entries(files)) {
    test(`${name}: every uses: is a 40-hex SHA`, () => {
        const uses = [...stripComments(text).matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);
        assert.ok(uses.length > 0);
        for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `unpinned action: ${u}`);
    });
    test(`${name}: top-level permissions are contents: read`, () => {
        assert.match(text, /^permissions:\n  contents: read\n/m);
    });
    test(`${name}: no pull_request_target`, () => {
        assert.ok(!/pull_request_target/.test(stripComments(text)));
    });
    test(`${name}: every job has timeout-minutes`, () => {
        for (const [j, body] of Object.entries(jobs(text))) assert.match(body, /^ {4}timeout-minutes:\s*\d+/m, `job ${j}`);
    });
    test(`${name}: SNYK_TOKEN only in env, never in a command or echo`, () => {
        const lines = stripComments(text).split("\n");
        for (const l of lines) {
            if (!/SNYK_TOKEN/.test(l)) continue;
            if (/^\s+if \[ -z "\$SNYK_TOKEN" \]; then\s*$/.test(l)) continue; // emptiness test only, prints nothing
            assert.match(l, /^\s+SNYK_TOKEN:\s*\$\{\{ secrets\.SNYK_TOKEN \}\}\s*$/, `SNYK_TOKEN outside env: ${l}`);
        }
    });
    test(`${name}: no latest and no untrusted context in run`, () => {
        assert.ok(!/@latest|:latest\b/.test(stripComments(text)));
        const body = stripComments(text);
        assert.ok(!/github\.(head_ref|event\.pull_request\.title|event\.pull_request\.head\.ref|event\.issue\.title)/.test(body));
    });
}

test("security.yml: no continue-on-error, exact snyk pin, container digest", () => {
    const s = stripComments(files["security.yml"]);
    assert.ok(!/continue-on-error/.test(s));
    assert.match(s, /npm install --global snyk@\d+\.\d+\.\d+\s*$/m);
    assert.match(s, /snyk container test postgres@sha256:[0-9a-f]{64}/);
    assert.match(s, /Snyk awaiting trusted execution/);
    assert.match(s, /head\.repo\.full_name == github\.repository/);
});

test("ci.yml: postgres image is digest pinned", () => {
    assert.match(stripComments(files["ci.yml"]), /image:\s*postgres:\S+@sha256:[0-9a-f]{64}/);
});

test("ci.yml: shard matrix artifacts are unique and include the shard index", () => {
    const j = jobs(files["ci.yml"]);
    assert.match(j.shards, /shard:\s*\[1, 2, 3\]/);
    assert.match(j.shards, /fail-fast:\s*false/);
    assert.match(j.shards, /name:\s*falcon-shard-\$\{\{ matrix\.shard \}\}-of-3-\$\{\{ github\.run_attempt \}\}/);
    assert.match(j.shards, /retention-days:\s*7/);
    assert.ok(!/secrets\./.test(j.shards), "shards must not see secrets");
    const names = [...files["ci.yml"].matchAll(/^\s+name:\s*(falcon-\S+|regression-reports|run-history)\s*$/gm)].map((m) => m[1]);
    assert.strictEqual(new Set(names).size, names.length, "duplicate artifact names");
});

test("ci.yml: aggregate needs shards, runs always, exit code is the merge's", () => {
    const a = jobs(files["ci.yml"]).aggregate;
    assert.match(a, /^ {4}needs: shards$/m);
    assert.match(a, /^ {4}if: always\(\)$/m);
    assert.match(a, /falcon\.js merge --input=shards-in --expect-total=3/);
    assert.match(a, /pattern:\s*falcon-shard-\*-of-3-\$\{\{ github\.run_attempt \}\}/);
    assert.match(a, /EXPECT_RUN_ID: gh-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.match(a, /EXPECT_COMMIT: \$\{\{ github\.sha \}\}/);
    assert.match(a, /--expect-run-id="\$EXPECT_RUN_ID" --expect-commit="\$EXPECT_COMMIT"/);
    const run = a.slice(a.indexOf("falcon.js merge"), a.indexOf("falcon.js merge") + 200);
    assert.ok(!/\$\{\{/.test(run), "no inline expression in the merge command");
    // continue-on-error only on the cache save step, which runs on always()
    assert.strictEqual((stripComments(a).match(/continue-on-error/g) || []).length, 1);
    const save = a.slice(a.indexOf("- name: Save Falcon state"));
    assert.match(save.split("- uses:")[0], /if: always\(\) && steps\.state-files\.outputs\.found == 'true'[^\n]*refs\/heads\/main/);
    assert.match(save.split("- uses:")[0], /continue-on-error: true/);
    assert.ok(!/merge\.outcome/.test(a));
    assert.ok(!/locator_memory/.test(stripComments(a)));
});

test("ci.yml: OPENAI_API_KEY is not job-level; negative shard check expects exit 2", () => {
    const j = jobs(files["ci.yml"]);
    assert.ok(!/^ {4}env:(?:\n {6}.*)*\n {6}OPENAI_API_KEY/m.test(j.test), "job-level OPENAI_API_KEY");
    assert.match(j["shard-negative"], /-ne 2/);
    assert.match(j["shard-negative"], /pattern:\s*falcon-shard-\*-of-3-\$\{\{ github\.run_attempt \}\}/);
    assert.match(j["shard-negative"], /--expect-run-id="\$EXPECT_RUN_ID" --expect-commit="\$EXPECT_COMMIT"/);
});

test("security.yml: dependabot runs skip snyk with a notice; trusted refs still fail on a missing token", () => {
    const s = stripComments(files["security.yml"]);
    const snykIf = s.match(/^ {2}snyk:\n {4}if: (.*)$/m)[1];
    assert.match(snykIf, /github\.actor != 'dependabot\[bot\]'/);
    const fork = s.match(/^ {2}fork-notice:\n {4}if: (.*)$/m)[1];
    assert.match(fork, /github\.actor == 'dependabot\[bot\]'/);
    assert.match(s, /::notice::Snyk skipped/);
    assert.match(s, /if \[ -z "\$SNYK_TOKEN" \]; then[\s\S]*?exit 1/);
});
