#!/usr/bin/env bash
# ==============================================================================
# diag_vpn.sh — Комплексная диагностика зависания VPN / WireGuard / AmneziaWG
# Проверяет:
#  1. Сетевые интерфейсы, маршруты и MTU (macOS & Linux)
#  2. Наличие признаков AmneziaWG / WireGuard интерфейсов
#  3. DNS-резолвинг через туннель и внешние DNS
#  4. ICMP пинг (локальный шлюз, VPN peer/gateway, интернет)
#  5. Path MTU (проверка фрагментации пакетов)
#  6. Прямой доступ к Endpoint VPN сервера (если передан)
#  7. Тест HTTP/HTTPS с таймаутами
#  8. Сигнатурные маркеры ТСПУ / DPI / NAT Drop
# ==============================================================================

set -o pipefail

VERSION="1.0.0"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
REPORT_FILE="${1:-diag_report_${TIMESTAMP}.md}"
ENDPOINT_INPUT="${2:-}"

# Цвета для вывода в терминал
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Буфер для Markdown отчета
log_md() {
    echo "$1" >> "$REPORT_FILE"
}

log_both() {
    echo -e "$1"
    # Очистка ANSI цветов для файла
    local plain
    plain=$(echo "$1" | sed -E $'s/\x1B\\[[0-9;]*[a-zA-Z]//g')
    echo "$plain" >> "$REPORT_FILE"
}

log_header() {
    local title="$1"
    echo ""
    echo -e "${CYAN}=== $title ===${NC}"
    echo "" >> "$REPORT_FILE"
    echo "### $title" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
}

# Инициализация отчета
rm -f "$REPORT_FILE"
cat <<EOF > "$REPORT_FILE"
# Отчет диагностики VPN / AmneziaWG
- **Дата:** $(date -u +"%Y-%m-%d %H:%M:%S UTC") ($(date +"%Z"))
- **ОС:** $(uname -s) $(uname -r) ($(uname -m))
- **Версия скрипта:** v${VERSION}

---

EOF

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}  Запуск диагностики VPN / AmneziaWG (v${VERSION})${NC}"
echo -e "${BLUE}  Отчет сохраняется в: ${YELLOW}${REPORT_FILE}${NC}"
echo -e "${BLUE}================================================================${NC}"

# 1. Сбор информации о системе и сетевых интерфейсах
log_header "1. Сетевые интерфейсы и MTU"

OS_NAME=$(uname -s)
ACTIVE_INTERFACES=""

if [ "$OS_NAME" = "Darwin" ]; then
    # macOS
    DEFAULT_IF=$(route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}')
    DEFAULT_GW=$(route -n get default 2>/dev/null | grep 'gateway:' | awk '{print $2}')
    log_both "Основной интерфейс (Default IF): ${DEFAULT_IF:-не определен}"
    log_both "Шлюз по умолчанию (Gateway): ${DEFAULT_GW:-не определен}"
    
    # Поиск wg/utun интерфейсов
    VPN_IFS=$(ifconfig -l | tr ' ' '\n' | grep -E 'utun|wg' || true)
    log_both "Обнаруженные виртуальные интерфейсы (utun/wg):"
    
    log_md '```'
    for iface in $VPN_IFS; do
        ifinfo=$(ifconfig "$iface" 2>/dev/null | grep -E 'inet |mtu|status:' || true)
        if [ -n "$ifinfo" ]; then
            echo "Интерфейс $iface:" >> "$REPORT_FILE"
            echo "$ifinfo" >> "$REPORT_FILE"
            echo -e "  - ${YELLOW}$iface${NC}: $(echo "$ifinfo" | tr '\n' ' ')"
        fi
    done
    log_md '```'
else
    # Linux
    DEFAULT_IF=$(ip route show default 2>/dev/null | awk '{print $5}' | head -n1)
    DEFAULT_GW=$(ip route show default 2>/dev/null | awk '{print $3}' | head -n1)
    log_both "Основной интерфейс (Default IF): ${DEFAULT_IF:-не определен}"
    log_both "Шлюз по умолчанию (Gateway): ${DEFAULT_GW:-не определен}"

    log_md '```'
    ip -br addr show | grep -E 'wg|tun' >> "$REPORT_FILE" 2>&1 || true
    log_md '```'
fi

# 2. Проверка маршрутизации
log_header "2. Маршрутизация (Routing Table Summary)"
log_md '```'
if [ "$OS_NAME" = "Darwin" ]; then
    netstat -rn -f inet | head -n 25 >> "$REPORT_FILE" 2>&1
else
    ip route show | head -n 25 >> "$REPORT_FILE" 2>&1
fi
log_md '```'
log_both "Маршруты сохранены в отчет."

# 3. Проверка DNS резолвинга
log_header "3. Проверка DNS резолвинга"

DNS_TARGETS=("google.com" "cloudflare.com" "habr.com")
DNS_SERVERS=("1.1.1.1" "8.8.8.8" "77.88.8.8")

