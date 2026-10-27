# Claude Pro efficiency design

- Default: one coordinator, zero subagents until needed, at most two concurrent specialists, no nested spawning, at most one retry per task, no background research, no always-on executives, no automatic model escalation. The 27-role catalog does not raise any ceiling.
- Models: existing assignments are preserved. New roles use the lowest suitable model from the IDs already in the `CLAUDE.md` table: Haiku for narrow analysis (UX, data, privacy, customer validation, marketing), Sonnet for design and engineering analysis, Sonnet 5.5 only for the Chief Architect. Opus stays reserved for the Security Engineer. Fable is prohibited. New agents are read-only (no Edit/Write; most also lack Bash) and capped at 8 turns.
- Effective model: verify from runtime metadata at each role's first real dispatch and record it in the ledger. This change dispatched no agent to verify new roles' models, so those are **unverified**; a blocked verification blocks acceptance of that agent's output.
- Skills are lazy; the `skills:` agent field (full preload) is not used.
- Context: pass task/result packets with evidence paths ([AGENT-ROUTING](AGENT-ROUTING.md)); do not re-verify evidence another role already produced for the same revision.
- Budget exhaustion: write a checkpoint (`npm run production:checkpoint`), mark pending gates pending, never change routes silently or waive review, resume from the checkpoint.
- No token or cost figures are claimed; none were measured.
