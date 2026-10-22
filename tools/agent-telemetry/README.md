# Falcon agent telemetry dashboard (developer tooling)

A local, read-only web dashboard that shows **observed** Claude Code activity:
sessions, subagents, their timeline, token usage, and subscription-limit
percentages. It is standalone developer tooling. It does not touch Falcon
product code, CI, agent definitions, model routing or the production-cycle
skill, and it never calls an AI model.

Everything it stores lives **outside the repository**, under `~/.claude-ops/`.
It is not wired into CI; run its tests locally (see Tests).

## What it shows, and where each number comes from

| Source | Provenance | Gives |
|---|---|---|
| Claude Code hooks (`hook.js`) | documented interface | session start/end, subagent start/stop, turn end, turn failure, tool name and tool failure |
| Statusline snapshots (`statusline/statusline.js`) | documented interface | 5-hour and 7-day usage %, context %, estimated cost |
| Transcript files under `~/.claude/projects` | **undocumented format**, read-only, numbers and model ids only | input, output, cache-write and cache-read tokens, observed model, per session and agent |
| `.claude/agents/*.md` | repository configuration | configured model per agent role |
| `.git/production-cycle/*/events.jsonl` | Phase 17 ledger, read-only | dispatch and review records (a dispatch record is **not** proof that an agent is running) |

Every panel is labelled with its source. Missing values show as `UNKNOWN`;
nothing is guessed. Cache reads are repeated reads of cached context: they are
**not** billed tokens and **not** subscription consumption. "Estimated cost" is
a client-side list-price estimate, not a Claude Pro charge. The 5-hour and 7-day
percentages are the only allowance data Claude Code reports.

## Security model

- **Localhost only.** The server binds to loopback (default `127.0.0.1`; `localhost` and
  `::1` are also accepted) and refuses any non-loopback host at startup. There is no TLS because it never leaves the machine.
- **Token authentication.** Localhost binding alone is not authentication: any
  local process or other user account can open a loopback port. `/api/state`
  therefore requires a bearer token, compared in constant time.
  - The token is created on first start in `~/.claude-ops/dashboard-token`
    (mode 0600, inside a 0700 directory). A token file that is not a regular,
    user-owned, owner-only file is replaced and never trusted; it is opened without
    following symlinks and judged and read through the same file handle.
  - Sign in by pasting the token into the page (`pbcopy < ~/.claude-ops/dashboard-token`)
    or by opening `http://127.0.0.1:47831/#token=...`. The token is read from the
    URL fragment (never sent to the server or in a `Referer`), kept for that tab
    only, and removed from the address bar; the browser may still keep the original
    URL in its history, so pasting is preferred. A token in the query string is refused.
  - The token is never logged or printed. Delete the file and restart to rotate it.
- **Browser protections.** The `Host` header must match exactly (blocks DNS
  rebinding), a foreign `Origin` is refused, only `GET`/`HEAD` are served, a
  strict Content-Security-Policy applies, and the UI inserts values as plain text
  (no `innerHTML`). Only fixed routes are served (the three UI files, an empty
  `/favicon.ico`, `/api/health` and `/api/state`); nothing from the URL is used as a
  file path.
- **What it does not protect against.** Any process running as **your** user can
  read the token file, the telemetry files and your transcripts directly. The
  token protects against other user accounts and other web pages, not against
  your own processes. The server has no rate limiting.
- **No prompts, no secrets.** The collector keeps a closed whitelist of fields.
  It never stores prompts, assistant text, tool input or output, environment
  values or full paths (only the project folder name and the transcript's project
  directory name). Telemetry files are mode 0600.
- Event rows written by older versions may contain an absolute transcript path
  (`tp`); they are still read but only after the file is confined to
  `~/.claude/projects`. `prune.js` removes old monthly files.

## Coverage

- **Claude Code Terminal: verified.** Real session start, turn end, session end,
  tool events and a real subagent lifecycle were observed from Terminal
  (`cli`) and non-interactive (`sdk-cli`) sessions.
- **Claude Desktop: UNVERIFIED.** Hooks and the statusline are configured in the
  shared user settings, so Desktop sessions may report events, but none has been
  observed. Do not assume coverage.
- **VS Code extension sessions: not verified.**
- Only activity that starts or continues after the hooks are installed is
  captured; there is no backfill.

## Known limitations

- **Orphan (stop-only) agent records.** Some `SubagentStop` events arrive for
  agents whose `SubagentStart` was never observed (hooks installed mid-run, or
  agents that do not fire a start hook). Their origin is not established. The
  dashboard shows them as **"Partial — stop observed"**, with duration `UNKNOWN`,
  and never as a confident completed agent. They are excluded from the
  "running" count and from every confident status filter.
