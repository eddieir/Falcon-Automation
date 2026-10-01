/**
 * src/core/util/OutputSafe.js — terminal render-boundary sanitiser.
 *
 * The CLIs in scripts/review/, scripts/healing/, and scripts/flakiness/ print
 * strings that ultimately come from the page under test (a selector, an
 * attribute-derived alternative) or from a state file written over time.
 * Nothing stops a page attribute from containing raw ANSI escape sequences —
 * a clear-screen, a cursor-reposition, an OSC-8 "hyperlink" whose visible
 * text differs from its target, or a terminal title change. Printed
 * unmodified, that text can rewrite what a human reviewer sees on the one
 * screen that gates whether a healing fix gets approved. This module is the
 * boundary that strips that class of injection before it reaches a terminal.
 *
 * Call this at the point of output (console.log/console.error/Logger), not
 * at capture time — capture-time stripping would have to be re-applied at
 * every future render site, and a new one would eventually be missed.
 *
 * Scanning strategy: a single left-to-right pass over the string's
 * characters, classifying and skipping escape sequences explicitly. No
 * backtracking regular expression is used, so input length bounds the work
 * linearly regardless of content (no catastrophic-backtracking risk).
 *
 * Two exports, two different jobs:
 *
 *   - stripControlChars(value): general-purpose sanitiser for output that is
 *     genuinely allowed to span multiple lines (a multi-line log message, a
 *     free-standing report block). Tab/LF/CR pass through unchanged.
 *
 *   - sanitizeField(value): for a value that is rendered as ONE line inside a
 *     line-per-entry listing (every "  <field>" row these CLIs print). A raw
 *     LF or CR in such a field does not just reformat harmlessly — it forges
 *     an extra line that reads as a separate, legitimate entry (LF) or lets
 *     trailing text overwrite what was already printed on that line via a
 *     cursor-to-column-0 return (CR). Both are a known log-injection pattern,
 *     distinct from the ANSI/control-sequence class stripControlChars already
 *     handles, and both are defeated the same way plain-text log injection
 *     always is: escape the line-structuring characters instead of passing
 *     them through, so the field can describe a newline without being able
 *     to create one. Tab carries no line-forging capability by itself but is
 *     escaped too, for one consistent, visibly-marked rule: a single-line
 *     field never contains a raw structural whitespace character.
 */

"use strict";

const ESC = "\x1B"; // 0x1B — introduces both CSI and OSC sequences
const BEL = "\x07"; // 0x07 — one of the two valid OSC terminators

/**
 * Decide, char by char, whether a code point is a C0 control character
 * (U+0000-U+001F), DEL (U+007F), or a C1 control character (U+0080-U+009F).
 * ESC itself (0x1B) is also a C0 control character and is handled by the
 * escape-sequence scanner below before this check ever sees it standalone.
 */
