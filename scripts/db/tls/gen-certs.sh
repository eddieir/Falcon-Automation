#!/usr/bin/env bash
# gen-certs.sh — generate a throwaway CA/server/client certificate set for
# the TLS Postgres CI job (G-02). Everything is written under the directory
# passed as $1 (expected to be a mktemp -d, never committed).
#
# Produces two independent CAs so the "untrusted certificate" negative test
# has a CA that the server genuinely does not trust, rather than a reused
# key under a different name:
#   - ca-trusted.crt / ca-trusted.key   — the CA the server is configured
#                                          with (ssl_ca_file).
#   - ca-untrusted.crt / ca-untrusted.key — a second, unrelated CA used only
#                                          to sign a decoy "untrusted" server
#                                          cert used by the rejection test.
# Server and client certs are both signed by ca-trusted.
#
# No key leaves this directory and nothing here is printed to stdout beyond
# generation progress (no key/cert content).
set -euo pipefail

CERT_DIR="${1:?usage: gen-certs.sh <output-dir>}"
DAYS="${2:-5}"

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

gen_ca() {
    local name="$1" subj="$2"
    openssl genrsa -out "${name}.key" 2048 >/dev/null 2>&1
    openssl req -x509 -new -nodes -key "${name}.key" -sha256 -days "$DAYS" \
        -subj "$subj" -out "${name}.crt" >/dev/null 2>&1
}

gen_leaf() {
    local name="$1" subj="$2" ca_name="$3" ext_file="$4"
    openssl genrsa -out "${name}.key" 2048 >/dev/null 2>&1
    openssl req -new -key "${name}.key" -subj "$subj" -out "${name}.csr" >/dev/null 2>&1
    openssl x509 -req -in "${name}.csr" -CA "${ca_name}.crt" -CAkey "${ca_name}.key" \
        -CAcreateserial -out "${name}.crt" -days "$DAYS" -sha256 \
        -extfile "$ext_file" >/dev/null 2>&1
    rm -f "${name}.csr"
}

# Trusted CA — the one the Postgres server is configured to trust.
gen_ca "ca-trusted" "/CN=Falcon Test Trusted CA"

# Unrelated CA — used ONLY to prove a cert the server does not trust is
# actually rejected, never configured into the server.
gen_ca "ca-untrusted" "/CN=Falcon Test Untrusted CA"

cat > server-ext.cnf <<'EOF'
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
EOF

cat > client-ext.cnf <<'EOF'
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
EOF

# Server cert, signed by the trusted CA, SAN covers both loopback forms
# the test and docker health checks use.
gen_leaf "server" "/CN=localhost" "ca-trusted" "server-ext.cnf"

# The "untrusted CA" negative test connects to the real (trusted-CA)
# server while pointing SSL_CA_FILE at ca-untrusted.crt, which is enough to
# prove rejection without standing up a second server.

# Client cert for the mTLS case, signed by the trusted CA. pg's `cert` auth
# method matches the certificate's CN against the Postgres role name, so
# the client cert's subject CN must equal the mTLS role name.
gen_leaf "client" "/CN=falcon_mtls_client" "ca-trusted" "client-ext.cnf"

chmod 600 server.key client.key ca-trusted.key ca-untrusted.key
rm -f server-ext.cnf client-ext.cnf ca-trusted.srl ca-untrusted.srl

echo "Certificates generated in $CERT_DIR"
