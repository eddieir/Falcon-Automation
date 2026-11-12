#!/usr/bin/env node
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "../..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github/workflows/live-providers.yml");
const CI_PATH = path.join(REPO_ROOT, ".github/workflows/ci.yml");

const EXPECTED_SHAS = {
  checkout: "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "setup-node": "949feb2413d6458794dcd2491c4babbbce0c15c1",
  "upload-artifact": "cf430e030ddbb5b0abf93d22962f4752f3646cd9",
};

describe("live-providers workflow", () => {
  it("workflow file exists", () => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), `${WORKFLOW_PATH} must exist`);
  });

  it("AC1: triggers only workflow_dispatch and schedule", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(content, /\bon:\s*\n/, "must have 'on:' trigger section");
    assert.match(content, /workflow_dispatch/, "must have workflow_dispatch trigger");
    assert.match(content, /schedule:/, "must have schedule trigger");
    assert.doesNotMatch(content, /\bpull_request:/, "must NOT have pull_request trigger");
    assert.doesNotMatch(content, /\bpull_request_target:/, "must NOT have pull_request_target trigger");
    assert.doesNotMatch(content, /\bpush:/, "must NOT have push trigger");
  });

  it("AC2: top-level permissions is contents:read only", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    const permMatch = content.match(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
    assert.ok(permMatch, "top-level permissions must be 'contents: read' only");
  });

  it("AC2: persist-credentials false on checkout", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(content, /persist-credentials:\s*false/, "checkout must have persist-credentials: false");
  });

  it("AC2: has concurrency group", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(content, /^concurrency:/m, "must define concurrency group");
  });

  it("AC2: has timeout-minutes", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(content, /timeout-minutes:\s*\d+/, "must define timeout-minutes");
  });

  it("AC3: checkout pinned by expected SHA", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(
      content,
      new RegExp(`actions/checkout@${EXPECTED_SHAS.checkout}`),
      `checkout must use SHA ${EXPECTED_SHAS.checkout}`
    );
    assert.match(content, /actions\/checkout@[0-9a-f]{40}\s+#\s*v/, "checkout must have version comment");
  });

  it("AC3: setup-node pinned by expected SHA", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(
      content,
      new RegExp(`actions/setup-node@${EXPECTED_SHAS["setup-node"]}`),
      `setup-node must use SHA ${EXPECTED_SHAS["setup-node"]}`
    );
    assert.match(content, /actions\/setup-node@[0-9a-f]{40}\s+#\s*v/, "setup-node must have version comment");
  });

  it("AC3: upload-artifact pinned by expected SHA", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(
      content,
      new RegExp(`actions/upload-artifact@${EXPECTED_SHAS["upload-artifact"]}`),
      `upload-artifact must use SHA ${EXPECTED_SHAS["upload-artifact"]}`
    );
    assert.match(content, /actions\/upload-artifact@[0-9a-f]{40}\s+#\s*v/, "upload-artifact must have version comment");
  });

  it("AC4: runs npm ci", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(content, /npm ci/, "must run npm ci");
  });

  it("AC4: runs npm run test:live-providers", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(content, /npm run test:live-providers/, "must run test:live-providers script");
  });

  it("AC4: secrets mapped to correct env vars", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(content, /FALCON_LIVE_OPENAI_KEY/, "must define FALCON_LIVE_OPENAI_KEY");
    assert.match(content, /FALCON_LIVE_ANTHROPIC_KEY/, "must define FALCON_LIVE_ANTHROPIC_KEY");
    assert.match(content, /FALCON_LIVE_GEMINI_KEY/, "must define FALCON_LIVE_GEMINI_KEY");
    assert.match(content, /FALCON_LIVE_PROVIDER_TESTS:\s*['"]?1['"]?/, "must set FALCON_LIVE_PROVIDER_TESTS=1");
    assert.match(content, /LIVE_OPENAI_API_KEY/, "must reference secret LIVE_OPENAI_API_KEY");
    assert.match(content, /LIVE_ANTHROPIC_API_KEY/, "must reference secret LIVE_ANTHROPIC_API_KEY");
    assert.match(content, /LIVE_GEMINI_API_KEY/, "must reference secret LIVE_GEMINI_API_KEY");
  });

  it("AC4: secrets scoped to step, not job-wide", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    const lines = content.split("\n");
    let inTestStep = false;
    let foundStepEnv = false;
    let foundJobEnv = false;
    let jobIndent = -1;
    let stepIndent = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const indent = line.search(/\S/);

      if (/^\s*jobs:/.test(line)) {
        jobIndent = indent;
      }

      if (/^\s*-\s*name:.*test.*live.*provider/i.test(line) || /^\s*-\s*run:.*test:live-providers/.test(line)) {
        inTestStep = true;
        stepIndent = indent;
      }

      if (inTestStep && /^\s*env:/.test(line) && indent === stepIndent + 2) {
        foundStepEnv = true;
      }

      if (jobIndent >= 0 && /^\s*env:/.test(line) && indent <= jobIndent + 2 && !inTestStep) {
        const envBlock = lines.slice(i, i + 10).join("\n");
        if (envBlock.includes("FALCON_LIVE_OPENAI_KEY") ||
            envBlock.includes("FALCON_LIVE_ANTHROPIC_KEY") ||
            envBlock.includes("FALCON_LIVE_GEMINI_KEY")) {
          foundJobEnv = true;
        }
      }

      if (inTestStep && indent < stepIndent && i > 0 && /^\s*-\s*/.test(line)) {
        inTestStep = false;
      }

      // Also exit when we hit another step at the same level
      if (inTestStep && indent === stepIndent && i > 0 && /^\s*-\s*(uses|name|run):/.test(line)) {
        // Don't reset on the line that just set inTestStep
        const isNewStep = !/^\s*-\s*name:.*test.*live.*provider/i.test(line) &&
                         !/^\s*-\s*run:.*test:live-providers/.test(line);
        if (isNewStep) {
          inTestStep = false;
        }
      }
    }

    assert.ok(foundStepEnv, "provider secrets must be scoped to step env, not job env");
    assert.ok(!foundJobEnv, "provider secrets must NOT be in job-level env");
  });

  it("AC4: has warning annotation for missing secrets", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(content, /::warning::/, "must emit ::warning:: annotation when secrets missing");
  });

  it("AC5: uploads live-evidence artifact", () => {
    const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
    assert.match(content, /upload-artifact/, "must upload artifact");
    assert.match(content, /live-evidence/, "must upload from live-evidence/ path");
    assert.match(content, /if:\s*always\(\)/, "upload must have if: always()");
    assert.match(content, /if-no-files-found:\s*warn/, "upload must have if-no-files-found: warn");
    assert.match(content, /retention-days:\s*\d+/, "upload must specify retention-days");
  });

  it("AC6: ci.yml has no reference to live-providers or test:live-providers", () => {
    const ciContent = fs.readFileSync(CI_PATH, "utf8");
    assert.doesNotMatch(ciContent, /live-providers/, "ci.yml must not reference live-providers");
    assert.doesNotMatch(ciContent, /test:live-providers/, "ci.yml must not reference test:live-providers");
  });
});
