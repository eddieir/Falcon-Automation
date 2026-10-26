#!/usr/bin/env node
'use strict';
// Neutral scorer for the competitive benchmark protocol (docs/research/competitive-benchmark-protocol.md).
// Pure and order-independent: it ingests run records from any tool and never names a winner.
//   node scripts/benchmark/competitive-score.js records.json
// Exit codes: 0 scored, 2 invalid input.
const fs = require('node:fs');

const OUTCOMES = Object.freeze(['PASS', 'FAIL', 'REFUSE', 'PARTIAL', 'TIMEOUT', 'NOT_TESTED', 'MISSING_EVIDENCE']);
const MODES = Object.freeze(['automated', 'assisted']);
const FLAGS = ['repairAttempted', 'repairCorrect', 'wrongAction', 'objectivelyFailed', 'reportedPassed', 'expectedRefusal'];
const MIN_RUNS_FOR_INTERVAL = 3;

class InvalidRecordError extends Error {}

function validate(r, index) {
    const at = `record ${index}`;
    if (!r || typeof r !== 'object') throw new InvalidRecordError(`${at} is not an object`);
    for (const k of ['workloadId', 'tool', 'toolVersion']) {
        if (typeof r[k] !== 'string' || !r[k].trim()) throw new InvalidRecordError(`${at} missing ${k}`);
    }
    if (!OUTCOMES.includes(r.outcome)) throw new InvalidRecordError(`${at} unknown outcome ${r.outcome}`);
    if (!MODES.includes(r.mode)) throw new InvalidRecordError(`${at} mode must be automated or assisted`);
    if (!Number.isInteger(r.run) || r.run < 1) throw new InvalidRecordError(`${at} run must be an integer >= 1`);
    if (r.outcome === 'NOT_TESTED' || r.outcome === 'MISSING_EVIDENCE') return;
    for (const k of FLAGS) {
        if (typeof r[k] !== 'boolean') throw new InvalidRecordError(`${at} ${k} must be a boolean`);
    }
    for (const k of ['operatorMinutes', 'costUsd']) {
        if (!Number.isFinite(r[k]) || r[k] < 0) throw new InvalidRecordError(`${at} ${k} must be a number >= 0`);
    }
    if (r.repairCorrect && !r.repairAttempted) throw new InvalidRecordError(`${at} repairCorrect without repairAttempted`);
    if (r.wrongAction && !r.repairAttempted) throw new InvalidRecordError(`${at} wrongAction without repairAttempted`);
    if (r.repairCorrect && r.wrongAction) throw new InvalidRecordError(`${at} repair cannot be both correct and wrong`);
    if (r.outcome === 'REFUSE' && r.repairAttempted) throw new InvalidRecordError(`${at} REFUSE cannot attempt a repair`);
    if (r.reportedPassed && r.outcome !== 'PASS') throw new InvalidRecordError(`${at} reportedPassed contradicts outcome ${r.outcome}`);
}

function ratio(numerator, denominator) {
    return { value: denominator === 0 ? null : numerator / denominator, numerator, denominator };
}

