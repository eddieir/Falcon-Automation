/**
 * src/production-cycle/Server.js — loopback-only read-only dashboard HTTP
 * server for the production-cycle ledger (ADR-0018 section 7, amended by
 * Sec-00b-dashboard-requirements D-07/D-08/D-09/D-11/D-12/D-13/D-17/D-18/
 * D-19/D-21). node:http only, no third-party deps.
 */

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const url = require("node:url");

const EventReader = require("./EventReader");
const RunPaths = require("./RunPaths");
const Schema = require("./EventSchema");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MAX_EVENTS_PER_RESPONSE = 500;
const RATE_LIMIT_PER_MIN = 600;
const RATE_BUCKET_CAPACITY = RATE_LIMIT_PER_MIN;
const RATE_REFILL_PER_MS = RATE_LIMIT_PER_MIN / 60000;

const QUERY_ALLOWLIST = new Set(["from", "limit"]);
const FORBIDDEN_QUERY_KEYS = new Set(["run", "path", "file"]);

function jsonError(res, status, code, extraHeaders) {
  const headers = Object.assign({}, extraHeaders);
  sendJson(res, status, { error: code }, headers);
}

function sendJson(res, status, bodyObj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(bodyObj), "utf8");
  const headers = Object.assign(
    {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,
    },
    extraHeaders
  );
  res.writeHead(status, headers);
  res.end(body);
}

function securityHeaders(nonce) {
  return {
    "Content-Security-Policy":
      "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
      "form-action 'none'; img-src 'none'; font-src 'none'; media-src 'none'; connect-src 'self'; " +
      `script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; require-trusted-types-for 'script'`,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "geolocation=(), camera=(), microphone=(), usb=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
}

function fallbackHtml(nonce) {
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    `<title>Falcon production-cycle dashboard (fallback)</title>` +
    `<script nonce="${nonce}">/* fallback: ui/index.html not yet built */</script>` +
    `<style nonce="${nonce}">body{font-family:monospace}</style>` +
    "</head><body><h1>Production-cycle dashboard (fallback view)</h1>" +
    "<p>This is a minimal fallback page. The full UI has not been built yet.</p>" +
    "</body></html>"
  );
}

class TokenBucket {
  constructor(capacity, refillPerMs, now) {
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.tokens = capacity;
    this.last = now();
  }

  take(now) {
    const t = now();
    const elapsed = Math.max(0, t - this.last);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

function parseHostHeader(hostHeader) {
  if (typeof hostHeader !== "string" || hostHeader.length === 0) return null;
  // IPv6 literal form: [::1]:port
  if (hostHeader.startsWith("[")) {
    const closeIdx = hostHeader.indexOf("]");
    if (closeIdx === -1) return null;
    return hostHeader.slice(0, closeIdx + 1);
  }
  const idx = hostHeader.lastIndexOf(":");
  if (idx === -1) return hostHeader;
  return hostHeader.slice(0, idx);
}

/**
 * Build the allowed Host header values for the given bound port.
 */
function buildHostAllowlist(port) {
  return new Set([
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    `[::1]:${port}`,
  ]);
}

function sameOrigin(originHeader, hostHeader) {
  try {
    const originUrl = new url.URL(originHeader);
    const originHostPort = originUrl.port
      ? `${originUrl.hostname}:${originUrl.port}`
      : originUrl.hostname;
    return originHostPort === hostHeader || `${originHostPort}` === hostHeader;
  } catch {
    return false;
  }
}

/**
 * Build server state: reads ledger via EventReader, tracks dev/ino.
 */
function makeLedgerState(eventsPath) {
  return {
    eventsPath,
    lastStatKey: null,
    cached: {
      events: [],
      malformed: [],
      partialBytes: 0,
      lastSeq: 0,
      tampered: false,
      present: false,
      refusedCount: 0,
    },
  };
}

function refreshLedger(state, runPathsInfo) {
  let st;
  try {
    st = fs.lstatSync(state.eventsPath);
  } catch {
    state.cached = {
      events: [],
      malformed: [],
      partialBytes: 0,
      lastSeq: 0,
      tampered: false,
      present: false,
      refusedCount: 0,
      fileSize: 0,
    };
    state.lastStatKey = null;
    return { ok: true };
  }

  if (st.isSymbolicLink()) {
    return { ok: false, code: "EVENTS_SYMLINK" };
  }

  const statKey = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`;
  if (statKey === state.lastStatKey) {
    return { ok: true };
  }

  // Re-validate the run dir / events path every time the underlying file
  // identity changes (D-07): dev/ino swap must be caught before serving.
  if (state.lastStatKey !== null && runPathsInfo) {
    const revalidated = RunPaths.resolveRunDir(runPathsInfo.ledgerRoot, runPathsInfo.runId);
    if (!revalidated.ok) {
      return { ok: false, code: "EVENTS_REVALIDATION_FAILED" };
    }
  }

  const result = EventReader.readAll(state.eventsPath);
  if (!result.ok) {
    return { ok: false, code: result.errorCode };
  }

  state.lastStatKey = statKey;
  state.cached = {
    events: result.events,
    malformed: result.malformed,
    partialBytes: result.partialBytes,
    lastSeq: result.lastSeq,
    tampered: result.tampered,
    present: true,
    refusedCount: result.malformed.length,
    fileSize: st.size,
  };
  return { ok: true };
}

function computeRoleAggregates(events) {
  const aggregates = {};
  for (const ev of events) {
    const role = ev.toRole || ev.fromRole || "unknown";
    if (!aggregates[role]) aggregates[role] = { count: 0 };
    aggregates[role].count += 1;
  }
  return aggregates;
}

/**
 * Create the dashboard HTTP server.
 *
 * @param {object} opts
 * @returns {{server: import('node:http').Server, listen: Function, close: Function}}
 */
function create(opts = {}) {
  const host = opts.host || "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Server.create: non-loopback host is not permitted (host=${host})`);
  }

