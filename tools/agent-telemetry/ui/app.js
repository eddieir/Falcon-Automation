"use strict";
// Falcon Agent Dashboard UI. Every value is inserted as plain text, never as
// markup. Unavailable data is rendered as UNKNOWN, never guessed.
(function () {
  var UNK = "UNKNOWN";
  var data = null;
  var lastOk = 0;
  var failures = 0;
  var tab = "overview";
  var denied = false;
  // Access token: arrives in the URL fragment (never sent to the server or in
  // Referer), is kept for this tab only, and is removed from the address bar.
  var TOKEN = null;
  try {
    var tm = /(?:^|[#&])token=([A-Za-z0-9_-]{32,128})/.exec(location.hash);
    if (tm) { TOKEN = tm[1]; try { sessionStorage.setItem("fad-token", TOKEN); } catch (e) { /* storage unavailable */ } history.replaceState(null, "", location.pathname); }
    else { try { TOKEN = sessionStorage.getItem("fad-token"); } catch (e) { TOKEN = null; } }
  } catch (e) { TOKEN = null; }
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function badge(status, label) { var b = el("span", "badge " + status, label || status); if (label) b.title = label; return b; }
  function statusBadge(x) { return badge(x.partial ? "unknown" : x.status, x.statusLabel || x.status); }
  function prov(text) { return el("span", "prov", text); }
  function short(id) { return id ? String(id).slice(0, 8) : UNK; }
  function num(n) {
    if (typeof n !== "number") return UNK;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e4) return Math.round(n / 1e3) + "k";
    return String(n);
  }
  function dur(ms) {
    if (typeof ms !== "number") return UNK;
    var s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m " + (s % 60) + "s";
    var h = Math.floor(m / 60);
    return h < 48 ? h + "h " + (m % 60) + "m" : Math.floor(h / 24) + "d";
  }
  function clock(iso) { if (!iso) return UNK; var d = new Date(iso); return isNaN(d) ? UNK : d.toLocaleTimeString([], { hour12: false }) + " " + d.toLocaleDateString([], { month: "short", day: "numeric" }); }
  function cell(tr, v, cls) { var td = el("td", cls || "", v === null || v === undefined ? UNK : v); if (v === null || v === undefined) td.className += " unknown-v"; tr.appendChild(td); return td; }
  function cellNode(tr, node) { var td = el("td"); td.appendChild(node); tr.appendChild(td); }

  function table(heads, rows) {
    var wrap = el("div", "tablewrap"), t = el("table"), thead = el("thead"), hr = el("tr");
    heads.forEach(function (h) { hr.appendChild(el("th", "", h)); });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = el("tbody"); rows.forEach(function (r) { tb.appendChild(r); }); t.appendChild(tb);
    wrap.appendChild(t); return wrap;
  }
  function tokenForm() {
    var box = el("div", "empty");
    box.appendChild(el("p", "", "Access token required. Paste the token from your token file (run: pbcopy < ~/.claude-ops/dashboard-token)."));
    var inp = el("input"); inp.type = "password"; inp.autocomplete = "off"; inp.placeholder = "access token"; inp.setAttribute("aria-label", "Access token"); inp.style.minWidth = "320px";
    var btn = el("button", "", "Sign in"); btn.style.marginLeft = "8px";
    function go() { var v = inp.value.trim(); if (!/^[A-Za-z0-9_-]{32,128}$/.test(v)) { inp.value = ""; inp.placeholder = "that does not look like a token"; return; } TOKEN = v; try { sessionStorage.setItem("fad-token", v); } catch (e) { /* storage unavailable */ } inp.value = ""; poll(); }
    btn.addEventListener("click", go); inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    add(box, inp, btn);
    return box;
  }
  function empty(msg) { return el("div", "empty", msg); }

  // ---- filtering -----------------------------------------------------------
  function filters() {
    return { q: $("q").value.trim().toLowerCase(), session: $("fSession").value, model: $("fModel").value, status: $("fStatus").value, win: Number($("fWindow").value), tools: $("fTools").checked };
  }
  function inWindow(f, iso) { return !f.win || !iso || data.now - Date.parse(iso) <= f.win; }
  function sessionModel(s) { return s.model || (s.snapshot && s.snapshot.model) || null; }
  function agentModels(a) { var m = []; if (a.configuredModel) m.push(a.configuredModel); (a.observedModels || []).forEach(function (x) { m.push(x); }); return m; }
  function sessionMatches(f, s) {
    if (f.session && s.sid !== f.session) return false;
    if (!inWindow(f, s.lastEventAt)) return false;
    if (f.model) { var ms = [sessionModel(s)].concat(s.usage && s.usage.main ? Object.keys(s.usage.main.models) : []); if (ms.indexOf(f.model) < 0 && !data.agents.some(function (a) { return a.sid === s.sid && agentModels(a).indexOf(f.model) >= 0; })) return false; }
    if (f.q) { var hay = [s.sid, s.project, s.entry, sessionModel(s)].join(" ").toLowerCase(); if (hay.indexOf(f.q) < 0 && !data.agents.some(function (a) { return a.sid === s.sid && agentHay(a).indexOf(f.q) >= 0; })) return false; }
    return true;
  }
  function agentHay(a) { return [a.aid, a.type, a.sid, a.lastTool, a.status].join(" ").toLowerCase(); }
  function agentMatches(f, a) {
    if (f.session && a.sid !== f.session) return false;
    if (f.status === "partial") { if (!a.partial) return false; }
    else if (f.status && (a.partial || a.status !== f.status)) return false; // partial records never pass as confident statuses
    if (!inWindow(f, a.lastEventAt)) return false;
    if (f.model && agentModels(a).indexOf(f.model) < 0) return false;
    if (f.q && agentHay(a).indexOf(f.q) < 0) return false;
    return true;
  }

  // ---- header --------------------------------------------------------------
  function renderHeader() {
    var lab = $("label"); lab.textContent = data ? data.dataLabel + " DATA" : "…"; lab.className = "badge " + (data ? data.dataLabel : "");
    var dot = $("dot"), up = $("updated"), b = $("banner");
    if (denied) { b.hidden = false; b.textContent = "Access denied: the dashboard needs its access token. Paste the token from your 0600 token file below."; }
    if (!data) { dot.className = "dot"; up.textContent = denied ? "access token required" : "connecting…"; if (!denied) b.hidden = true; return; }
    var age = Math.max(0, Math.round((Date.now() - lastOk) / 1000));
    dot.className = "dot " + (failures ? "bad" : "ok");
    up.textContent = failures ? "disconnected — showing data from " + age + "s ago" : "live · updated " + age + "s ago";
    if (failures && !denied) { b.hidden = false; b.textContent = "Cannot reach the local dashboard server. Showing the last data received. Retrying every 3 seconds."; }
    else if (!denied && data.dataLabel === "SYNTHETIC") { b.hidden = false; b.textContent = "SYNTHETIC DEMO DATA — generated test events, not real Claude Code activity."; }
    else if (!denied) b.hidden = true;
  }

  function renderLimits() {
    var box = $("limits"); box.textContent = "";
    var l = data.limits;
    function meter(name, pct, reset) {
      var c = el("div", "card"); c.style.minWidth = "230px";
      var expired = typeof reset === "number" && reset * 1000 < data.now;
      add(c, el("span", "", name + " usage"), prov("statusline"));
      var b = el("b", "", typeof pct === "number" && !expired ? Math.round(pct) + "%" : (expired ? "reset since" : UNK));
      c.appendChild(b);
      var m = el("div", "meter"), i = el("i"); i.style.width = (typeof pct === "number" && !expired ? Math.min(100, pct) : 0) + "%"; if (pct >= 80) i.className = "hot"; m.appendChild(i); c.appendChild(m);
      c.appendChild(el("span", "", typeof reset === "number" ? "resets " + clock(new Date(reset * 1000).toISOString()) : "reset time " + UNK));
      return c;
    }
    if (!l) { var c = el("div", "card"); c.style.minWidth = "320px"; add(c, el("span", "", "5-hour / 7-day usage"), prov("statusline"), el("b", "unknown-v", UNK)); c.appendChild(el("span", "", "No statusline snapshot yet (Claude Pro/Max sessions report it after the first reply).")); box.appendChild(c); return; }
    box.appendChild(meter("5-hour", l.h5Pct, l.h5Reset));
    box.appendChild(meter("7-day", l.d7Pct, l.d7Reset));
    var n = el("div", "card"); n.style.minWidth = "230px";
    add(n, el("span", "", "Snapshot age"), el("b", "", dur(data.now - Date.parse(l.at))), el("span", "", "latest statusline refresh; account-wide percentages"));
    box.appendChild(n);
  }

  function renderCards() {
    var box = $("cards"); box.textContent = "";
    var st = data.stats;
    [["Active sessions", st.activeSessions], ["Running agents", st.runningAgents], ["Max concurrent agents", st.maxConcurrentAgents], ["Partial agent records", st.partialAgents], ["Events recorded", st.events], ["Duplicates ignored", st.duplicates]].forEach(function (x) {
      var c = el("div", "card"); add(c, el("b", "", num(x[1])), el("span", "", x[0])); box.appendChild(c);
    });
  }

  function populateFilters() {
    var s = $("fSession"), m = $("fModel"), cs = s.value, cm = m.value;
    var sids = data.sessions.map(function (x) { return x.sid; });
    s.textContent = ""; s.appendChild(new Option("All sessions", ""));
    data.sessions.forEach(function (x) { s.appendChild(new Option(short(x.sid) + " · " + (x.project || UNK) + " · " + x.status, x.sid)); });
    if (sids.indexOf(cs) >= 0) s.value = cs;
    var models = {};
    data.sessions.forEach(function (x) { if (sessionModel(x)) models[sessionModel(x)] = 1; if (x.usage && x.usage.main) Object.keys(x.usage.main.models).forEach(function (k) { models[k] = 1; }); });
    data.agents.forEach(function (a) { agentModels(a).forEach(function (k) { models[k] = 1; }); });
    m.textContent = ""; m.appendChild(new Option("All models", ""));
    Object.keys(models).sort().forEach(function (k) { m.appendChild(new Option(k, k)); });
    if (models[cm]) m.value = cm;
  }

  // ---- views ---------------------------------------------------------------
  function usageText(u) { return u ? "in " + num(u.input) + " · out " + num(u.output) + " · cw " + num(u.cacheWrite) + " · cr " + num(u.cacheRead) : UNK; }

  function viewOverview(f) {
    var root = el("div");
    var sessions = data.sessions.filter(function (s) { return sessionMatches(f, s); });
    var agents = data.agents.filter(function (a) { return agentMatches(f, a); });
    if (!data.sessions.length) {
      root.appendChild(empty("No Claude Code sessions observed yet. Hooks record new activity from the moment they are installed — start or continue a Claude Code session and it will appear here within a few seconds."));
      return root;
    }
    add(root, add(el("h2", "", "Sessions"), prov("hooks")));
    var srows = sessions.map(function (s) {
      var tr = el("tr");
      cell(tr, short(s.sid) + " · " + (s.project || UNK));
      cell(tr, s.entry); cellNode(tr, statusBadge(s)); cell(tr, sessionModel(s) ? sessionModel(s) + (s.model ? "" : " (statusline)") : null);
      cell(tr, s.startObserved ? clock(s.startedAt) : clock(s.firstEventAt) + " (start not observed)");
      cell(tr, dur(s.elapsedMs)); cell(tr, s.lastEvent + " · " + clock(s.lastEventAt));
      cell(tr, data.agents.filter(function (a) { return a.sid === s.sid; }).length, "num");
      cell(tr, s.toolCount, "num");
      cell(tr, s.snapshot && typeof s.snapshot.ctxPct === "number" ? Math.round(s.snapshot.ctxPct) + "%" : null);
      return tr;
    });
    root.appendChild(srows.length ? table(["Session", "Entry", "Status", "Model", "Started", "Elapsed", "Latest event", "Agents", "Tools", "Context"], srows) : empty("No sessions match the filters."));
    add(root, add(el("h2", "", "Agents"), prov("hooks"), prov("agent definitions"), prov("transcript")));
    var arows = agents.map(function (a) {
      var tr = el("tr");
      cell(tr, short(a.aid)); cell(tr, a.type); cell(tr, "session " + short(a.sid));
      cell(tr, a.configuredModel); cell(tr, a.observedModels && a.observedModels.length ? a.observedModels.join(", ") : null);
      cell(tr, a.startObserved ? clock(a.startedAt) : "not observed (first seen " + clock(a.firstEventAt) + ")");
      cell(tr, dur(a.elapsedMs));
      cellNode(tr, statusBadge(a));
      cell(tr, a.lastTool ? "last tool: " + a.lastTool : a.lastEvent);
      cell(tr, usageText(a.usage));
      return tr;
    });
    root.appendChild(arows.length ? table(["Agent", "Role", "Parent", "Configured model", "Observed model", "Started", "Elapsed", "Status", "Latest action", "Tokens (transcript)"], arows) : empty(data.agents.length ? "No agents match the filters." : "No subagents have been started in the observed sessions."));
    root.appendChild(el("p", "note", "“Partial” = the agent's start was never observed (orphan stop or hooks installed mid-run); its duration and role stay UNKNOWN and it is never shown as a confident completed/running agent. “stale” = no events for 30 minutes (liveness lost, termination NOT confirmed); “ended” = SessionEnd was observed. Parent is the owning session. Nested subagent parents are not exposed by documented hook fields. cw = cache write, cr = cache read."));
    return root;
  }

  function viewHierarchy(f) {
    var root = el("div");
    var sessions = data.sessions.filter(function (s) { return sessionMatches(f, s); });
    if (!sessions.length) { root.appendChild(empty(data.sessions.length ? "No sessions match the filters." : "No sessions observed yet.")); return root; }
    var ul = el("ul", "tree");
    sessions.forEach(function (s) {
      var li = el("li"), node = el("div", "node main");
      add(node, el("strong", "", "Main session " + short(s.sid)), statusBadge(s), el("span", "mute", (s.project || UNK) + " · " + (sessionModel(s) || UNK) + " · " + (s.entry || UNK)));
      li.appendChild(node);
      var kids = data.agents.filter(function (a) { return a.sid === s.sid && agentMatches(f, a); });
      if (kids.length) {
        var sub = el("ul");
        kids.forEach(function (a) {
          var overlap = kids.filter(function (b) { return b !== a && overlaps(a, b); }).length;
          var k = el("li"), n = el("div", "node");
          add(n, el("strong", "", a.type || UNK), el("span", "mute", short(a.aid)), statusBadge(a), el("span", "mute", a.configuredModel || UNK), overlap ? el("span", "par", "∥ concurrent with " + overlap) : null);
          k.appendChild(n); sub.appendChild(k);
        });
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
    root.appendChild(ul);
    root.appendChild(el("p", "note", "Edges mean “owned by session” (hooks). Concurrency (∥) is computed from observed start/stop times. A coordinator's dispatch in the ledger is not shown here as a running agent."));
    return root;
  }
  function span(a) { var s = a.startedAt ? Date.parse(a.startedAt) : Date.parse(a.firstEventAt); var e = a.stoppedAt ? Date.parse(a.stoppedAt) : a.status === "running" ? data.now : Date.parse(a.lastEventAt); return [s, e]; }
  function overlaps(a, b) { var x = span(a), y = span(b); return x[0] < y[1] && y[0] < x[1]; }

  function viewTimeline(f) {
    var root = el("div");
    var sessions = data.sessions.filter(function (s) { return sessionMatches(f, s); });
    if (!sessions.length) { root.appendChild(empty("No sessions in this window.")); return root; }
    var end = data.now, start = f.win ? end - f.win : Infinity;
    if (!f.win) sessions.forEach(function (s) { start = Math.min(start, Date.parse(s.startedAt || s.firstEventAt)); });
    var total = Math.max(1, end - start);
    function seg(track, s, e, cls, title) {
      if (e < start) return;
      var l = Math.max(0, (s - start) / total) * 100, r = Math.min(1, (e - start) / total) * 100;
      var d = el("div", "seg " + cls); d.style.left = l + "%"; d.style.width = Math.max(0.3, r - l) + "%"; d.title = title; track.appendChild(d);
    }
    add(root, el("h2", "", "Session and agent lanes"));
    sessions.forEach(function (s) {
      var lane = el("div", "lane"), lbl = el("div", "lbl", "session " + short(s.sid)), tr = el("div", "track");
      var ss = Date.parse(s.startedAt || s.firstEventAt), se = s.endedAt ? Date.parse(s.endedAt) : s.status === "active" ? end : Date.parse(s.lastEventAt);
      seg(tr, ss, se, "session", "session " + s.status + " · " + dur(se - ss));
      add(lane, lbl, tr); root.appendChild(lane);
      data.agents.filter(function (a) { return a.sid === s.sid && agentMatches(f, a); }).forEach(function (a) {
        var l2 = el("div", "lane"), t2 = el("div", "track"), sp = span(a);
        seg(t2, sp[0], sp[1], a.partial ? "unknown" : a.status, (a.type || UNK) + " · " + (a.statusLabel || a.status) + " · " + (a.partial ? "duration UNKNOWN" : dur(sp[1] - sp[0])));
        add(l2, el("div", "lbl", "  ↳ " + (a.type || UNK) + " " + short(a.aid) + (a.partial ? " (partial)" : "")), t2); root.appendChild(l2);
      });
    });
    var ax = el("div", "axis"); add(ax, el("span", "", clock(new Date(start).toISOString())), el("span", "", "now")); root.appendChild(ax);
    add(root, add(el("h2", "", "Events"), prov("hooks")));
    var rows = data.timeline.filter(function (t) {
      if (t.kind === "tool" && !f.tools) return false;
      if (f.session && t.sid !== f.session) return false;
      if (f.win && data.now - Date.parse(t.ts) > f.win) return false;
      if (f.q && [t.label, t.detail, t.aid, t.sid].join(" ").toLowerCase().indexOf(f.q) < 0) return false;
      return true;
    }).slice(-300).reverse().map(function (t) {
      var tr = el("tr"); cell(tr, clock(t.ts)); cell(tr, t.kind); cell(tr, "session " + short(t.sid)); cell(tr, t.aid ? short(t.aid) : "—"); cell(tr, t.label); cell(tr, t.detail || "—"); return tr;
    });
    root.appendChild(rows.length ? table(["Time", "Kind", "Session", "Agent", "Event", "Detail"], rows) : empty("No events in this window."));
    root.appendChild(el("p", "note", "Retries are not exposed by hooks and are not shown here. Errors come from StopFailure and PostToolUseFailure hooks. Enable “tool events” to include successful tool calls (name only)."));
    return root;
  }

  function viewUsage(f) {
    var root = el("div");
    var sessions = data.sessions.filter(function (s) { return sessionMatches(f, s); });
    add(root, add(el("h2", "", "By session"), prov("statusline"), prov("transcript (undocumented format)")));
    var rows = sessions.map(function (s) {
      var tr = el("tr"), u = s.usage && s.usage.main, sn = s.snapshot;
      cell(tr, short(s.sid)); cell(tr, sn && typeof sn.ctxPct === "number" ? Math.round(sn.ctxPct) + "% of " + num(sn.ctxSize) : null);
      cell(tr, sn && typeof sn.estCostUsd === "number" ? "$" + sn.estCostUsd.toFixed(2) : null);
      cell(tr, u ? num(u.input) : null, "num"); cell(tr, u ? num(u.output) : null, "num"); cell(tr, u ? num(u.cacheWrite) : null, "num"); cell(tr, u ? num(u.cacheRead) : null, "num");
      cell(tr, u ? Object.keys(u.models).join(", ") : null);
      return tr;
    });
    root.appendChild(rows.length ? table(["Session", "Context (statusline)", "Est. API-equivalent cost", "Input", "Output", "Cache write", "Cache read", "Models (main conversation)"], rows) : empty("No sessions in view."));
    add(root, el("h2", "", "By agent"));
    var ar = data.agents.filter(function (a) { return agentMatches(f, a); }).map(function (a) {
      var tr = el("tr"), u = a.usage;
      cell(tr, (a.type || UNK) + " " + short(a.aid)); cell(tr, u ? num(u.input) : null, "num"); cell(tr, u ? num(u.output) : null, "num"); cell(tr, u ? num(u.cacheWrite) : null, "num"); cell(tr, u ? num(u.cacheRead) : null, "num"); cell(tr, u ? Object.keys(u.models).join(", ") : null); return tr;
    });
    root.appendChild(ar.length ? table(["Agent", "Input", "Output", "Cache write", "Cache read", "Observed model(s)"], ar) : empty("No agents in view."));
    add(root, el("h2", "", "By model (sessions and agents in view)"));
    var byModel = {};
    function acc(u) { if (!u) return; Object.keys(u.models).forEach(function (m) { var t = byModel[m] || (byModel[m] = { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }); var x = u.models[m]; t.calls += x.calls; t.input += x.input; t.output += x.output; t.cacheWrite += x.cacheWrite; t.cacheRead += x.cacheRead; }); }
    sessions.forEach(function (s) { acc(s.usage && s.usage.main); });
    data.agents.filter(function (a) { return agentMatches(f, a); }).forEach(function (a) { acc(a.usage); });
    var mr = Object.keys(byModel).sort().map(function (m) { var t = byModel[m], tr = el("tr"); cell(tr, m); cell(tr, t.calls, "num"); cell(tr, num(t.input), "num"); cell(tr, num(t.output), "num"); cell(tr, num(t.cacheWrite), "num"); cell(tr, num(t.cacheRead), "num"); return tr; });
    root.appendChild(mr.length ? table(["Model", "API calls", "Input", "Output", "Cache write", "Cache read"], mr) : empty("No transcript usage loaded yet."));
    root.appendChild(el("p", "note", "Token counts are raw per-call sums read from local transcripts (a format Claude Code does not document), deduplicated by message id. Cache reads are repeated reads of cached context: they are NOT billed tokens and NOT subscription consumption. The 5-hour/7-day percentages above are the only allowance data Claude Code reports. “Est. API-equivalent cost” is a client-side list-price estimate, not a Claude Pro charge. Usage covers sessions active in the last 7 days."));
    return root;
  }

  function viewLedger(f) {
    var root = el("div"), L = data.ledger;
    add(root, add(el("h2", "", "Production-cycle ledger"), prov("ledger (read-only)")));
    root.appendChild(el("p", "note", "Ledger entries are the coordinator's records. A dispatch entry is not proof that an agent is running; use the Overview tab for observed activity."));
    if (!L || !L.available) { root.appendChild(empty("No production-cycle ledger found for the configured repository.")); return root; }
    if (!L.runs.length) { root.appendChild(empty("The ledger directory contains no runs.")); return root; }
    L.runs.forEach(function (r) {
      add(root, el("h2", "", r.runId + " · " + r.total + " events" + (r.bad ? " · " + r.bad + " unreadable" : "") + " · last " + clock(r.lastTs)));
      var rows = r.events.filter(function (e) { return !f.q || JSON.stringify(e).toLowerCase().indexOf(f.q) >= 0; }).slice(-25).reverse().map(function (e) {
        var tr = el("tr"); cell(tr, e.seq, "num"); cell(tr, clock(e.ts)); cell(tr, e.type); cell(tr, e.phase); cell(tr, e.taskId); cell(tr, (e.fromRole || "—") + " → " + (e.toRole || "—")); cell(tr, e.resolvedModelId); cell(tr, e.status || e.verdict); cell(tr, e.summary); return tr;
      });
      root.appendChild(rows.length ? table(["Seq", "Time", "Type", "Phase", "Task", "Roles", "Resolved model", "Status", "Summary"], rows) : empty("No matching events."));
    });
    return root;
  }

  var VIEWS = { overview: viewOverview, hierarchy: viewHierarchy, timeline: viewTimeline, usage: viewUsage, ledger: viewLedger };

  function render() {
    renderHeader();
    var main = $("main");
    if (!data) { main.textContent = ""; if (denied) { main.appendChild(tokenForm()); return; }
    main.appendChild(empty(failures ? "Cannot reach the local dashboard server." : "Loading…")); return; }
    renderLimits(); renderCards(); populateFilters();
    main.textContent = "";
    main.appendChild(VIEWS[tab](filters()));
    var h = data.health;
    $("foot").textContent = "Sources: hooks (documented) · statusline snapshots (documented) · transcripts (undocumented format) · agent definitions · ledger. Event files " + h.eventFiles + " · unreadable lines " + h.badLines + " · collector errors " + h.collectorErrors + ". Localhost only; read-only.";
  }

  function poll() {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 5000);
    fetch("/api/state", { signal: ctl.signal, cache: "no-store", headers: TOKEN ? { Authorization: "Bearer " + TOKEN } : {} }).then(function (r) { if (r.status === 401) { denied = true; throw new Error("denied"); } if (!r.ok) throw new Error("http " + r.status); return r.json(); }).then(function (j) { data = j; lastOk = Date.now(); failures = 0; denied = false; }).catch(function () { failures++; }).then(function () { clearTimeout(t); render(); });
  }

  document.querySelectorAll("#tabs button").forEach(function (b) { b.addEventListener("click", function () { tab = b.getAttribute("data-tab"); document.querySelectorAll("#tabs button").forEach(function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); }); render(); }); });
  ["q", "fSession", "fModel", "fStatus", "fWindow", "fTools"].forEach(function (id) { $(id).addEventListener("input", render); $(id).addEventListener("change", render); });
  setInterval(poll, 3000);
  setInterval(renderHeader, 1000);
  poll();
})();
