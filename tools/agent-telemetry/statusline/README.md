# Statusline (reviewable copy)

`statusline.js` is the source of the user-level statusline. The **installed**
runtime copy is `~/.claude-ops/statusline.js`, registered through the
`statusLine` key in `~/.claude/settings.json`; this directory is the reviewable,
sanitized source and its tests. Keep them in sync with:

    cmp tools/agent-telemetry/statusline/statusline.js ~/.claude-ops/statusline.js
    cp  tools/agent-telemetry/statusline/statusline.js ~/.claude-ops/statusline.js   # to deploy

Test: `node tools/agent-telemetry/statusline/test-statusline.js` (fixtures only,
never writes to real telemetry; no network).

It prints one line from documented statusline JSON, prints N/A for missing
fields, never prints paths, ids or prompt text, and always exits 0.
When `~/.claude-ops/telemetry/` exists it also appends one numeric-only
snapshot row (plus the session id) for the dashboard's limits panel.
