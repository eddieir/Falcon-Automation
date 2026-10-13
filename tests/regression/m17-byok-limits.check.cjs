/**
 * tests/regression/m17-byok-limits.check.cjs — Dev-01b (ADR-0019 C14, C15).
 *
 * Covers:
 *  - Semaphore bounded wait timeout (no permit leak, queue drains).
 *  - LlmBudget process-wide ceilings (2000 attempts / 8 in-flight) shared
 *    across independent per-context budgets/semaphores.
 *  - Redact.scanField per-field check + Gemini AIza pattern + sk-ant- refusal.
 *
 * AC12, AC28, N07.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const Semaphore = require(path.join("..", "..", "src", "core", "llm", "Semaphore.js"));
const LlmBudget = require(path.join("..", "..", "src", "core", "llm", "LlmBudget.js"));
const Redact = require(path.join("..", "..", "src", "production-cycle", "Redact.js"));

// --- Semaphore: bounded wait timeout -----------------------------------------

test("Semaphore: existing size-1 run() serialisation is unchanged", async () => {
    const sem = new Semaphore(1);
    let active = 0;
    let maxActive = 0;
    const task = async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
    };
    await Promise.all([sem.run(task), sem.run(task), sem.run(task)]);
    assert.equal(maxActive, 1);
});

test("Semaphore: acquire() with no contention still resolves immediately (default timeout untouched)", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    sem.release();
    sem.release();
});

test("Semaphore: constructor clamps waitTimeoutMs option to a safe min/max", () => {
    const tooSmall = new Semaphore(1, { waitTimeoutMs: 1 });
    const tooBig = new Semaphore(1, { waitTimeoutMs: Number.MAX_SAFE_INTEGER });
    const normal = new Semaphore(1, { waitTimeoutMs: 5000 });
    const bogus = new Semaphore(1, { waitTimeoutMs: "nope" });
    assert.ok(tooSmall._waitTimeoutMs >= 50, "must clamp up to a sane minimum");
    assert.ok(tooBig._waitTimeoutMs <= 300000, "must clamp down to a sane maximum");
    assert.equal(normal._waitTimeoutMs, 5000);
    assert.equal(bogus._waitTimeoutMs, 30000, "non-numeric option falls back to the 30000ms default");
});

test("Semaphore: a waiter that times out rejects without leaking a permit, and the queue drains", async () => {
    const sem = new Semaphore(1, { waitTimeoutMs: 50 });
    // Hold the only slot.
    await sem.acquire();

    const waiterPromise = sem.acquire();
    await assert.rejects(waiterPromise, (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.code, "SEMAPHORE_WAIT_TIMEOUT");
        return true;
    });

    // The held slot is still ours; releasing it must not hand a permit to a
    // waiter that already timed out and left the queue.
    sem.release();

    // A fresh acquire must succeed immediately — no leaked/ghost permit and
    // no stuck queue entry left behind by the timed-out waiter.
    const start = Date.now();
    await sem.acquire();
    assert.ok(Date.now() - start < 40, "the queue must have drained; no lingering wait");
    sem.release();
});

test("Semaphore.run(): caller can map a timeout rejection to a TIMEOUT-like outcome", async () => {
    const sem = new Semaphore(1, { waitTimeoutMs: 30 });
    const releaseHold = sem.acquire();
    await releaseHold;

    let outcome;
    try {
        await sem.run(async () => "should not run");
        outcome = { ok: true };
    } catch (err) {
        outcome = { ok: false, errorCode: err.code === "SEMAPHORE_WAIT_TIMEOUT" ? "TIMEOUT" : "UNKNOWN" };
    }
    assert.deepEqual(outcome, { ok: false, errorCode: "TIMEOUT" });
    sem.release();
});

// --- LlmBudget: process-wide ceilings -----------------------------------------

test("LlmBudget.processCeiling: independent budgets together cannot exceed 2000 total attempts", () => {
    LlmBudget.processCeiling._resetForTests();
    const perContext = 250;
    const contexts = 10; // 10 * 250 = 2500 > 2000 ceiling
    let granted = 0;
    for (let c = 0; c < contexts; c++) {
        const budget = new LlmBudget(perContext);
        for (let i = 0; i < perContext; i++) {
            const localOk = budget.consumeAttempt();
            const globalOk = localOk && LlmBudget.processCeiling.tryConsumeAttempt();
            if (globalOk) granted += 1;
        }
    }
    assert.equal(granted, 2000, "process-wide ceiling must cap total granted attempts at 2000");
    assert.equal(LlmBudget.processCeiling.tryConsumeAttempt(), false, "ceiling exhaustion returns false, makes no call");
});

test("LlmBudget.processCeiling: independent semaphores together cannot exceed 8 concurrent in-flight", async () => {
    LlmBudget.processCeiling._resetForTests();
    const contexts = 20;
    let maxInFlight = 0;
    let currentInFlight = 0;
    let rejectedCount = 0;

    const work = async () => {
        if (!LlmBudget.processCeiling.enterFlight()) {
            rejectedCount += 1;
            return;
        }
        currentInFlight += 1;
        maxInFlight = Math.max(maxInFlight, currentInFlight);
        await new Promise((r) => setTimeout(r, 10));
        currentInFlight -= 1;
        LlmBudget.processCeiling.leaveFlight();
    };

    await Promise.all(Array.from({ length: contexts }, () => work()));
    assert.ok(maxInFlight <= 8, `max in-flight observed was ${maxInFlight}, must be <= 8`);
    assert.ok(rejectedCount >= contexts - 8, "entries beyond the ceiling must be rejected with no call made");
});

test("LlmBudget.processCeiling: exhaustion makes zero network calls (returns false synchronously)", () => {
    LlmBudget.processCeiling._resetForTests();
    for (let i = 0; i < 8; i++) {
        assert.equal(LlmBudget.processCeiling.enterFlight(), true);
    }
    let calls = 0;
    const simulateCall = () => {
        if (!LlmBudget.processCeiling.enterFlight()) return false;
        calls += 1;
        return true;
    };
    assert.equal(simulateCall(), false);
    assert.equal(calls, 0, "no network call must be made once the in-flight ceiling is exhausted");
});

test("LlmBudget(runBudget) existing per-instance behaviour is unchanged", () => {
    const budget = new LlmBudget(1);
    assert.equal(budget.consumeAttempt(), true);
    assert.equal(budget.consumeAttempt(), false);
    assert.equal(budget.remaining(), 0);
    budget.reset(3);
    assert.equal(budget.remaining(), 3);
});

// --- Redact: scanField + Gemini pattern ---------------------------------------

test("Redact.scanField: clean string passes", () => {
    const result = Redact.scanField("a perfectly ordinary model id");
    assert.equal(result.ok, true);
});

test("Redact.scanField: Gemini AIza-shaped key is refused, never echoed", () => {
    const fake = "AIza" + "A".repeat(35);
    const result = Redact.scanField(fake);
    assert.equal(result.ok, false);
    assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
    assert.equal(JSON.stringify(result).includes(fake), false);
});

test("Redact.scanField: sk-ant- shaped key is refused, never echoed", () => {
    const fake = "sk-ant-" + "B".repeat(20);
    const result = Redact.scanField(fake);
    assert.equal(result.ok, false);
    assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
    assert.equal(JSON.stringify(result).includes(fake), false);
});

test("Redact.scan: AIza marker inside a free-text event field is refused", () => {
    const fake = "AIza" + "C".repeat(35);
    const result = Redact.scan({ summary: `key is ${fake}`, openRisks: [], requestedLabel: null });
    assert.equal(result.ok, false);
    assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
    assert.equal(JSON.stringify(result).includes(fake), false);
});

test("Redact.scan: sk-ant- marker inside a free-text event field is refused", () => {
    const fake = "sk-ant-" + "D".repeat(20);
    const result = Redact.scan({ summary: "ok", openRisks: [], requestedLabel: fake });
    assert.equal(result.ok, false);
    assert.equal(result.code, "SCHEMA_SECRET_SHAPED");
    assert.equal(JSON.stringify(result).includes(fake), false);
});

test("Redact.scanField: non-string / empty input is treated as not secret", () => {
    assert.equal(Redact.scanField(undefined).ok, true);
    assert.equal(Redact.scanField(null).ok, true);
    assert.equal(Redact.scanField("").ok, true);
    assert.equal(Redact.scanField(42).ok, true);
});
