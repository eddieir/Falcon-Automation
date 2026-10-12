/**
 * src/production-cycle/EventReader.js — read-side parser for the pc-event/1
 * ledger (ADR-0018 section 7, Sec-00b D-01/D-03/D-07/D-08/D-09). Never
 * echoes rejected line content — only lineNumber/byteLength counters.
 */

"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

const Validator = require("./EventValidator");
const Redact = require("./Redact");
const Schema = require("./EventSchema");
const RunPaths = require("./RunPaths");

function sha256HexOfLine(line) {
  return crypto.createHash("sha256").update(line, "utf8").digest("hex");
}

/**
 * Incrementally parse a buffer chunk against carry-over state. Never
 * echoes rejected content: malformed/refused lines are reported only as
 * {lineNumber, byteLength}.
 *
 * @param {Buffer} chunk
 * @param {object} state - { carry: Buffer, lineNumber: number, lastSeq: number, prevHash: string, seenEventIds: Set, events: Array, malformed: Array, partialBytes: number, tampered: boolean, firstBadSeq: number|null }
 * @returns {object} updated state
 */
function parseChunk(chunk, state) {
  const st = state || {
    carry: Buffer.alloc(0),
    lineNumber: 0,
    lastSeq: 0,
    prevHash: Schema.PREV_HASH_GENESIS,
    seenEventIds: new Set(),
    events: [],
    malformed: [],
    partialBytes: 0,
    tampered: false,
    firstBadSeq: null,
  };

  const combined = Buffer.concat([st.carry, chunk]);
  let start = 0;
  const newlineByte = 0x0a;

  for (;;) {
    const idx = combined.indexOf(newlineByte, start);
    if (idx === -1) {
      st.carry = combined.slice(start);
      st.partialBytes = st.carry.length;
      break;
    }
    const lineBuf = combined.slice(start, idx);
    start = idx + 1;
    st.lineNumber += 1;
    const lineString = lineBuf.toString("utf8");

    const validated = Validator.validateLine(lineString);
    if (!validated.ok) {
      st.malformed.push({ lineNumber: st.lineNumber, byteLength: lineBuf.length });
      continue;
    }

    const redactResult = Redact.scan(validated.value);
    if (!redactResult.ok) {
      st.malformed.push({ lineNumber: st.lineNumber, byteLength: lineBuf.length });
      continue;
    }

    const event = validated.value;

    if (st.seenEventIds.has(event.eventId)) {
      // Duplicate eventId — ignored (not an error, not re-emitted).
      continue;
    }

    const expectedSeq = st.lastSeq + 1;
    const hashLine = JSON.stringify(event);
    const actualPrevHash = st.prevHash;
    if (event.seq !== expectedSeq || event.prevHash !== actualPrevHash) {
      st.tampered = true;
      if (st.firstBadSeq === null) {
        st.firstBadSeq = event.seq;
      }
    }

    st.seenEventIds.add(event.eventId);
    st.events.push(event);
    st.lastSeq = event.seq;
    st.prevHash = sha256HexOfLine(lineString);
  }

  return st;
}

/**
 * Read the entire ledger file for a run and return a full parse result.
 * Opens via RunPaths.openLedgerNoFollow (D-07). Never throws.
 *
 * @param {string} eventsPath
 * @param {object} [opts]
 * @returns {{ok: boolean, events?: Array, malformed?: Array, partialBytes?: number, lastSeq?: number, tampered?: boolean, firstBadSeq?: number|null, errorCode?: string}}
 */
function readAll(eventsPath, opts = {}) {
  const openResult = RunPaths.openLedgerNoFollow(eventsPath);
  if (!openResult.ok) {
    return { ok: false, errorCode: openResult.code };
  }

  let state;
  try {
    const CHUNK_SIZE = 64 * 1024;
    const buf = Buffer.alloc(CHUNK_SIZE);
    state = undefined;
    for (;;) {
      let bytesRead;
      try {
        bytesRead = fs.readSync(openResult.fd, buf, 0, CHUNK_SIZE, null);
      } catch (e) {
        if (e && e.code === "EAGAIN") continue;
        throw e;
      }
      if (bytesRead === 0) break;
      state = parseChunk(buf.slice(0, bytesRead), state);
    }
  } catch {
    try {
      fs.closeSync(openResult.fd);
    } catch {
      /* already closed */
    }
    return { ok: false, errorCode: "EVENTS_READ_FAILED" };
  }

  try {
    fs.closeSync(openResult.fd);
  } catch {
    /* already closed */
  }

  if (!state) {
    state = {
      events: [],
      malformed: [],
      partialBytes: 0,
      lastSeq: 0,
      tampered: false,
      firstBadSeq: null,
    };
  }

  return {
    ok: true,
    events: state.events,
    malformed: state.malformed,
    partialBytes: state.partialBytes,
    lastSeq: state.lastSeq,
    tampered: state.tampered,
    firstBadSeq: state.firstBadSeq,
  };
}

module.exports = { readAll, parseChunk };
