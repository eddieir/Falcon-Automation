'use strict';
// Turns what a tool did (or what Falcon's healing path decided) into a scoreable record. Pure; no I/O.

function baseRecord(tool, version, run, workloadId, extra) {
  return {
    workloadId, tool, toolVersion: version, mode: 'automated', run, outcome: 'PASS',
    repairAttempted: false, repairCorrect: false, wrongAction: false, objectivelyFailed: false, reportedPassed: true,
    expectedRefusal: false, operatorMinutes: 0, costUsd: 0, ...extra,
  };
}
const failed = (r) => ({ ...r, outcome: 'FAIL', reportedPassed: false });

/**
 * Plain-path verdict from what the page actually received. A click that lands anywhere unintended, or
 * anywhere at all when the correct behaviour is to refuse or the target is gone, is a false green:
 * the tool reports success while the run is objectively wrong.
 */
function classifyLanding(rec, fixture, landed) {
  const mustNotAct = fixture.mustRefuse || fixture.expectedOutcome === 'no_candidate';
  if (landed === null) return failed({ ...rec, objectivelyFailed: !fixture.mustRefuse });
  if (landed === fixture.groundTruthId && !mustNotAct) return rec;
  return { ...rec, objectivelyFailed: true };
}

/** Falcon healing-path verdict from the benchmark runner's own outcome. */
function classifyHeal(rec, fixture, heal) {
  const removed = fixture.expectedOutcome === 'no_candidate';
  const objectivelyFailed = removed || !fixture.mustRefuse;
  switch (heal.outcome) {
    case 'correct_heal': return { ...rec, repairAttempted: true, repairCorrect: true, objectivelyFailed: removed || fixture.mustRefuse };
    case 'false_heal': return { ...rec, repairAttempted: true, wrongAction: true, objectivelyFailed: true };
    case 'refused': return { ...rec, outcome: 'REFUSE', reportedPassed: false, objectivelyFailed };
    default: return failed({ ...rec, objectivelyFailed });
  }
}

module.exports = { baseRecord, failed, classifyLanding, classifyHeal };