  const now = typeof opts.now === "function" ? opts.now : () => Date.now();

  let eventsPath;
  let runPathsInfo = null;
  if (opts.runDir) {
    eventsPath = path.join(opts.runDir, "events.jsonl");
  } else if (opts.ledgerRoot && opts.runId) {
    const resolved = RunPaths.resolveRunDir(opts.ledgerRoot, opts.runId);
    if (!resolved.ok) {
      throw new Error(`Server.create: unable to resolve run dir (code=${resolved.code})`);
    }
    eventsPath = resolved.eventsPath;
    runPathsInfo = { ledgerRoot: opts.ledgerRoot, runId: opts.runId };
  } else {
    throw new Error("Server.create: runDir or ledgerRoot+runId is required");
  }

  const ledgerState = makeLedgerState(eventsPath);
  const bucket = new TokenBucket(RATE_BUCKET_CAPACITY, RATE_REFILL_PER_MS, now);

  let boundPort = typeof opts.port === "number" ? opts.port : 0;
  let hostAllowlist = null;

  let htmlCache = null;
  function getHtml(nonce) {
    if (typeof opts.htmlOverride === "string") {
      return opts.htmlOverride.replace(/__NONCE__/g, nonce);
    }
    if (htmlCache === null) {
      const uiPath = path.join(__dirname, "ui", "index.html");
      try {
        htmlCache = fs.readFileSync(uiPath, "utf8");
      } catch {
        htmlCache = false;
      }
    }
    if (htmlCache === false) {
      return fallbackHtml(nonce);
    }
    return htmlCache.replace(/__NONCE__/g, nonce);
  }

  function handleRequest(req, res) {
    const nonce = crypto.randomBytes(16).toString("base64");
    const headers = securityHeaders(nonce);

    // Reject any request carrying a body (D-11 scope: GET-only, no bodies).
    const contentLength = req.headers["content-length"];
    const hasBody = Boolean(contentLength && Number(contentLength) > 0);
    if (req.method !== "GET" || hasBody) {
      const body = Buffer.from(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), "utf8");
      res.writeHead(
        405,
        Object.assign(
          {
            Allow: "GET",
            Connection: "close",
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": body.length,
          },
          headers
        )
      );
      // Flush the full response before tearing down the socket so the
      // client always receives the 405 body/headers (D-21).
      res.end(body, () => req.socket.destroy());
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new url.URL(req.url, `http://${host}`);
    } catch {
      jsonError(res, 400, "BAD_REQUEST", headers);
      return;
    }

    // D-11: Host header allowlist, resolved against the actual bound port.
    const hostHeaderRaw = req.headers.host;
    if (!hostHeaderRaw || !hostAllowlist || !hostAllowlist.has(hostHeaderRaw)) {
      jsonError(res, 403, "FORBIDDEN_HOST", headers);
      return;
    }

    // Origin, if present, must be same-origin.
    const originHeader = req.headers.origin;
    if (originHeader && !sameOrigin(originHeader, hostHeaderRaw)) {
      jsonError(res, 403, "FORBIDDEN_ORIGIN", headers);
      return;
    }

