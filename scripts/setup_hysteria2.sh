#!/usr/bin/env bash
# ==============================================================================
# setup_hysteria2.sh — Script for installing and configuring Hysteria 2 on Linux VPS
# Integrates with Avari Keys Slave API HTTP Auth hook (POST /api/v1/hysteria/auth)
# ==============================================================================
set -euo pipefail

DOMAIN="${1:-s2.avari.dev}"
SLAVE_AUTH_URL="${2:-http://127.0.0.1:8081/api/v1/hysteria/auth}"
LISTEN_PORT="${3:-443}"
ACME_EMAIL="${4:-admin@${DOMAIN}}"

echo "=========================================================="
echo "Installing Hysteria 2 for Avari Keys"
echo "Domain:          ${DOMAIN}"
echo "Listen Port:     ${LISTEN_PORT} (UDP)"
echo "Slave Auth URL:  ${SLAVE_AUTH_URL}"
echo "=========================================================="

if [[ $EUID -ne 0 ]]; then
   echo "Error: This script must be run as root." >&2
   exit 1
fi

# 1. Install Hysteria 2 Official Binary if not installed
if ! command -v hysteria &>/dev/null; then
    echo "[1/4] Installing official Hysteria 2 binary..."
    bash <(curl -fsSL https://get.hy2.sh/)
else
    echo "[1/4] Hysteria 2 is already installed ($(hysteria version 2>/dev/null || echo 'installed'))."
fi

# 2. Prepare directories
echo "[2/4] Configuring directories..."
mkdir -p /etc/hysteria /var/log/hysteria

# 3. Create Hysteria 2 server configuration
echo "[3/4] Generating /etc/hysteria/config.yaml..."
cat > /etc/hysteria/config.yaml <<EOF
# Hysteria 2 Server Configuration for Avari Keys
listen: :${LISTEN_PORT}

# TLS Configuration: Automatic ACME via Let's Encrypt for the domain
tls:
  type: acme
  acme:
    domains:
      - ${DOMAIN}
    email: ${ACME_EMAIL}

# Dynamic Authentication delegated to Avari Keys Slave API
auth:
  type: http
  http:
    url: ${SLAVE_AUTH_URL}
    insecure: false

# UDP & QUIC Tuning
quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnReceiveWindow: 20971520
  maxConnReceiveWindow: 20971520
  maxIdleTimeout: 30s
  keepAlivePeriod: 10s

# Bandwidth hints (Unlimited / Server-managed)
bandwidth:
  up: 1 gbps
  down: 1 gbps

# Masquerade (Decoy site for unauthorized probes)
masquerade:
  type: proxy
  proxy:
    url: https://news.ycombinator.com
    rewriteHost: true

# Outbound routing (Direct internet access)
outbounds:
  - name: direct
    type: direct
EOF

chmod 600 /etc/hysteria/config.yaml

# 4. Enable and start hysteria-server systemd service
echo "[4/4] Starting hysteria-server.service..."
systemctl daemon-reload
systemctl enable hysteria-server.service
systemctl restart hysteria-server.service

echo ""
echo "=========================================================="
echo "Hysteria 2 successfully configured!"
echo "Service status:"
systemctl status hysteria-server.service --no-pager || true
echo "=========================================================="
echo "Verify auth hook locally:"
echo "curl -X POST ${SLAVE_AUTH_URL} -H 'Content-Type: application/json' -d '{\"auth\":\"test\"}'"
echo "=========================================================="