// Wilson 95% interval, descriptive only: it assumes independent trials, so it is withheld below MIN_RUNS_FOR_INTERVAL distinct runs.
function wilson(numerator, denominator, runs) {
    if (denominator === 0 || runs < MIN_RUNS_FOR_INTERVAL) return null;
    const z = 1.96;
    const p = numerator / denominator;
    const d = 1 + (z * z) / denominator;
    const centre = (p + (z * z) / (2 * denominator)) / d;
    const half = (z * Math.sqrt((p * (1 - p)) / denominator + (z * z) / (4 * denominator * denominator))) / d;
    return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

function scoreGroup(rows) {
    const tested = rows.filter((r) => r.outcome !== 'NOT_TESTED');
    if (tested.length === 0) return { status: 'NOT_TESTED', records: rows.length };
    const scored = tested.filter((r) => r.outcome !== 'MISSING_EVIDENCE');
    const attempts = scored.filter((r) => r.repairAttempted);
    const failed = scored.filter((r) => r.objectivelyFailed);
    const mustRefuse = scored.filter((r) => r.expectedRefusal);
    const runs = new Set(tested.map((r) => r.run)).size;
    const passed = scored.filter((r) => r.outcome === 'PASS' && !r.objectivelyFailed).length;
    return {
        status: 'SCORED',
        records: rows.length,
        scored: scored.length,
        notTested: rows.length - tested.length,
        missingEvidence: tested.length - scored.length,
        distinctRuns: runs,
        healingPrecision: ratio(attempts.filter((r) => r.repairCorrect).length, attempts.length),
        unsafeActionRate: ratio(attempts.filter((r) => r.wrongAction).length, attempts.length),
        falseGreenRate: ratio(failed.filter((r) => r.reportedPassed).length, failed.length),
        correctRefusalRate: ratio(mustRefuse.filter((r) => r.outcome === 'REFUSE').length, mustRefuse.length),
        unnecessaryRefusalRate: ratio(scored.filter((r) => !r.expectedRefusal && r.outcome === 'REFUSE').length, scored.filter((r) => !r.expectedRefusal).length),
        evidenceCompleteness: ratio(scored.length, tested.length),
        passRate: { ...ratio(passed, scored.length), interval: wilson(passed, scored.length, runs) },
        operatorMinutes: scored.reduce((a, r) => a + r.operatorMinutes, 0),
        costUsd: scored.reduce((a, r) => a + r.costUsd, 0),
    };
}

/**
 * Weighted composite over explicit dimensions. Rates where lower is better are inverted.
 * Returns null when any weighted dimension is N/A, so a missing dimension never scores as zero.
 */
const LOWER_IS_BETTER = new Set(['unsafeActionRate', 'falseGreenRate', 'unnecessaryRefusalRate']);
function composite(group, weights) {
    if (group.status !== 'SCORED' || !weights) return null;
    const entries = Object.entries(weights);
    const total = entries.reduce((a, [, w]) => a + w, 0);
    if (!entries.length || entries.some(([, w]) => !(w > 0)) || Math.abs(total - 1) > 1e-9) {
        throw new InvalidRecordError('weights must be positive and sum to 1');
    }
    let sum = 0;
    for (const [dim, w] of entries) {
        const m = group[dim];
        if (!m || typeof m !== 'object' || m.value === null || m.value === undefined) return null;
        sum += w * (LOWER_IS_BETTER.has(dim) ? 1 - m.value : m.value);
    }
    return sum;
}

function score(records, options = {}) {
    if (!Array.isArray(records)) throw new InvalidRecordError('records must be an array');
    const seen = new Set();
    records.forEach((r, i) => {
        validate(r, i);
        const key = [r.tool, r.toolVersion, r.workloadId, r.mode, r.run].join('\u0000');
        if (seen.has(key)) throw new InvalidRecordError(`record ${i} duplicates ${r.tool}@${r.toolVersion} ${r.workloadId} ${r.mode} run ${r.run}`);
        seen.add(key);
    });
    const groups = new Map();
    for (const r of records) {
        const key = JSON.stringify([r.tool, r.toolVersion, r.mode]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    return [...groups.entries()]
        .map(([key, rows]) => {
            const [tool, toolVersion, mode] = JSON.parse(key);
            const result = scoreGroup(rows);
            return { tool, toolVersion, mode, ...result, composite: composite(result, options.weights) };
        })
        .sort((a, b) => `${a.tool}@${a.toolVersion}/${a.mode}`.localeCompare(`${b.tool}@${b.toolVersion}/${b.mode}`));
}

function main(argv) {
    const file = argv[2];
    if (!file) {
        process.stderr.write('usage: competitive-score.js records.json\n');
        return 2;
    }
    try {
        const input = JSON.parse(fs.readFileSync(file, 'utf8'));
        const records = Array.isArray(input) ? input : input.records;
        process.stdout.write(JSON.stringify(score(records, { weights: input.weights }), null, 2) + '\n');
        return 0;
    } catch (err) {
        process.stderr.write(`invalid benchmark input: ${err.message}\n`);
        return 2;
    }
}

module.exports = { score, validate, composite, wilson, OUTCOMES, MODES, InvalidRecordError };
if (require.main === module) process.exitCode = main(process.argv);
