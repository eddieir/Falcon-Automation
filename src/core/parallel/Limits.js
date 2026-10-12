"use strict";

/**
 * Phase 16 numeric bounds (architecture section 6). Frozen; every reader and
 * schema in the parallel module takes its limits from here.
 */
const KiB = 1024;
const MiB = 1024 * KiB;

const Limits = Object.freeze({
    RUN_ID_PATTERN: /^[a-z0-9][a-z0-9-]{5,62}$/,
    NAME_PATTERN: /^[A-Za-z0-9._-]{1,64}$/,
    BUNDLE_FILE_PATTERN: /^page-\d{1,4}\.json$/,

    MANIFEST_MAX_BYTES: 256 * KiB,
    MANIFEST_MAX_DEPTH: 6,
    MANIFEST_MAX_ARRAY: 1000,
    MANIFEST_MAX_STRING: 2048,
    MAX_KEY_LENGTH: 64,

    FRAGMENT_MAX_BYTES: 1 * MiB,
    FRAGMENT_MAX_DEPTH: 6,
    FRAGMENT_MAX_ROWS: 2000,
    FRAGMENT_MAX_ERROR: 500,
    FRAGMENT_MAX_UI_ISSUES: 200,
    FRAGMENT_MAX_UI_ISSUE_BYTES: 1 * KiB,
    FRAGMENT_MAX_STRING: 2048,

    JOURNAL_MAX_BYTES: 2 * MiB,
    JOURNAL_MAX_EVENTS: 5000,
    JOURNAL_MAX_PAYLOAD_BYTES: 8 * KiB,
    JOURNAL_MAX_DEPTH: 6,
    // File-level cap: envelope (root > events > event) adds 3 levels above the payload.
    JOURNAL_FILE_MAX_DEPTH: 9,
    JOURNAL_MAX_ARRAY: 50,
    JOURNAL_MAX_STRING: 2048,

    MAX_PAGES: 1000,
    MAX_SHARDS: 64,

    SELECTOR_MAX: 300,
    DESCRIPTION_MAX: 120,
    ERROR_MAX: 300,
    REASON_MAX: 100,
    LOCATOR_MEMORY_EVIDENCE_MAX_BYTES: 8192,
    LOCATOR_MEMORY_CANDIDATE_MAX_BYTES: 12000,
    DURATION_MAX_MS: 3600000,

    SHARD_DIR_MAX_FILES: 2200,
    SHARD_MAX_BYTES: 64 * MiB,
    MERGE_MAX_BYTES: 1024 * MiB,
    MERGE_MAX_EVENTS: 250000,
});

module.exports = Limits;
