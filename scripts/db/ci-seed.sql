-- Phase 6 — minimal fixture schema for Falcon's DB test suite in CI.
--
-- This is intentionally the smallest schema that satisfies what
-- tests/db/UserDBTest.js and tests/db/OrderDBTest.js actually assert:
--
--   UserDBTest  — a `users` row with username = 'test_user' exists.
--   OrderDBTest — an `orders` table exists with columns
--                 (id, user_id, total, status, created_at). No row data is
--                 asserted, so none is seeded here — inventing unverified
--                 fixture rows would just be scope creep.
--
-- Run against a disposable CI Postgres instance only. Idempotent (safe to
-- re-run against the same container without erroring).

CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    email      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    total      NUMERIC(10, 2) NOT NULL,
    status     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO users (username, email)
VALUES ('test_user', 'test_user@falcon-automation.test')
ON CONFLICT (username) DO NOTHING;
