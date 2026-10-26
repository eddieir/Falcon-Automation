#!/usr/bin/env node
'use strict';
// Renders a run file (docs/research/competitive-benchmark-runs/<rev>-local.json) as Markdown. Pure and deterministic.
//   node benchmarks/competitive/report.js runs/<rev>-local.json > results.md
const fs = require('node:fs');

const pct = (m) => (m.value === null ? 'N/A' : `${m.numerator}/${m.denominator}`);
const LETTER = { PASS: 'P', FAIL: 'F', REFUSE: 'R', NOT_TESTED: '-', PARTIAL: 'p', TIMEOUT: 't', MISSING_EVIDENCE: 'm' };

function render(run) {
  const { meta, scores, records, locators } = run;
  const tools = scores.map((s) => s.tool).sort();
  const lines = [];
  lines.push('# Local competitive benchmark results', '');
  lines.push(`Generated from \`${meta.revision.slice(0, 7)}-local.json\` by \`benchmarks/competitive/report.js\`. Protocol: [competitive-benchmark-protocol.md](../competitive-benchmark-protocol.md). Read the limitations there before citing any number.`, '');
  lines.push('## Environment', '', `- Revision: \`${meta.revision}\` (relevant tree clean: ${meta.dirtyRelevantTree ? 'no' : 'yes'})`, `- Node ${meta.node}; ${meta.os}; ${meta.runs} runs per tool; automated mode only`, `- Cost: $${meta.costUsd}; AI calls: ${meta.aiCalls}; no accounts, keys or network beyond loopback`, '');
  lines.push('| Tool | Version / browser |', '|---|---|', ...Object.entries(meta.versions).sort().map(([t, v]) => `| ${t} | ${v} |`), '');
  lines.push('## Metrics', '', 'Each cell is `numerator/denominator` pooled over all runs, so divide by the run count for distinct cases. `N/A` means a zero denominator, not zero. Runs repeat identical deterministic fixtures, so repeats add no independent evidence about variance (see the limitations in the protocol).', '');
  lines.push('| Metric | ' + tools.join(' | ') + ' |', '|---|' + tools.map(() => '---').join('|') + '|');
  const by = Object.fromEntries(scores.map((s) => [s.tool, s]));
  for (const [key, label] of [['healingPrecision', 'Healing precision (correct repairs / attempted repairs)'], ['unsafeActionRate', 'Unsafe repairs (wrong / attempted)'], ['falseGreenRate', 'False green (reported pass / objectively failing)'], ['correctRefusalRate', 'Correct refusals (refused / refusal expected)'], ['unnecessaryRefusalRate', 'Unnecessary refusals (refused / repair expected)'], ['evidenceCompleteness', 'Evidence completeness']]) {
    lines.push(`| ${label} | ${tools.map((t) => (by[t].status === 'SCORED' ? pct(by[t][key]) : 'NOT_TESTED')).join(' | ')} |`);
  }
  lines.push(`| Median time for one full pass (s) | ${tools.map((t) => (by[t].ciEconomics && by[t].ciEconomics.timeToGreenSec ? by[t].ciEconomics.timeToGreenSec.median : 'N/A')).join(' | ')} |`, '');
  const ids = [...new Set(records.map((r) => r.workloadId))].sort();
  lines.push('## Outcome per workload', '', 'Letters: `P` pass, `F` fail, `R` refused, `-` not tested. `!` marks an objectively wrong run (a false green when the tool reported a pass). `h` marks a repair attempt. Outcomes were identical across all runs unless a cell shows `*`.', '');
  lines.push('| Workload | ' + tools.join(' | ') + ' |', '|---|' + tools.map(() => '---').join('|') + '|');
  for (const id of ids) {
    const cells = tools.map((t) => {
      const rs = records.filter((r) => r.workloadId === id && r.tool === t);
      const keys = new Set(rs.map((r) => `${LETTER[r.outcome]}${r.objectivelyFailed ? '!' : ''}${r.repairAttempted ? 'h' : ''}`));
      return keys.size === 1 ? [...keys][0] : '*';
    });
    lines.push(`| ${id} | ${cells.join(' | ')} |`);
  }
  lines.push('', '## Primary locators', '', 'Identical for every tool; derived from the fixture, never from a tool.', '', '| Fixture | Locator | Basis |', '|---|---|---|', ...locators.map((l) => `| ${l.id} | \`${l.selector}\` | ${l.basis} |`), '');
  return lines.join('\n');
}

if (require.main === module) process.stdout.write(`${render(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))}\n`);
module.exports = { render };