log_both "Тест системного DNS (через системный resolver):"
for host in "${DNS_TARGETS[@]}"; do
    if [ "$OS_NAME" = "Darwin" ]; then
        RESOLVE_RES=$(dscacheutil -q host -a name "$host" 2>/dev/null | grep 'ip_address' | head -n1 | awk '{print $2}')
    else
        RESOLVE_RES=$(getent hosts "$host" 2>/dev/null | awk '{print $1}' | head -n1)
    fi
    if [ -z "$RESOLVE_RES" ]; then
        RESOLVE_RES=$(host -W 2 "$host" 2>/dev/null | grep 'has address' | head -n1 | awk '{print $4}' || true)
    fi

    if [ -n "$RESOLVE_RES" ]; then
        log_both "  [$GREEN OK $NC] $host -> $RESOLVE_RES"
    else
        log_both "  [$RED FAIL $NC] $host -> Не удалось разрезолвить (DNS Timeout / Drop)"
    fi
done

log_both "\nТест прямых UDP DNS запросов к публичным серверам (порт 53):"
for ns in "${DNS_SERVERS[@]}"; do
    if command -v dig >/dev/null 2>&1; then
        DIG_OUT=$(dig @$ns cloudflare.com +time=2 +tries=1 +short 2>/dev/null)
        if [ -n "$DIG_OUT" ]; then
            log_both "  [$GREEN OK $NC] dig @$ns: $DIG_OUT"
        else
            log_both "  [$RED FAIL $NC] dig @$ns: Нет ответа (UDP 53 блокируется / завис)"
        fi
    elif command -v nslookup >/dev/null 2>&1; then
        if nslookup -timeout=2 cloudflare.com "$ns" >/dev/null 2>&1; then
            log_both "  [$GREEN OK $NC] nslookup @$ns успешен"
        else
            log_both "  [$RED FAIL $NC] nslookup @$ns тайм-аут"
        fi
    fi
done

# 4. Проверка ICMP пинга и задержек
log_header "4. Проверка ICMP (Пинг)"

PING_HOSTS=("1.1.1.1" "8.8.8.8" "77.88.8.8")
for ip in "${PING_HOSTS[@]}"; do
    if [ "$OS_NAME" = "Darwin" ]; then
        PING_CMD="ping -c 3 -W 1500 $ip"
    else
        PING_CMD="ping -c 3 -W 2 $ip"
    fi
    
    PING_OUT=$($PING_CMD 2>&1 || true)
    LOSS=$(echo "$PING_OUT" | grep -oE '[0-9]+(\.[0-9]+)?% packet loss' || echo "100% packet loss")
    AVG_RTT=$(echo "$PING_OUT" | grep -oE '(round-trip|rtt) [^=]+= [^/]+/[^/]+' | awk -F'/' '{print $2}' || echo "N/A")
    
    if echo "$LOSS" | grep -qE '^0(\.0)?%'; then
        log_both "  [$GREEN OK $NC] $ip: Loss: $LOSS, Avg RTT: ${AVG_RTT}ms"
    elif echo "$LOSS" | grep -q "100"; then
        log_both "  [$RED 100% DROP $NC] $ip: Полная потеря пакетов"
    else
        log_both "  [${YELLOW} LOSS $NC] $ip: Loss: $LOSS, Avg RTT: ${AVG_RTT}ms"
    fi
    echo "$PING_OUT" >> "$REPORT_FILE"
done

# 5. Тестирование Path MTU (фрагментация пакетов)
log_header "5. Тест Path MTU (Фрагментация DF бит)"
log_both "Проверка прохождения пакетов разного размера без фрагментации (DF flag):"

# Размеры ICMP payload (IP hdr 20b + ICMP hdr 8b = 28b. 1472 payload = 1500 MTU; 1392 = 1420 MTU; 1252 = 1280 MTU)
# macOS: ping -D -s <size>
# Linux: ping -M do -s <size>
TEST_SIZES=(1252 1332 1392 1472)
MTU_EQUIV=("1280 (Min safe)" "1360 (AWG Rec)" "1420 (WG Default)" "1500 (Standard)")

for idx in "${!TEST_SIZES[@]}"; do
    sz="${TEST_SIZES[$idx]}"
    equiv="${MTU_EQUIV[$idx]}"
    if [ "$OS_NAME" = "Darwin" ]; then
        MTU_RES=$(ping -c 2 -D -s "$sz" 1.1.1.1 2>&1 || true)
    else
        MTU_RES=$(ping -c 2 -M do -s "$sz" 1.1.1.1 2>&1 || true)
    fi

    if echo "$MTU_RES" | grep -q "0.0% packet loss\|0% packet loss"; then
        log_both "  [$GREEN PASS $NC] Payload: ${sz}b (MTU ~$equiv) проходит успешно"
    elif echo "$MTU_RES" | grep -qi "message too long\|frag needed"; then
        log_both "  [${YELLOW} FRAG $NC] Payload: ${sz}b (MTU ~$equiv) требует фрагментации (Message too long)"
    else
        log_both "  [$RED DROP $NC] Payload: ${sz}b (MTU ~$equiv) заблокирован или дропнут"
    fi
done

