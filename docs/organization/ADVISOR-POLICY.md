# Advisor policy

## Verified capability (2026-10-27)
- Installed Claude Code: 2.1.311.
- The Advisor tool (`advisor_20260301`, beta header `advisor-tool-2026-03-01`) is documented for the **Claude API** (https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool); it runs inside one `/v1/messages` request, needs API billing, and is not offered on Bedrock/Vertex/Foundry.
- The Claude Code subagent documentation (https://code.claude.com/docs/en/sub-agents, frontmatter table read in full) lists no advisor field or tool. **Native Advisor is not available to Claude Code subagents in this project**, and enabling it would mean external API calls and cost, which need CTO approval.
- Therefore no agent is labeled "Advisor", no model is secretly substituted, and no paid call is made.

Re-checked 2026-10-27 for PR #120: still no Advisor field or tool in the subagent frontmatter reference, and a headless Code Reviewer listed no Advisor tool. Status unchanged.

## Compliant fallback: CTO-reviewed advisory
When a consultation is warranted, the coordinator uses the `advisor-governance` skill to write a scoped advisory request (question, evidence paths, constraints, options). It is answered by an already-routed specialist at its own model (e.g. Solution Architect or Security Engineer) as a RECOMMENDATION, or taken to the CTO as a brief. The answering agent keeps its own model and turn limit.

## Levels
- **L0** none: routine status, straightforward edits, small docs.
- **L1** optional: uncertainty, ambiguous findings, repeated failed approaches.
- **L2** recommended: architecture, complex debugging, major design, model-behavior changes.
- **L3** required gate *when supported and authorized*: high-impact decisions, irreversible migrations, substantial security-boundary changes. If unsupported, record the gap and escalate to the CTO; never invent a result.

## Rules
- Advice is a recommendation. It cannot approve, merge, release, or satisfy a QA, Review or Security gate.
- No recursion, and no advisor that spawns agents.
- One scoped consultation per materially distinct decision; reuse valid advice; re-consult only after changed evidence or an unresolved blocker.
- No Advisor call per agent invocation, no extra Opus routing, no external billing without CTO authorization.
- Record each consultation (question, answerer, level, outcome) in the ledger.

Per-agent ceilings are in [AGENT-CATALOG](AGENT-CATALOG.md); every agent file points here.
