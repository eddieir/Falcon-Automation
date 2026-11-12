# Storing database secrets securely (Supabase and other PostgreSQL)

This guide says where each database secret belongs and how Falcon reads it. Nothing secret is ever committed to this repository.

## What is secret and what is not

| Item | Secret? | Where it lives |
| --- | --- | --- |
| Database password (`DB_PASS`) | Yes | Secret store (below), never the repo |
| Client private key (`SSL_KEY_FILE`) and client certificate (`SSL_CERT_FILE`), if you use mTLS | Yes (the key) | Secret store, written to a `0600` file outside the repo at run time |
| Provider root CA certificate (`SSL_CA_FILE`) | No, it is public | Anywhere; the provider publishes it |
| Host, port, user, database name | Not secret, but keep them in configuration, not code | `.env` locally, repository or environment variables in CI |

## Local development

1. Copy `.env.example` to `.env`. `.env` is gitignored; never commit it.
2. Put the password in `.env` only.
3. Keep certificate and key files outside the repository directory (for example `~/.falcon-secrets/`), with `chmod 700` on the directory and `chmod 600` on each key file. Point `SSL_CA_FILE`, `SSL_KEY_FILE` and `SSL_CERT_FILE` at those paths.
4. Leave TLS verification on: `DB_SSL=true`, the provider's CA in `SSL_CA_FILE`, and `SSL_REJECT_UNAUTHORIZED` unset. Setting it to `false` disables certificate verification and is an explicit insecure opt-out.

## GitHub Actions

1. Add the password as a repository or **Environment** secret (Settings > Secrets and variables > Actions). For anything production-like, use an Environment with required reviewers.
2. Reference it only as `${{ secrets.NAME }}` in the `env:` of the step that needs it. Never echo it, never put it on a command line, never upload it as an artifact.
3. If an mTLS key or certificate is needed, store the file content as a secret, write it to a `mktemp` directory with `chmod 600` during the job, and delete it in an `if: always()` step. The `db-tls` job in `.github/workflows/ci.yml` shows the same pattern with throwaway generated certificates.
4. Keep workflow permissions at `contents: read`. Do not expose secrets to workflows triggered from forks.

## Database-side practices

- Create a dedicated least-privilege role for tests. Do not use the project's admin password in CI or in `.env`.
- Rotate the password on a schedule and immediately if it appears in a log, a screenshot or a commit.
- Prefer short-lived credentials (for example OIDC to a cloud secret manager) over long-lived static ones when the provider supports it.
- Use a separate database or schema for tests; never point automated tests at production data.

## Repository guardrails

- Enable GitHub **secret scanning** and **push protection** so a push that contains a key is blocked.
- Keep `.gitignore` covering `.env`, `*.key`, `*.pem`, `*.p12` and `*.pfx`.
- Optional: run a secret scanner (for example gitleaks) in a pre-commit hook or CI step.

## If a secret is committed by mistake

1. Treat it as compromised. Revoke or rotate it at the provider first; removing it from git does not make it safe again.
2. Remove it from history (for example `git filter-repo --invert-paths --path <file>`), force-push branches and tags, and ask GitHub support to purge cached views and pull-request refs.
3. Verify with a full-history secret scan.

## Falcon behaviour to know

- With `SSL_CA_FILE` set and no client key and certificate, Falcon trusts the configured CA and connects with TLS (no client certificate).
- With `SSL_CA_FILE`, `SSL_KEY_FILE` and `SSL_CERT_FILE` all set, Falcon uses full mTLS.
- A missing or unreadable certificate file fails with an error that names the file. File contents are never logged.
- TLS and mTLS against a real PostgreSQL are exercised by the `db-tls` CI job.