    const secFetchSite = req.headers["sec-fetch-site"];
    if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
      jsonError(res, 403, "FORBIDDEN_SEC_FETCH_SITE", headers);
      return;
    }

    const secFetchMode = req.headers["sec-fetch-mode"];
    const pathname = parsedUrl.pathname;
    if (pathname.startsWith("/api/") && secFetchMode === "navigate") {
      jsonError(res, 403, "FORBIDDEN_SEC_FETCH_MODE", headers);
      return;
    }

    // Rate limiting (rejected requests above do not consume the bucket).
    if (!bucket.take(now)) {
      jsonError(res, 429, "RATE_LIMITED", headers);
      return;
    }

    // Path-ish query keys are never accepted (run id is fixed at startup).
    for (const key of parsedUrl.searchParams.keys()) {
      if (FORBIDDEN_QUERY_KEYS.has(key)) {
        jsonError(res, 400, "BAD_QUERY_KEY", headers);
        return;
      }
    }

    if (pathname === "/") {
      const html = getHtml(nonce);
      const body = Buffer.from(html, "utf8");
      res.writeHead(
        200,
        Object.assign({ "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length }, headers)
      );
      res.end(body);
      return;
    }

    if (pathname === "/api/state") {
      for (const key of parsedUrl.searchParams.keys()) {
        if (!QUERY_ALLOWLIST.has(key)) {
          jsonError(res, 400, "BAD_QUERY_KEY", headers);
          return;
        }
      }

      const fromRaw = parsedUrl.searchParams.get("from");
      const limitRaw = parsedUrl.searchParams.get("limit");
      let from = 0;
      let limit = MAX_EVENTS_PER_RESPONSE;

      if (fromRaw !== null) {
        const n = Number(fromRaw);
        if (!Number.isInteger(n) || n < 0) {
          jsonError(res, 400, "BAD_QUERY_VALUE", headers);
          return;
        }
        from = n;
      }
      if (limitRaw !== null) {
        const n = Number(limitRaw);
        if (!Number.isInteger(n) || n < 0 || n > MAX_EVENTS_PER_RESPONSE) {
          jsonError(res, 400, "BAD_QUERY_VALUE", headers);
          return;
        }
        limit = n;
      }

      const refreshResult = refreshLedger(ledgerState, runPathsInfo);
      if (!refreshResult.ok) {
        jsonError(res, 403, "LEDGER_REVALIDATION_FAILED", headers);
        return;
      }

      const cached = ledgerState.cached;
      const filtered = cached.events.filter((e) => e.seq > from).slice(0, limit);

      const responseBody = {
        run: {
          present: !!cached.present,
          tampered: !!cached.tampered,
          malformedCount: cached.malformed.length,
          refusedCount: cached.refusedCount || 0,
          partialBytes: cached.partialBytes,
          lastSeq: cached.lastSeq,
          fileSize: cached.fileSize || 0,
          schemaVersion: Schema.SCHEMA_VERSION,
          mode: "read-only",
          bounds: { maxEventsPerResponse: MAX_EVENTS_PER_RESPONSE },
        },
        events: filtered,
        roles: { aggregates: computeRoleAggregates(cached.events) },
      };

      sendJson(res, 200, responseBody, headers);
      return;
    }

    jsonError(res, 404, "NOT_FOUND", headers);
  }

  const headersTimeout = typeof opts.headersTimeout === "number" ? opts.headersTimeout : 4000;
  const requestTimeout = typeof opts.requestTimeout === "number" ? opts.requestTimeout : 5000;
  const keepAliveTimeout = typeof opts.keepAliveTimeout === "number" ? opts.keepAliveTimeout : 2000;
  // Node only enforces headersTimeout/requestTimeout when its internal
  // connection-checking sweep runs; the default interval (30000ms) lets a
  // slow-header (slowloris) socket survive far longer than headersTimeout,
  // violating D-13 (<5s). Derive a bounded sweep interval from
  // headersTimeout so the check actually fires inside the configured
  // window (clamped to [50, 1000]ms).
  const connectionsCheckingInterval = Math.max(50, Math.min(1000, Math.floor(headersTimeout / 2)));

  const server = http.createServer(handleRequest);
  server.maxConnections = 8;
  server.headersTimeout = headersTimeout;
  server.requestTimeout = requestTimeout;
  server.keepAliveTimeout = keepAliveTimeout;
  // Must be set as a property (not a createServer() constructor option) to
  // take effect reliably across supported Node versions.
  server.connectionsCheckingInterval = connectionsCheckingInterval;

  function listen() {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(boundPort, host, () => {
        boundPort = server.address().port;
        hostAllowlist = buildHostAllowlist(boundPort);
        resolve({ port: boundPort, host });
      });
    });
  }

  function close() {
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  return { server, listen, close };
}

module.exports = { create, securityHeaders, buildHostAllowlist, parseHostHeader };
