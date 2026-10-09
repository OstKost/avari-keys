#!/usr/bin/env bash
# ==============================================================================
# deploy_slave_nodes.sh — Build and deploy avari-slave to cluster nodes
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/apps/backend"
TARGET_HOSTS="${1:-157.22.252.225 185.213.240.136 157.228.142.20 157.228.130.7}"
SSH_USER="${SSH_USER:-root}"
SSH_PORT="${SSH_PORT:-22}"

echo "=========================================================="
echo "Avari Keys — Deploy avari-slave to cluster nodes"
echo "Targets: ${TARGET_HOSTS}"
echo "=========================================================="

# 1. Build Linux amd64 static binary
TMP_BIN="/tmp/avari-slave-deploy"
echo "[1/3] Building linux/amd64 static binary..."
(
    cd "${BACKEND_DIR}"
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "${TMP_BIN}" ./cmd/slave
)
ls -lh "${TMP_BIN}"

# 2. Deploy to each target host
for HOST in ${TARGET_HOSTS}; do
    echo ""
    echo "=========================================================="
    echo "==> Deploying to ${HOST}..."
    echo "=========================================================="
    
    # Test SSH connectivity first
    if ! ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -p "${SSH_PORT}" "${SSH_USER}@${HOST}" "uptime" >/dev/null 2>&1; then
        echo "⚠️ Warning: Cannot connect to ${HOST}, skipping."
        continue
    fi

    # Upload binary
    scp -P "${SSH_PORT}" -o StrictHostKeyChecking=accept-new "${TMP_BIN}" "${SSH_USER}@${HOST}:/usr/local/bin/avari-slave.new"
    
    # Atomically replace and restart service
    ssh -p "${SSH_PORT}" -o StrictHostKeyChecking=accept-new "${SSH_USER}@${HOST}" 'bash -s' << 'REMOTE_EOF'
chmod +x /usr/local/bin/avari-slave.new
mv /usr/local/bin/avari-slave.new /usr/local/bin/avari-slave
if systemctl is-active --quiet avari-slave; then
    systemctl restart avari-slave
    echo "✅ avari-slave restarted successfully!"
else
    echo "ℹ️ avari-slave service is not active."
fi
curl -s http://127.0.0.1:8081/health 2>/dev/null || true
echo ""
REMOTE_EOF
done

rm -f "${TMP_BIN}"
echo ""
echo "=========================================================="
echo "Deployment finished!"
echo "=========================================================="
