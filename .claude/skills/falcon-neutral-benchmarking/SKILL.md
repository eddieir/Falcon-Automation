---
name: falcon-neutral-benchmarking
description: Checklist for reviewing a Falcon benchmark or comparison claim against the neutral competitive benchmark protocol. Use before any performance, accuracy or competitor-comparison claim is accepted or published.
---

# Neutral benchmarking

Authority: `docs/research/competitive-benchmark-protocol.md` (rules, metrics, workloads) and `scripts/benchmark/competitive-score.js`. This skill is a checklist over them, not a second protocol.

## Use when
A claim compares tools, reports healing precision, false-green or unsafe-action rate, or changes under `scripts/benchmark`, `docs/research/competitive-*`, or `docs/benchmarks`.

## Inputs
The claim, run manifest paths, tool versions, scorer output.

## Steps
1. Same workloads, fixture revision, machine class and browser for every tool; local `127.0.0.1` fixtures only.
2. Automated and assisted runs are not pooled; `NOT_TESTED` tools are excluded from denominators, never scored zero.
3. At least 3 distinct runs where behavior can vary; no significance claim from fewer; every rate shows numerator and denominator; zero denominator is N/A.
4. Scoring definitions are unchanged from the protocol version cited (diff them).
5. Map each public wording to a result and to `docs/CAPABILITY-TRUTH-TABLE.md`; reject best/first/only wording without evidence.

## Output
Verdict (SUPPORTED / SUPPORTED WITH LIMITS / UNSUPPORTED), uncertainty statement, the reproduction command.

## Safety
Never alter scoring to favor Falcon; no uncontrolled third-party sites in CI; no paid trials without a separate owner decision.

## Verification
Re-run the scorer on the cited manifest and compare numbers.

Roles: Benchmark & Evaluation Engineer; Technical Product Marketing (read-only consumer).
