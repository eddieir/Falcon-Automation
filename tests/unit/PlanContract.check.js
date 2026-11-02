"use strict";

/**
 * PlanContract.check.js -- WP-77N PlanFile contract/journeyId/verify rules.
 * Hermetic: os.tmpdir mkdtemp per test, no network.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PlanFile = require("../../src/core/PlanFile");

let failures = 0;
let passed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (e) {
        failures++;
        console.error(`❌ ${name}: ${e && e.stack ? e.stack : e}`);
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (e) {
        failures++;
        console.error(`❌ ${name}: ${e && e.stack ? e.stack : e}`);
    }
}

function basePlan(overrides = {}) {
    return Object.assign(
        {
            format: "falcon-test-plan",
            version: 1,
            url: "http://127.0.0.1:5173/news",
            scenarios: [
                { action: "click", locator: "button", description: "Click it" },
            ],
        },
        overrides
    );
}

function journeyPlan(scenarioOverrides) {
    return basePlan({
        journey: true,
        contract: "contract.json",
        journeyId: "journey-1",
        scenarios: scenarioOverrides || [
            { action: "click", locator: "button", description: "Click it" },
            { action: "verify", description: "Verify outcome" },
        ],
    });
}

function rejects(doc, re) {
    assert.throws(
        () => PlanFile.validate(doc),
        (e) => e instanceof PlanFile.PlanError && re.test(e.message)
    );
}

async function main() {
    test("valid contract+journeyId+journey+verify plan is accepted", () => {
        const plan = PlanFile.validate(journeyPlan());
        assert.ok(plan.contract);
        assert.equal(plan.contract.journeyId, "journey-1");
    });

    await asyncTest("load() resolves contract.file absolute against the plan's directory", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-plancontract-"));
        const file = path.join(dir, "plan.json");
        fs.writeFileSync(file, JSON.stringify(journeyPlan()));
        const plan = await PlanFile.load(file);
        assert.equal(plan.contract.file, path.resolve(dir, "contract.json"));
        assert.ok(path.isAbsolute(plan.contract.file));
    });

    test("contract without journeyId is rejected", () => {
        const doc = journeyPlan();
        delete doc.journeyId;
        rejects(doc, /contract\/journeyId/);
    });

    test("journeyId without contract is rejected", () => {
        const doc = journeyPlan();
        delete doc.contract;
        rejects(doc, /contract\/journeyId/);
    });

    test("journey: false with contract+journeyId is rejected", () => {
        const doc = journeyPlan();
        doc.journey = false;
        rejects(doc, /journey: must be true/);
    });

    test("contract+journeyId plan with no verify scenario is rejected", () => {
        const doc = journeyPlan([
            { action: "click", locator: "button", description: "Click it" },
        ]);
        rejects(doc, /require at least one "verify" scenario/);
    });

    test("verify scenario without contract+journeyId is rejected", () => {
        const doc = basePlan({
            scenarios: [
                { action: "click", locator: "button", description: "Click it" },
                { action: "verify", description: "Verify outcome" },
            ],
        });
        rejects(doc, /verify.*requires both contract and journeyId/);
    });

    test("two verify scenarios are rejected", () => {
        const doc = journeyPlan([
            { action: "click", locator: "button", description: "Click it" },
            { action: "verify", description: "Verify outcome" },
            { action: "verify", description: "Verify outcome again" },
        ]);
        rejects(doc, /at most one "verify" scenario/);
    });

    test("verify as the first scenario is rejected", () => {
        const doc = journeyPlan([
            { action: "verify", description: "Verify outcome" },
            { action: "click", locator: "button", description: "Click it" },
        ]);
        rejects(doc, /must not be first/);
    });

    test("verify scenario with a locator (extra key) is rejected", () => {
        const doc = journeyPlan([
            { action: "click", locator: "button", description: "Click it" },
            { action: "verify", locator: "button", description: "Verify outcome" },
        ]);
        rejects(doc, /unknown property for action "verify"/);
    });

    test("invalid journeyId is rejected", () => {
        const doc = journeyPlan();
        doc.journeyId = "";
        rejects(doc, /journeyId: invalid/);
    });

    test("existing plain click+expect plan shapes are unchanged", () => {
        const doc = basePlan({
            scenarios: [
                { action: "click", locator: "button", description: "Click it" },
                { action: "expect", locator: "h1", check: "visible", description: "Heading shown" },
            ],
        });
        const plan = PlanFile.validate(doc);
        assert.equal(plan.journey, false);
        assert.equal(plan.test_scenarios.length, 2);
        assert.ok(!("contract" in plan));
    });

    console.log(`\n${passed} passed, ${failures} failed`);
    if (failures > 0) process.exit(1);
}

main();
