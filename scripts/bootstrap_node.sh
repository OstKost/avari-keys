#!/usr/bin/env bash
# ==============================================================================
# bootstrap_node.sh — Полная настройка нового VPS как ноды Avari Keys
#
# Автоматизирует ручные шаги из _docs/DEPLOY.md: установка бинарника,
# systemd-юнита, настройка окружения через drop-in и запуск сервиса.
#
# Требования:
#   - запуск под root;
#   - для slave-ноды заранее установлен AmneziaWG (/root/awg/manage_amneziawg.sh);
#   - бинарник собран (make build-linux) или скачан.
#
# Использование:
#   ROLE=slave  BINARY=dist/linux-amd64/avari-slave  [SLAVE_API_KEY=...] ./scripts/bootstrap_node.sh
#   ROLE=master BINARY=dist/linux-amd64/avari-master ADMIN_PASSWORD=... JWT_SECRET=... ./scripts/bootstrap_node.sh
#
# Переменные окружения:
#   ROLE            master | slave
#   BINARY          путь к бинарнику (обязательно)
#   SLAVE_API_KEY   токен Slave API (для slave; если пусто — авто-генерация, см. journalctl)
#   SLAVE_PORT      порт Slave API (по умолчанию 8081)
#   ADMIN_PASSWORD  пароль администратора (для master, обязательно)
#   JWT_SECRET      секрет JWT (для master, обязательно)
#   MASTER_PORT     порт Master API (по умолчанию 8080)
#   DB_PATH         путь к SQLite Master (по умолчанию /opt/avari-keys/data/avari-master.db)
#
# Опциональные (необязательные) расширения:
#   INSTALL_CADDY=1  установить Caddy и сгенерировать Caddyfile (требует DOMAIN)
#   DOMAIN           публичный домен ноды (только вместе с INSTALL_CADDY=1)
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROLE="${ROLE:-}"
BINARY="${BINARY:-}"

if [[ $EUID -ne 0 ]]; then
  echo "❌ Запустите под root." >&2
  exit 1
fi
if [[ -z "$ROLE" || -z "$BINARY" ]]; then
  echo "Usage: ROLE=<master|slave> BINARY=<path> $0" >&2
  exit 1
fi
if [[ ! -f "$BINARY" ]]; then
  echo "❌ Бинарник не найден: $BINARY" >&2
  exit 1
fi

case "$ROLE" in
  slave)
    install -m 755 "$BINARY" /usr/local/bin/avari-slave
    install -m 644 "$ROOT_DIR/deploy/systemd/avari-slave.service" /etc/systemd/system/avari-slave.service
    mkdir -p /etc/systemd/system/avari-slave.service.d /etc/avari-keys /opt/avari-keys/data

    # ipset требуется для блокировки торрент-доменов (режим soft)
    command -v ipset >/dev/null 2>&1 || apt-get install -y ipset

    # Node-specific secret goes into a drop-in (keeps the base unit canonical).
    if [[ -n "${SLAVE_API_KEY:-}" ]]; then
      umask 077
      printf '[Service]\nEnvironment="SLAVE_API_KEY=%s"\n' "$SLAVE_API_KEY" \
        > /etc/systemd/system/avari-slave.service.d/api-key.conf
    fi

    systemctl daemon-reload
    systemctl enable --now avari-slave
    echo "✅ Slave-нода настроена. API key: ${SLAVE_API_KEY:-<авто-сгенерирован, см. journalctl -u avari-slave>}"
    ;;

  master)
    : "${ADMIN_PASSWORD:?ADMIN_PASSWORD обязателен для master}"
    : "${JWT_SECRET:?JWT_SECRET обязателен для master}"

    install -m 755 "$BINARY" /usr/local/bin/avari-master
    install -m 644 "$ROOT_DIR/deploy/systemd/avari-master.service" /etc/systemd/system/avari-master.service
    mkdir -p /etc/systemd/system/avari-master.service.d /opt/avari-keys/data

    umask 077
    cat > /etc/systemd/system/avari-master.service.d/runtime.conf <<EOF
[Service]
Environment="ADMIN_PASSWORD=${ADMIN_PASSWORD}"
Environment="JWT_SECRET=${JWT_SECRET}"
Environment="DB_PATH=${DB_PATH:-/opt/avari-keys/data/avari-master.db}"
EOF

    systemctl daemon-reload
    systemctl enable --now avari-master
    echo "✅ Master-нода настроена."
    ;;

  *)
    echo "❌ Неизвестная роль: $ROLE (ожидается master|slave)" >&2
    exit 1
    ;;
esac

# ---- Опционально: AmneziaWG (только для slave) ----
if [[ "$ROLE" == "slave" ]]; then
  if [[ ! -x /root/awg/manage_amneziawg.sh ]]; then
    echo ""
    echo "⚠️  AmneziaWG не найден (/root/awg/manage_amneziawg.sh)."
    echo "    Установите его вручную (сторонний upstream):"
    echo "      bash <(curl -sSL https://raw.githubusercontent.com/bivlked/amneziawg-installer/main/amneziawg-install.sh)"
    echo "    Для каскада дополнительно настройте туннель по их CASCADE.md."
  fi
fi

# ---- Опционально: Caddy (веб-сервер, TLS) ----
if [[ "${INSTALL_CADDY:-0}" == "1" ]]; then
  : "${DOMAIN:?DOMAIN обязателен при INSTALL_CADDY=1}"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi

  if [[ "$ROLE" == "master" ]]; then
    cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    handle /api/* {
        reverse_proxy localhost:${MASTER_PORT:-8080}
    }
    handle {
        root * /var/www/avari-keys/frontend
        try_files {path} /index.html
        file_server
    }
    encode gzip zstd
}
EOF
  else
    cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy localhost:${SLAVE_PORT:-8081}
    encode gzip zstd
}
EOF
  fi
  systemctl enable --now caddy
  echo "✅ Caddy настроен для ${DOMAIN}."
fi
