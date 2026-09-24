# Claude Code Production House for Falcon

This repository includes a role-based delivery system for Claude Code. It separates product decisions, implementation, independent verification, operational readiness, and release approval so that one context does not both create and certify a change.

## 1. Prerequisites

1. Install current Claude Code.
2. Clone the repository and enter its root.
3. Install dependencies:

```bash
npm ci
npx playwright install --with-deps chromium
cp .env.example .env
```

4. Start Claude Code from the repository root:

```bash
claude
```

5. Run `/context` and confirm the root `CLAUDE.md` is loaded.
6. If the agent files were added while Claude Code was already open and the `.claude/agents` directory did not previously exist, restart Claude Code.

Project agents live in `.claude/agents/` and are version-controlled. Their short descriptions let Claude delegate automatically; their detailed role instructions load only when invoked.

## 2. Team

| Agent | Owns | Must not own |
|---|---|---|
| production-director | orchestration, gates, conflict routing | self-approval |
| product-manager | problem, users, outcome, metrics | technical design |
| product-owner | scope, priority, acceptance criteria | implementation |
| project-manager | sequence, dependencies, risks, status | product priority |
| solution-architect | boundaries, interfaces, failure modes, ADRs | release approval |
| developer | scoped implementation and focused tests | independent acceptance |
| qa-engineer | risk-based verification and defect verdict | changing requirements |
| security-engineer | threats, findings, security verdict | risk acceptance |
| devops-engineer | CI, runtime, config, artifacts, operability | product scope |
| code-reviewer | independent diff review | editing during review |
| technical-writer | accurate user/operator documentation | inventing behavior |
| release-manager | evidence-based GO/NO-GO | implementing fixes |

## 3. Normal use

Start a full cycle explicitly:

```text
/production-cycle Add review and approval for Tier-3 AI-healed selectors before they are reused.
```

The skill is intentionally user-invoked so a casual question does not trigger a full production process. Claude coordinates the appropriate specialists and scales the depth to the risk.

You can also call a specialist directly:

```text
Use the product-owner agent to write acceptance criteria for locator approval.
Use the qa-engineer agent to verify the current branch against AC-01 through AC-08.
Use the code-reviewer agent to review this branch against main.
```

An @-mention guarantees one agent runs:

```text
@agent-security-engineer review the dashboard authentication changes
```

Run an entire session as one role:

```bash
claude --agent qa-engineer
claude --agent solution-architect
```

Use a role session for focused work; use `/production-cycle` when handoffs and gates matter.

## 4. Detailed feature example

Prompt:

```text
/production-cycle Add human approval for AI-healed locators. An LLM suggestion must remain pending until approved, rejected suggestions must not be reused, and the existing no-key fallback must remain unchanged.
```

Expected flow:

1. Product Manager defines the trust problem and success measures, such as approval rate, false-heal rate, and time to review.
2. Product Owner creates AC IDs for pending, approve, reject, reuse, missing-key, persistence, CLI, and report behavior.
3. QA challenges every criterion for observability and prepares negative paths.
4. Project Manager sequences store/schema, CLI, runtime integration, tests, docs, and CI.
5. Architect selects state transitions and migration/rollback behavior.
6. Security reviews poisoning, untrusted selector content, secret leakage, and authorization boundaries.
7. Developer implements only the accepted slice and supplies focused evidence.
8. QA executes traceability and regression; Code Reviewer independently inspects the diff.
9. DevOps checks CI, artifacts, environment, and exit-code propagation.
10. Technical Writer updates commands and behavior.
11. Release Manager issues GO, CONDITIONAL GO, or NO-GO.

## 5. Detailed bug example

Prompt:

```text
/production-cycle Fix the dashboard socket limiter's unbounded per-IP state without changing authorized connection behavior.
```

Use the small-bug fast path:
1. Product Owner writes observable acceptance criteria, including pruning and behavior preservation.
2. Architect confirms lifecycle and cleanup boundaries.
3. Developer first adds a deterministic regression test, proves it fails, implements the fix, and reruns it.
4. QA verifies valid/invalid token behavior, rate limiting, pruning, cleanup, and process exit.
5. Security reviews bypass and denial-of-service cases.
6. Code Reviewer checks the entire diff.
7. Release Manager decides from evidence.

## 6. Evidence packet

Every non-trivial handoff should keep this structure:

```markdown
### Scope
- Story:
- Acceptance criteria:
- Non-goals:

### Change
- Files:
- Design decision:
- Migration/rollback:

### Evidence
- Command:
- Result:
- AC mapping:

### Review
- QA:
- Code review:
- Security:
- DevOps:

### Risk
- Known:
- Accepted by:
- Remaining action:
```

Never use "all tests pass" without the command, result, and environment. Never mark a skipped DB path as exercised. For hosted CI behavior, link or name the actual GitHub Actions run.

## 7. Falcon gate matrix

| Change | Required minimum |
|---|---|
| Documentation only | command/link consistency review |
| Local core logic | focused regression + relevant unit checks |
| Selector/browser behavior | regression + Playwright browser suite |
| Dashboard/auth/network | unit/regression + real HTTP/socket checks + security review |
| DB/config | missing-config path + configured PostgreSQL path in CI |
| CI workflow | YAML/script review + actual Actions run |
| OpenAI/healing | no-key path + mocked/deterministic path + trust/security review |
| Release candidate | relevant scenario suites, autonomous pipeline, CI, docs, rollback |

Run narrow checks early for speed. Run the full gate that matches risk before release.

## 8. Handling failures

- Ambiguous scope: Product Owner decides or escalates to the human.
- Architecture conflict: Architect supplies tradeoffs; Product Owner confirms scope impact.
- Failed test: QA records reproducible evidence; Developer fixes; QA retests.
- Security P0/P1: release is blocked; only the human can accept risk.
- CI-only failure: DevOps analyzes logs and environment; do not dismiss it because local tests pass.
- Documentation mismatch: verified implementation and acceptance criteria are authoritative; update docs before GO.
- Missing evidence: status is UNKNOWN, never PASS.

## 9. Keeping the team effective

- Keep agent descriptions short; detailed instructions belong inside the agent files.
- Avoid overlapping edits from concurrent agents.
- Review and evolve prompts when they produce repeated false positives or miss defects.
- Keep `CLAUDE.md` concise and repository-specific.
- Use `/doctor` if Claude Code reports duplicate agents or configuration problems.
- Use `/context` to verify loaded project instructions.
- Product and architecture artifacts can live in an issue/PR for normal work; create repository documents only for durable decisions.
- Agents recommend; the repository owner authorizes merges, deployments, destructive actions, credential rotation, and risk acceptance.

## 10. Completion checklist

- [ ] Product outcome and non-goals are explicit.
- [ ] Acceptance criteria have unique IDs and observable evidence.
- [ ] Delivery dependencies and risks have owners.
- [ ] Architecture/failure/rollback decisions are recorded.
- [ ] Implementation is scoped and has focused tests.
- [ ] QA independently traced every Must-have AC.
- [ ] Code review has no unresolved blocker or major finding.
- [ ] Security and DevOps reviews are complete when applicable.
- [ ] Documentation matches verified behavior.
- [ ] Release Manager recorded a decision.
- [ ] The human owner has the exact next action.