- **Transcript format dependency.** Token counts and observed models are read
  from Claude Code's transcript files, whose format is not a documented
  interface. A Claude Code update can break the reader; the panels then show
  `UNKNOWN`. The statusline and hook panels do not depend on it.
- **Event loss is possible under heavy load.** The collector is fail-open by
  design: hooks run asynchronously with a 5 s timeout and an internal 1.5 s
  watchdog, and always exit 0 so they can never block Claude Code. Under extreme
  CPU contention a hook can exit before writing, so **not every event is
  guaranteed to be captured**. Treat the dashboard as observational, not as an
  audit log.
- **Stale vs ended.** A session with no events for 30 minutes is `stale`
  (liveness lost, termination not confirmed); only an observed `SessionEnd`
  makes it `ended`. Agents of a stale session are `unknown`; agents of an ended
  session without a stop event are labelled as *inferred* interrupted.
- Not exposed by documented hooks, so shown as UNKNOWN or omitted: nested
  subagent parentage (every agent's parent is its session), retries, and an
  agent's current task. The `SessionStart` payload's model was empty in
  observation; the UI falls back to the statusline's model id, labelled.
- Fixture rows: snapshot rows whose session id is not a UUID are ignored (and
  counted in the footer) unless the data directory carries a `SYNTHETIC` marker.

## Install, start, stop

```bash
# 1. Hooks (user level). Dry run first; --apply backs up ~/.claude/settings.json
node tools/agent-telemetry/install.js
node tools/agent-telemetry/install.js --apply        # add --no-tools to skip tool events

# 2. Statusline (manual; the installer does not edit the statusLine key)
mkdir -p ~/.claude-ops && cp tools/agent-telemetry/statusline/statusline.js ~/.claude-ops/statusline.js
#    then add to ~/.claude/settings.json:
#    "statusLine": { "type": "command", "command": "node /ABSOLUTE/PATH/.claude-ops/statusline.js" }

# 3. Start (foreground; Ctrl-C to stop) and sign in with the token
node tools/agent-telemetry/server.js                 # http://127.0.0.1:47831/
pbcopy < ~/.claude-ops/dashboard-token               # paste into the page

# Background start / stop
nohup node tools/agent-telemetry/server.js > ~/.claude-ops/server.log 2>&1 & echo $! > ~/.claude-ops/server.pid
kill "$(cat ~/.claude-ops/server.pid)"
```

`install.js --apply` copies the collector to `~/.claude-ops/runtime/` so it works
on any branch, then adds one async hook per event (SessionStart, SessionEnd,
SubagentStart, SubagentStop, Stop, StopFailure, PostToolUse, PostToolUseFailure).
Existing hooks and settings are preserved, running it twice changes nothing,
settings are written atomically keeping their mode, and an unparseable settings
file is never modified. Re-run `--apply` after changing `hook.js` or `lib/` to
refresh the runtime copy. The installer refuses a runtime path containing shell
metacharacters.

`install.js --status` reports whether the hooks are registered.
Options: `server.js --port N --repo DIR --data-dir DIR --host HOST` (HOST must be loopback); `seed-demo.js DIR`
writes clearly labelled SYNTHETIC events to a separate directory for a demo.

## Uninstall and rollback

```bash
node tools/agent-telemetry/install.js --remove       # removes only this tool's hooks
# remove the "statusLine" key you added from ~/.claude/settings.json
kill "$(cat ~/.claude-ops/server.pid)"
rm -rf ~/.claude-ops                                 # telemetry, runtime copy, token, backups
```

Every change to `~/.claude/settings.json` is preceded by a timestamped backup in
`~/.claude-ops/backups/pre-hooks/`; copy one back over `settings.json` to restore
the exact previous file. Telemetry is never deleted automatically.

## Retention

Nothing is deleted automatically. `node tools/agent-telemetry/prune.js
[--keep-months 6] [--apply]` (dry run by default) removes only monthly
`events-`/`snapshots-` files older than the cutoff.

## Statusline

`statusline/statusline.js` is the reviewable source of the user-level
statusline; the installed copy is `~/.claude-ops/statusline.js` (keep them in
sync with `cmp`). It prints one line from the documented statusline JSON, prints
`N/A` for missing fields, never prints paths, ids or prompt text, always exits 0
and never writes settings. While `~/.claude-ops/telemetry/` exists it also appends
one numeric-only snapshot row per refresh for the limits panel.

## Tests

```bash
node --test tools/agent-telemetry/test/*.test.js     # 62 tests
node tools/agent-telemetry/statusline/test-statusline.js   # 12 checks
```

Tests use temporary directories and never touch live telemetry or the token file.
