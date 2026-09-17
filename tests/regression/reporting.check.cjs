const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Report = require("../../src/core/ReportManager");
const { load, silent, temp } = require("./helpers.cjs");
for (const [statuses, result, exit] of [
  [["passed"], "PASSED", 0],
  [["failed"], "FAILED", 1],
  [["passed", "failed"], "PARTIAL", 1],
  [["skipped"], "PASSED", 0],
  [[], "NO_TESTS_RUN", 1],
  [["passed", "skipped"], "PASSED", 0],
]) {
  test(`report tallies ${statuses.join("/") || "empty"} accurately`, (t) => {
    const cwd = process.cwd(),
      dir = temp(),
      oldCode = process.exitCode;
    process.chdir(dir);
    t.after(() => {
      process.chdir(cwd);
      process.exitCode = oldCode;
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const manager = new Report();
    manager.startRun();
    const tests = statuses.map((status, i) => ({ name: `case ${i}`, status }));
    const report = manager.generateReport({
      tests,
      uiIssues: [{ type: "fixture" }],
      healingEvents: [{ original: "#old" }],
    });
    assert.equal(process.exitCode, exit);
    process.exitCode = oldCode;
    assert.equal(report.result, result);
    assert.equal(report.summary.total, statuses.length);
    for (const status of ["passed", "failed", "skipped"])
      assert.equal(
        report.summary[status],
        statuses.filter((s) => s === status).length,
      );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dir, "reports/test-report.json"))),
      report,
    );
    assert.match(report.duration, /^\d+\.\d{2}s$/);
  });
}
for (const [content, expected] of [
  [" #new ", "#new"],
  ["null", null],
  ["", null],
]) {
  test(`standalone locator analysis normalizes ${content || "empty response"}`, async () => {
    const Analyser = load("src/core/AIHealer/AIAnalyser.js", {
      "../../../utils/Logger": silent,
      dotenv: { config() {} },
    });
    Analyser._client = async () => ({
      chat: {
        completions: {
          create: async (request) => {
            assert.match(request.messages[1].content, /fixture/);
            return { choices: [{ message: { content } }] };
          },
        },
      },
    });
    assert.equal(await Analyser.getAlternativeLocator("fixture"), expected);
  });
}
for (const status of [401, 429, 500])
  test(`standalone locator analysis tolerates provider ${status}`, async () => {
    const Analyser = load("src/core/AIHealer/AIAnalyser.js", {
      "../../../utils/Logger": silent,
      dotenv: { config() {} },
    });
    Analyser._client = async () => {
      throw Object.assign(Error("provider error"), { status });
    };
    assert.equal(await Analyser.getAlternativeLocator("fixture"), null);
  });