function isControlCodePoint(code) {
    return (code >= 0x00 && code <= 0x1f) || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/**
 * Unicode bidirectional-control / isolate characters. A string holding one
 * of these can make a terminal display characters in an order that doesn't
 * match their underlying byte sequence — e.g. a selector that *looks* like
 * one attribute value but is actually another, read right-to-left inside an
 * override region. There is no legitimate reason for a DOM-derived selector
 * or attribute value to carry one of these, and keeping them serves no
 * reporting purpose, so they are stripped outright rather than escaped.
 *   U+202A-U+202E: LRE, RLE, PDF, LRO, RLO (explicit direction formatting)
 *   U+2066-U+2069: LRI, RLI, FSI, PDI (directional isolates)
 */
function isBidiControl(code) {
    return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

function isLineWhitespace(code) {
    return code === 0x09 || code === 0x0a || code === 0x0d; // TAB, LF, CR
}

const VISIBLE_ESCAPE = { 0x09: "\\t", 0x0a: "\\n", 0x0d: "\\r" };

/**
 * Shared left-to-right scan used by both exports below. `onWhitespace`
 * decides what a TAB/LF/CR code point turns into in the output — the only
 * behavioural difference between stripControlChars and sanitizeField.
 * Everything else (control-character removal, CSI/OSC neutralisation, bidi
 * stripping) is identical, so it lives here once.
 */
function scan(value, onWhitespace) {
    let str;
    if (typeof value === "string") {
        str = value;
    } else if (value === null || value === undefined) {
        str = String(value);
    } else {
        try {
            str = String(value);
        } catch {
            return "[unprintable]";
        }
    }

    let out = "";
    const len = str.length;
    for (let i = 0; i < len; i++) {
        const ch = str[i];
        const code = str.charCodeAt(i);

        if (ch === ESC) {
            // Lone ESC at end of string: drop it, nothing follows to interpret.
            if (i + 1 >= len) {
                break;
            }
            const next = str[i + 1];
            if (next === "[") {
                // CSI: ESC [ <parameter bytes 0x30-0x3F> <intermediate 0x20-0x2F> <final 0x40-0x7E>
                let j = i + 2;
                while (j < len) {
                    const c = str.charCodeAt(j);
                    if (c >= 0x40 && c <= 0x7e) {
                        j++; // consume the final byte
                        break;
                    }
                    if ((c >= 0x30 && c <= 0x3f) || (c >= 0x20 && c <= 0x2f)) {
                        j++;
                        continue;
                    }
                    // Not a valid CSI continuation byte — stop consuming here,
                    // leaving the unexpected character for the outer loop.
                    break;
                }
                i = j - 1; // loop's i++ advances past the sequence
                continue;
            }
            if (next === "]") {
                // OSC: ESC ] ... terminated by BEL (0x07) or ST (ESC \).
                let j = i + 2;
                let terminated = false;
                while (j < len) {
                    if (str[j] === BEL) {
                        j++;
                        terminated = true;
                        break;
                    }
                    if (str[j] === ESC && j + 1 < len && str[j + 1] === "\\") {
                        j += 2;
                        terminated = true;
                        break;
                    }
                    j++;
                }
                // Whether or not a terminator was found, everything through
                // the end of the (possibly unterminated) sequence is dropped —
                // an unterminated OSC has no safe way to resume plain text.
                i = (terminated ? j : len) - 1;
                continue;
            }
            // Any other ESC-prefixed form (e.g. a two-char escape like ESC
            // followed by a single intermediate/final byte, or something
            // nonstandard) — drop just the ESC itself and let the following
            // character be evaluated normally on the next iteration.
            continue;
        }

        if (isLineWhitespace(code)) {
            out += onWhitespace(ch, code);
            continue;
        }

        if (isControlCodePoint(code)) {
            // other control characters are dropped silently
            continue;
        }

        if (isBidiControl(code)) {
            continue;
        }

        out += ch;
    }
    return out;
}

/**
 * Strip C0/C1/DEL control characters and neutralise ANSI escape sequences
 * (CSI and OSC, including both OSC terminator forms) from a value, returning
 * a string safe to print to a terminal. Tab/LF/CR pass through unchanged —
 * use this only for output that may legitimately span multiple lines (see
 * module doc comment for why, and see sanitizeField for single-line fields).
 * Never throws: non-string input is coerced to a readable placeholder/string
 * first.
 *
 * @param {*} value
 * @returns {string}
 */
function stripControlChars(value) {
    return scan(value, (ch) => ch);
}

/**
 * Same as stripControlChars, but for a value rendered as a single line
 * inside a line-per-entry listing. Tab/LF/CR are converted to their visible
 * two-character escapes (\t, \n, \r) instead of passing through, so a value
 * can never forge an extra listing row (LF) or overwrite an already-printed
 * line via a cursor-to-column-0 return (CR) — while still letting a reviewer
 * see, honestly, that the original field contained one. Never throws.
 *
 * @param {*} value
 * @returns {string}
 */
function sanitizeField(value) {
    return scan(value, (ch, code) => VISIBLE_ESCAPE[code]);
}

module.exports = { stripControlChars, sanitizeField };