# 6. Проверка HTTP / HTTPS соединений
log_header "6. Проверка HTTP/HTTPS и определение внешнего IP"

CURL_OPTS=("-s" "--connect-timeout" "4" "--max-time" "7")

EXT_IP=$(curl "${CURL_OPTS[@]}" https://api.ipify.org 2>/dev/null || curl "${CURL_OPTS[@]}" https://ifconfig.me 2>/dev/null || echo "FAIL")
if [ "$EXT_IP" != "FAIL" ] && [ -n "$EXT_IP" ]; then
    log_both "  [$GREEN OK $NC] Внешний исходящий IP: ${YELLOW}$EXT_IP${NC}"
else
    log_both "  [$RED FAIL $NC] Не удалось определить внешний IP (HTTP запросы не проходят)"
fi

HTTP_TESTS=(
    "https://www.google.com"
    "https://cloudflare.com"
    "https://www.wikipedia.org"
    "https://rutracker.org"
)

log_both "\nТест доступности популярных ресурсов:"
for url in "${HTTP_TESTS[@]}"; do
    HTTP_CODE=$(curl "${CURL_OPTS[@]}" -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    TIME_TOTAL=$(curl "${CURL_OPTS[@]}" -o /dev/null -w "%{time_total}" "$url" 2>/dev/null || echo "0")
    if [ -n "$HTTP_CODE" ] && [ "$HTTP_CODE" != "000" ] && [[ ! "$HTTP_CODE" =~ ^000 ]]; then
        log_both "  [$GREEN OK $NC] $url -> Code: $HTTP_CODE (${TIME_TOTAL}s)"
    else
        log_both "  [$RED TIMEOUT $NC] $url -> Соединение сброшено / тайм-аут"
    fi
done

# 7. Проверка Endpoint VPN сервера (если передан пользователем)
if [ -n "$ENDPOINT_INPUT" ]; then
    log_header "7. Проверка Endpoint VPN Сервера ($ENDPOINT_INPUT)"
    EP_IP=$(echo "$ENDPOINT_INPUT" | awk -F':' '{print $1}')
    EP_PORT=$(echo "$ENDPOINT_INPUT" | awk -F':' '{print $2}')
    
    log_both "Пинг до IP сервера ($EP_IP):"
    ping -c 3 "$EP_IP" 2>&1 | tee -a "$REPORT_FILE" || true

    if [ -n "$EP_PORT" ]; then
        log_both "\nПроверка UDP доступности порта $EP_PORT (nc -zvu):"
        if nc -z -v -u -w 3 "$EP_IP" "$EP_PORT" 2>&1 | tee -a "$REPORT_FILE"; then
            log_both "  [INFO] UDP сокет открыт/пакет отправлен"
        else
            log_both "  [WARN] UDP порт не ответил (нормально для WireGuard, если нет handshake)"
        fi
    fi
fi

# 8. Анализ и предварительный диагноз
log_header "8. Анализ симптомов и предварительный диагноз"

DIAGNOSIS=""
RECOMMENDATION=""

if [ "$EXT_IP" = "FAIL" ]; then
    # Трафик вообще не идет
    DIAGNOSIS="КРИТИЧЕСКИЙ СБОЙ: Полный блэкаут трафика через текущее подключение."
    RECOMMENDATION="- Если VPN включен: возможно, туннель перехватил дефолтный маршрут (0.0.0.0/0), но хэндшейк с сервером не состоялся или заблокирован ТСПУ.\n- Проверьте в интерфейсе AmneziaWG: растут ли TX пакеты при 0 RX?\n- Если TX растет, а RX=0 — 100% блокировка UDP-порта или сигнатуры ТСПУ."
elif [[ "$HTTP_CODE" == "000" ]]; then
    DIAGNOSIS="ПРОБЛЕМА С HTTPS/TCP: Внешний IP определился, но целевые HTTPS сайты сбрасываются."
    RECOMMENDATION="- Высокая вероятность Path MTU Blackhole (проблема MTU) или избирательной блокировки TCP SNI.\n- Попробуйте уменьшить MTU до 1360 или 1280 в настройках интерфейса."
else
    DIAGNOSIS="БАЗОВЫЙ ТРАФИК ИДЕТ: Соединение живо на момент проверки."
    RECOMMENDATION="- Если зависание происходит периодически во время простоя: добавьте 'PersistentKeepalive = 20' или 15 в секцию [Peer].\n- Если зависает только при тяжелом трафике/скачивании: уменьшите MTU до 1360."
fi

log_both "${YELLOW}${DIAGNOSIS}${NC}"
echo "" >> "$REPORT_FILE"
echo "**Рекомендация:**" >> "$REPORT_FILE"
echo -e "$RECOMMENDATION" >> "$REPORT_FILE"
echo -e "${CYAN}Рекомендация:${NC}\n$RECOMMENDATION"

log_both "\n${GREEN}Диагностика завершена!${NC}"
log_both "Файл отчета: ${YELLOW}${REPORT_FILE}${NC}"
log_both "Вы можете отправить содержимое ${YELLOW}${REPORT_FILE}${NC} агенту для детального анализа."
