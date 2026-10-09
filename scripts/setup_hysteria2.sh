#!/usr/bin/env bash
# ==============================================================================
# setup_hysteria2.sh — Script for installing and configuring Hysteria 2 on Linux VPS
# Integrates with Avari Keys Slave API HTTP Auth hook (POST /api/v1/hysteria/auth)
# Handles automatic certificate detection from Caddy, Certbot/Let's Encrypt, or ACME.
# ==============================================================================
set -euo pipefail

DOMAIN="${1:-s2.avari.dev}"
SLAVE_AUTH_URL="${2:-http://127.0.0.1:8081/api/v1/hysteria/auth}"
LISTEN_PORT="${3:-443}"
ACME_EMAIL="${4:-admin@${DOMAIN}}"

echo "=========================================================="
echo "Installing / Configuring Hysteria 2 for Avari Keys"
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
    echo "[1/5] Installing official Hysteria 2 binary..."
    bash <(curl -fsSL https://get.hy2.sh/)
else
    echo "[1/5] Hysteria 2 is already installed ($(hysteria version 2>/dev/null || echo 'installed'))."
fi

# 2. Prepare directories and system user
echo "[2/5] Configuring directories and system user..."
mkdir -p /etc/hysteria /var/log/hysteria

if ! id "hysteria" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin hysteria || true
fi

# 3. Detect existing TLS Certificates (Caddy, Certbot/Nginx, or Fallback to ACME)
echo "[3/5] Detecting TLS certificates for domain ${DOMAIN}..."

CADDY_CERT_DIR="/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${DOMAIN}"
CERTBOT_CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

USE_LOCAL_CERTS=false
SOURCE_CERT=""
SOURCE_KEY=""

if [[ -f "${CADDY_CERT_DIR}/${DOMAIN}.crt" && -f "${CADDY_CERT_DIR}/${DOMAIN}.key" ]]; then
    echo "  -> Found existing Caddy certificates at ${CADDY_CERT_DIR}"
    SOURCE_CERT="${CADDY_CERT_DIR}/${DOMAIN}.crt"
    SOURCE_KEY="${CADDY_CERT_DIR}/${DOMAIN}.key"
    USE_LOCAL_CERTS=true
elif [[ -f "${CERTBOT_CERT_DIR}/fullchain.pem" && -f "${CERTBOT_CERT_DIR}/privkey.pem" ]]; then
    echo "  -> Found existing Certbot certificates at ${CERTBOT_CERT_DIR}"
    SOURCE_CERT="${CERTBOT_CERT_DIR}/fullchain.pem"
    SOURCE_KEY="${CERTBOT_CERT_DIR}/privkey.pem"
    USE_LOCAL_CERTS=true
fi

if [[ "$USE_LOCAL_CERTS" = true ]]; then
    echo "  -> Copying certificates to /etc/hysteria and setting permissions..."
    cp "$SOURCE_CERT" /etc/hysteria/server.crt
    cp "$SOURCE_KEY" /etc/hysteria/server.key
    chown hysteria:hysteria /etc/hysteria/server.crt /etc/hysteria/server.key
    chmod 644 /etc/hysteria/server.crt
    chmod 600 /etc/hysteria/server.key

    TLS_CONFIG_BLOCK="tls:
  cert: /etc/hysteria/server.crt
  key: /etc/hysteria/server.key"

    # Set up automatic daily sync service & timer if Caddy is present
    cat > /etc/hysteria/sync-certs.sh << 'SYNCSCRIPT'
#!/bin/bash
DOMAIN="DOMAIN_PLACEHOLDER"
CADDY_DIR="/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${DOMAIN}"
CERTBOT_DIR="/etc/letsencrypt/live/${DOMAIN}"

if [[ -f "${CADDY_DIR}/${DOMAIN}.crt" ]]; then
    cp -u "${CADDY_DIR}/${DOMAIN}.crt" /etc/hysteria/server.crt 2>/dev/null || cp "${CADDY_DIR}/${DOMAIN}.crt" /etc/hysteria/server.crt
    cp -u "${CADDY_DIR}/${DOMAIN}.key" /etc/hysteria/server.key 2>/dev/null || cp "${CADDY_DIR}/${DOMAIN}.key" /etc/hysteria/server.key
elif [[ -f "${CERTBOT_DIR}/fullchain.pem" ]]; then
    cp -u "${CERTBOT_DIR}/fullchain.pem" /etc/hysteria/server.crt 2>/dev/null || cp "${CERTBOT_DIR}/fullchain.pem" /etc/hysteria/server.crt
    cp -u "${CERTBOT_DIR}/privkey.pem" /etc/hysteria/server.key 2>/dev/null || cp "${CERTBOT_DIR}/privkey.pem" /etc/hysteria/server.key
fi
chown hysteria:hysteria /etc/hysteria/server.crt /etc/hysteria/server.key 2>/dev/null || true
chmod 644 /etc/hysteria/server.crt 2>/dev/null || true
chmod 600 /etc/hysteria/server.key 2>/dev/null || true
SYNCSCRIPT
    sed -i "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" /etc/hysteria/sync-certs.sh
    chmod +x /etc/hysteria/sync-certs.sh

    cat > /etc/systemd/system/hysteria-cert-sync.service << 'UNIT'
[Unit]
Description=Sync TLS Certificates to Hysteria
After=network.target

[Service]
Type=oneshot
ExecStart=/etc/hysteria/sync-certs.sh
ExecStartPost=/usr/bin/systemctl try-reload-or-restart hysteria-server.service
UNIT

    cat > /etc/systemd/system/hysteria-cert-sync.timer << 'TIMER'
[Unit]
Description=Daily Sync of TLS Certificates to Hysteria

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
TIMER

    systemctl daemon-reload
    systemctl enable --now hysteria-cert-sync.timer || true
else
    echo "  -> No existing web server certificates detected. Using standalone ACME Let's Encrypt."
    TLS_CONFIG_BLOCK="tls:
  type: acme
  acme:
    domains:
      - ${DOMAIN}
    email: ${ACME_EMAIL}"
fi

# 4. Create Hysteria 2 server configuration
echo "[4/5] Generating /etc/hysteria/config.yaml..."
cat > /etc/hysteria/config.yaml <<EOF
# Hysteria 2 Server Configuration for Avari Keys
listen: :${LISTEN_PORT}

${TLS_CONFIG_BLOCK}

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

chown hysteria:hysteria /etc/hysteria/config.yaml
chmod 600 /etc/hysteria/config.yaml

# 5. Enable and start hysteria-server systemd service
echo "[5/5] Starting hysteria-server.service..."
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
