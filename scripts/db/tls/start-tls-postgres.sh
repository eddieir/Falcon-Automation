#!/usr/bin/env bash
# start-tls-postgres.sh — start a single, throwaway TLS-enabled Postgres
# container for the G-02 CI job (and local verification).
#
# Usage: start-tls-postgres.sh <container-name> <host-port> <cert-dir> <image>
#
# One container, one port, two databases differentiated by pg_hba.conf:
#   - falcon_tls  — hostssl, md5 auth, no client cert required (positive
#                   TLS and "untrusted CA must be rejected" cases, plus the
#                   partial-cert-vars and insecure-opt-out boundary cases).
#   - falcon_mtls — hostssl, `cert` auth method with clientcert=verify-full
#                   (full mTLS case and the "mTLS server refuses a client
#                   with no cert" negative case).
#
# Certs are never baked into the image or committed: they are bind-mounted
# read-only from $CERT_DIR (expected to be a mktemp -d created by
# gen-certs.sh) and copied/chowned to a container-local path at boot,
# because Postgres refuses a server key it does not own and bind mounts
# keep the host's (non-postgres) ownership.
set -euo pipefail

NAME="${1:?usage: start-tls-postgres.sh <name> <port> <cert-dir> <image>}"
PORT="${2:?missing port}"
CERT_DIR="${3:?missing cert dir}"
IMAGE="${4:?missing image}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INIT_DIR="$(mktemp -d)"
trap 'rm -rf "$INIT_DIR"' EXIT

# Throwaway password: this container never holds real data and is removed
# at the end of the job (see stop-tls-postgres.sh / the CI cleanup step).
TLS_DB_PASSWORD="${TLS_DB_PASSWORD:-falcon_tls_ci_password}"

cat > "$INIT_DIR/pg_hba.conf" <<'EOF'
local all all trust
hostssl falcon_tls  falcon_tls_user     all  md5
hostssl falcon_mtls falcon_mtls_client  all  cert clientcert=verify-full
EOF

cat > "$INIT_DIR/init.sql" <<'EOF'
CREATE ROLE falcon_mtls_client LOGIN;
CREATE DATABASE falcon_mtls OWNER falcon_mtls_client;
EOF

docker rm -f "$NAME" >/dev/null 2>&1 || true

docker run -d --name "$NAME" \
    -v "$CERT_DIR:/certs-src:ro" \
    -v "$INIT_DIR/pg_hba.conf:/hba-src/pg_hba.conf:ro" \
    -v "$INIT_DIR/init.sql:/docker-entrypoint-initdb.d/10-init.sql:ro" \
    -e POSTGRES_USER=falcon_tls_user \
    -e POSTGRES_PASSWORD="$TLS_DB_PASSWORD" \
    -e POSTGRES_DB=falcon_tls \
    -p "127.0.0.1:${PORT}:5432" \
    --entrypoint sh \
    "$IMAGE" \
    -c '
        set -e
        cp -r /certs-src /certs
        chown -R postgres:postgres /certs
        chmod 600 /certs/server.key /certs/ca-trusted.key /certs/ca-untrusted.key
        cp /hba-src/pg_hba.conf /etc/falcon-pg_hba.conf
        chown postgres:postgres /etc/falcon-pg_hba.conf
        exec docker-entrypoint.sh postgres \
            -c ssl=on \
            -c ssl_cert_file=/certs/server.crt \
            -c ssl_key_file=/certs/server.key \
            -c ssl_ca_file=/certs/ca-trusted.crt \
            -c hba_file=/etc/falcon-pg_hba.conf
    ' >/dev/null

echo "Waiting for TLS Postgres ($NAME) to accept connections..."
for _ in $(seq 1 60); do
    if docker exec "$NAME" pg_isready -U falcon_tls_user -d falcon_tls >/dev/null 2>&1; then
        echo "TLS Postgres ($NAME) is ready on port $PORT."
        exit 0
    fi
    sleep 1
done

echo "::error::TLS Postgres ($NAME) did not become ready in time" >&2
docker logs "$NAME" 2>&1 | tail -n 100
exit 1
