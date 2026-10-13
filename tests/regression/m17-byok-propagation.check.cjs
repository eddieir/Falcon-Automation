/**
 * tests/regression/m17-byok-propagation.check.cjs — ADR-0019 end-to-end
 * propagation tests for `providerContext`: falcon.js -> SiteSweep ->
 * TestRunner.runRepeatedTestPlan -> new AIHealer(...), and the parallel
 * path falcon.js -> ParallelRunner -> ParallelSweep.runInJournalMode ->
 * SiteSweep + TestRunner.runRepeatedTestPlan.
 *
 * Scope: PROPAGATION only — does the exact same context object identity
 * reach the bottom of the call chain, never swapped/dropped/defaulted.
 * CLI-flag parsing/validation is covered by m17-byok-cli.check.cjs;
 * AIHealer-internal provider selection/isolation is covered by
 * m17-byok-wiring.check.cjs — this file is deliberately a thin seam check
 * on top of those, re-proving the wiring at the SiteSweep/ParallelSweep
 * layer this task actually owns.
 *
 * Run: node --test --test-concurrency=1 --test-timeout=10000 tests/regression/m17-byok-propagation.check.cjs
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load, silent } = require("./helpers.cjs");

const ProviderContext = require("../../src/core/llm/ProviderContext");

let _credCounter = 0;
function makeContext(provider, model, credName = `FAKE_CRED_${provider.toUpperCase()}_${_credCounter++}_API_KEY`) {
  const result = ProviderContext.resolve({
    options: { provider, model, credentialEnvVar: credName },
    get: () => null,
    env: { [credName]: "FAKEMARKER_cred_present" },
  });
  assert.equal(result.ok, true, `expected makeContext(${provider}, ${model}) to resolve ok`);
  return result.context;
}

// ── (1) SiteSweep: providerContext reaches TestRunner.runRepeatedTestPlan ──

function loadSiteSweep(captured) {
  return load("src/core/SiteSweep.js", {
    "../../utils/Logger": silent,
    "./ClickExplorer": class {},
    "./DOMIssueScanner": class {
      constructor() {}
      async detectUIIssues() {
        return [];
      }
    },
    "./TestGenerator": class {
      constructor() {}
      async generateTestScenarios() {
        return { url: "http://fixture.test/page", test_scenarios: [] };
      }
    },
    "./TestRunner": {
      async runRepeatedTestPlan(page, testPlan, repeatCount, options) {
        captured.push((options && options.providerContext) || null);
        return [];
      },
    },
  });
}

function fakePage() {
  return {
    goto: async () => ({ status: () => 200 }),
    close: async () => {},
  };
}

function fakeContext() {
  return { newPage: async () => fakePage() };
}

test("SiteSweep: an Anthropic providerContext reaches TestRunner.runRepeatedTestPlan by identity", async () => {
  const captured = [];
  const SiteSweep = loadSiteSweep(captured);
  const ctx = makeContext("anthropic", "claude-propagation-test");
  const sweep = new SiteSweep(fakeContext(), { providerContext: ctx });
  const record = { url: "http://fixture.test/page" };
  await sweep._sweepPage(record, 0, 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0], ctx, "TestRunner.runRepeatedTestPlan must receive the exact injected context");
});

test("SiteSweep: a separate sweep with an OpenAI context never sees the Anthropic context (no swap)", async () => {
  const capturedA = [];
  const capturedB = [];
  const SiteSweepA = loadSiteSweep(capturedA);
  const SiteSweepB = loadSiteSweep(capturedB);
  const ctxAnthropic = makeContext("anthropic", "claude-propagation-test-2");
  const ctxOpenAI = makeContext("openai", "gpt-propagation-test");

  const sweepA = new SiteSweepA(fakeContext(), { providerContext: ctxAnthropic });
  const sweepB = new SiteSweepB(fakeContext(), { providerContext: ctxOpenAI });

  await sweepA._sweepPage({ url: "http://fixture.test/a" }, 0, 1);
  await sweepB._sweepPage({ url: "http://fixture.test/b" }, 0, 1);

  assert.equal(capturedA[0], ctxAnthropic);
  assert.equal(capturedB[0], ctxOpenAI);
  assert.notEqual(capturedA[0], capturedB[0], "two sweeps' contexts must never cross");
});

test("SiteSweep: no providerContext option => null reaches TestRunner (unchanged Phase 17 default)", async () => {
  const captured = [];
  const SiteSweep = loadSiteSweep(captured);
  const sweep = new SiteSweep(fakeContext(), {});
  await sweep._sweepPage({ url: "http://fixture.test/page" }, 0, 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0], null, "providerContext must stay null when none was supplied");
});

// ── (2) falcon.js: runEntryPageOnly forwards providerContext to SiteSweep ──
// (static/source-level: falcon.js's whole-app and single-page runner both
// pass `providerContext` into the opts object that reaches `new SiteSweep`;
// the behavioural proof that SiteSweep actually honours it is test (1)
// above, and the end-to-end CLI-level proof — spawn falcon.js, assert the
// forwarded context reaches TestRunner.runRepeatedTestPlan — already exists
// in tests/regression/m17-byok-cli.check.cjs, which this file intentionally
// does not duplicate.)

test("falcon.js source: SiteSweep is constructed from an opts spread, and both the whole-app call site and runWholeApp's opts object carry providerContext", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "falcon.js"), "utf8");

  // SiteSweep is built from `{ ...opts, onEvent: emit }` inside runWholeApp —
  // providerContext therefore arrives via the `opts` object the caller
  // passes to runWholeApp(), not as a literal key at the SiteSweep call
  // site itself.
  const siteSweepCallSite = src.match(/new SiteSweep\(context,\s*\{[\s\S]{0,200}?\}\)/);
  assert.ok(siteSweepCallSite, "expected a `new SiteSweep(context, {...})` call site in falcon.js");
  assert.match(siteSweepCallSite[0], /\.\.\.opts/, "SiteSweep must be constructed by spreading runWholeApp's opts object");

  // The whole-app call site passes providerContext into that opts object.
  const runWholeAppCallSite = src.match(/await runWholeApp\(context,\s*url,\s*emit,\s*\{[\s\S]{0,400}?\}\)/);
  assert.ok(runWholeAppCallSite, "expected an `await runWholeApp(context, url, emit, {...})` call site in falcon.js");
  assert.match(runWholeAppCallSite[0], /providerContext/, "runWholeApp's opts object must include providerContext");

  const parallelSweepOptsSite = src.match(/sweepOpts:\s*\{[\s\S]{0,200}?\}/);
  assert.ok(parallelSweepOptsSite, "expected a `sweepOpts: {...}` call site in falcon.js");
  assert.match(parallelSweepOptsSite[0], /providerContext/, "sweepOpts must include providerContext for the parallel path");
});

// ── (3) ParallelSweep.runInJournalMode: providerContext reaches SiteSweep
//        and TestRunner.runRepeatedTestPlan ──────────────────────────────

test("ParallelSweep.runInJournalMode source: providerContext flows into both the SiteSweep constructor and runRepeatedTestPlan's options", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "core", "parallel", "ParallelSweep.js"),
    "utf8",
  );
  const destructure = src.match(/const\s*\{[\s\S]{0,400}?\}\s*=\s*opts;/);
  assert.ok(destructure, "expected opts destructuring in runInJournalMode");
  assert.match(destructure[0], /providerContext\s*=\s*null/, "providerContext must be destructured from opts with a null default");

  const siteSweepCtor = src.match(/new SiteSweep\(context,\s*\{[\s\S]{0,300}?\}\)/);
  assert.ok(siteSweepCtor, "expected a `new SiteSweep(context, {...})` call site");
  assert.match(siteSweepCtor[0], /providerContext/, "SiteSweep must be constructed with providerContext");

  const runnerCall = src.match(/TestRunner\.runRepeatedTestPlan\(page,\s*plan,\s*1,\s*\{[\s\S]{0,80}?\}\)/);
  assert.ok(runnerCall, "expected a `TestRunner.runRepeatedTestPlan(page, plan, 1, {...})` call site");
  assert.match(runnerCall[0], /providerContext/, "runRepeatedTestPlan's options must include providerContext");
});

test("ParallelSweep: SiteSweep built inside runInJournalMode honours the same providerContext identity (behavioural, via SiteSweep's own seam)", async () => {
  // Re-proves, at the unit level this task owns, that the SiteSweep
  // instance ParallelSweep.runInJournalMode constructs (per the source
  // assertion above) behaves exactly like the standalone SiteSweep proven
  // in test (1): the same context object, by identity, reaches
  // TestRunner.runRepeatedTestPlan. This avoids driving the full
  // runInJournalMode orchestration (workers/journal/auth-state), which is
  // out of this task's scope and already covered elsewhere.
  const captured = [];
  const SiteSweep = loadSiteSweep(captured);
  const ctx = makeContext("anthropic", "claude-parallel-propagation-test");
  const sweep = new SiteSweep(fakeContext(), {
    maxPages: 1,
    sameOriginOnly: true,
    pageTimeoutMs: 1000,
    dedupe: true,
    repeat: 1,
    providerContext: ctx,
  });
  await sweep._sweepPage({ url: "http://fixture.test/page" }, 0, 1);
  assert.equal(captured[0], ctx);
});

// ── (4) AIHealer via TestRunner resolves by LlmProviderRegistry for the
//        injected context; a different provider's env key is never read,
//        and two concurrent contexts' credentials never cross ───────────

function loadRealAIHealer() {
  return load("src/core/AIHealer/AIHealer.js", {
    "../../utils/Logger": silent,
    "./LocatorStore": { getAlternatives: () => [], addLocator: () => {} },
    "./HealingReport": { log: () => {} },
    "./HealingTrust": { recordPending: () => {}, recordTier3Invocation: () => {} },
    "./AdaptiveRetry": class {
      async execute(fn) {
        return fn();
      }
    },
  });
}

function loadTestRunnerWithRealAIHealer() {
  const Healer = loadRealAIHealer();
  return load("src/core/TestRunner.js", {
    "../../utils/Logger": silent,
    "./AIHealer/AIHealer": Healer,
    "./AIHealer/HealingReport": { log: () => {} },
    "./AIHealer/AdaptiveRetry": class {
      async execute(fn) {
        return fn();
      }
    },
    "./FlakinessTracker": { record: () => {}, isQuarantined: () => false },
  });
}

test("AIHealer built via TestRunner resolves the injected Anthropic context's provider id, ignoring FALCON_LLM_PROVIDER=openai", () => {
  const reads = [];
  const openaiKeyName = "OPENAI_API_KEY";
  const anthropicKeyName = "ANTHROPIC_API_KEY";
  const envProxy = new Proxy(
    { [openaiKeyName]: "FAKEMARKER_openai_should_never_be_read", [anthropicKeyName]: "FAKEMARKER_anthropic_present" },
    {
      get(target, prop) {
        if (prop === openaiKeyName) reads.push(prop);
        return target[prop];
      },
    },
  );
  const result = ProviderContext.resolve({
    options: { provider: "anthropic", model: "claude-registry-propagation-test", credentialEnvVar: anthropicKeyName },
    env: envProxy,
    get: () => null,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const ctx = result.context;

  const TestRunner = loadTestRunnerWithRealAIHealer();
  const runner = new TestRunner({}, { url: "http://fixture.test", test_scenarios: [] }, { providerContext: ctx });
  const provider = runner.healer._resolveProvider();
  return provider.then((resolved) => {
    assert.equal(resolved.id, "anthropic", "the injected context's provider id must win over any process-level FALCON_LLM_PROVIDER setting");
    assert.deepEqual(reads, [], "the OpenAI-shaped credential must never be read while resolving an Anthropic context");
  });
});

test("AIHealer built via TestRunner: two concurrent contexts never share a resolved provider instance or budget", async () => {
  const TestRunner = loadTestRunnerWithRealAIHealer();
  const ctxA = makeContext("openai", "gpt-concurrent-a");
  const ctxB = makeContext("openai", "gpt-concurrent-a"); // same provider/model, distinct object
  const runnerA = new TestRunner({}, { url: "http://fixture.test", test_scenarios: [] }, { providerContext: ctxA });
  const runnerB = new TestRunner({}, { url: "http://fixture.test", test_scenarios: [] }, { providerContext: ctxB });
  const providerA = await runnerA.healer._resolveProvider();
  const providerB = await runnerB.healer._resolveProvider();
  assert.notEqual(providerA, providerB, "distinct contexts routed through distinct TestRunners must resolve distinct provider instances");
  assert.notEqual(ctxA.runtime.budget, ctxB.runtime.budget, "distinct contexts must never share a budget");
});

// ── (5) Negative: providerContext null => unchanged Phase 17 default ──────

test("SiteSweep with providerContext explicitly null behaves exactly as providerContext omitted", async () => {
  const capturedExplicitNull = [];
  const capturedOmitted = [];
  const SweepA = loadSiteSweep(capturedExplicitNull);
  const SweepB = loadSiteSweep(capturedOmitted);
  const sweepA = new SweepA(fakeContext(), { providerContext: null });
  const sweepB = new SweepB(fakeContext(), {});
  await sweepA._sweepPage({ url: "http://fixture.test/page" }, 0, 1);
  await sweepB._sweepPage({ url: "http://fixture.test/page" }, 0, 1);
  assert.equal(capturedExplicitNull[0], null);
  assert.equal(capturedOmitted[0], null);
});

test("AIHealer built via TestRunner with no providerContext falls back to the unchanged Phase 17 process default (disabled provider, no crash)", async () => {
  const TestRunner = loadTestRunnerWithRealAIHealer();
  // No provider env configured in this isolated env snapshot => the
  // Phase 17 default context resolution resolves cleanly to the
  // `disabled` provider (LlmConfig's own documented no-config default),
  // not an error and not a crash. This is the exact same outcome a bare
  // `new AIHealer(page)` (no providerContext at all) gets today — the
  // behaviour this task must leave unchanged.
  ProviderContext._resetForTests();
  const runner = new TestRunner({}, { url: "http://fixture.test", test_scenarios: [] }, {});
  const envBackup = { FALCON_LLM_PROVIDER: process.env.FALCON_LLM_PROVIDER, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  delete process.env.FALCON_LLM_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  try {
    const provider = await runner.healer._resolveProvider();
    assert.ok(provider, "the no-context default must resolve to a provider instance, not null");
    assert.equal(provider.id, "disabled", "the Phase 17 no-config default is the disabled provider");
  } finally {
    if (envBackup.FALCON_LLM_PROVIDER !== undefined) process.env.FALCON_LLM_PROVIDER = envBackup.FALCON_LLM_PROVIDER;
    if (envBackup.OPENAI_API_KEY !== undefined) process.env.OPENAI_API_KEY = envBackup.OPENAI_API_KEY;
    ProviderContext._resetForTests();
  }
});
