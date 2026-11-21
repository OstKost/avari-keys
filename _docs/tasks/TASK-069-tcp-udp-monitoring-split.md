# TASK-069: Разделение проверок TCP / UDP в сетевом мониторинге, аудит протоколов VPN и устойчивость маршрутизации Master

## Статус: ✅ Done
**Ветка**: `feature/TASK-069-tcp-udp-monitoring-split`

---

## 1. Цели и скоуп

1. **Устойчивость маршрутизации Master (M0 -> S3, S4)**:
   - Добавление сингапурского узла S3 (`157.228.130.7/32`) и узла VDSina S4 (`109.107.176.224/32`) в `AllowedIPs` AmneziaWG-туннеля `awg0` на M0 (рядом с S2).
   - Это гарантирует бесперебойную связь Master Backend со Slave API всех нод для выпуска ключей и сбора статистики трафика в обход произвольных ТСПУ-блокировок веб-портов напрямую из РФ.

2. **Точная классификация причин сбоев в `netprobe`**:
   - Обновление диагностических заключений зонда (`models.NetworkProbe.Reason`):
     - При несовпадении DNS: четкое указание `"DNS не содержит настроенный публичный IP узла"`.
     - При сбое только TCP-порта при успешном ICMP Ping (типичный паттерн блокировок веб-трафика ТСПУ): `"TCP-порт (HTTP/S) заблокирован ТСПУ/провайдером. Замаскированный UDP-трафик VPN (AmneziaWG/Hysteria2) работает независимо"`.
     - При полном отказе ICMP и TCP: `"Узел полностью недоступен по публичной сети (ICMP и TCP не отвечают)"`.

3. **Разделение уровней диагностики в UI (ServerDetailPage & AdminNodes)**:
   - В [ServerDetailPage.tsx](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/components/ServerDetailPage.tsx):
     - Структурирование блока сетевых зондов на протокольные уровни:
       - **🌐 Публичная доступность (DNS, ICMP Ping, TCP Веб-порт)**.
       - Вывод информационного уведомления с пояснением, если TCP блокируется ТСПУ, но ICMP и VPN в порядке.
       - **🛡️ VPN-протоколы и туннелирование (UDP)**: статус AmneziaWG (UDP 443), Hysteria 2 (UDP 8443), активность пиров и свежесть хэндшейков.
       - **⚙️ Служебный контур (Master ↔ Slave API)**: прямой отклик API управления.
   - В [AdminNodes.tsx](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/components/AdminNodes.tsx):
     - В аккордеоне проверок M0 / S0 визуальное разделение протоколов (`ICMP`, `TCP`, `DNS`) и понятные подсказки.
   - Синхронизация [mockClient.ts](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/api/mockClient.ts) для режима `dev:mock`.

---

## 2. Затронутые модули и файлы

- `apps/backend/internal/netprobe/probe.go` — дифференцированная логика формирования `Reason` при сбоях TCP vs ICMP vs DNS.
- `apps/backend/internal/netprobe/probe_test.go` — модульные тесты новых диагностических заключений.
- `apps/frontend/src/components/ServerDetailPage.tsx` — структурирование протоколов, бейджи и баннер ТСПУ/UDP.
- `apps/frontend/src/components/AdminNodes.tsx` — визуальная маркировка протоколов в проверках зонда.
- `apps/frontend/src/api/mockClient.ts` — синхронизация тестовых мок-данных зондов.
- `_docs/TASKS.md` — обновление канбан-доски.

---

## 3. Чек-лист верификации

- [ ] Все тесты бэкенда `make test` проходят без регрессий.
- [ ] Линтер `make lint` проходит без замечаний.
- [ ] Сборка фронтенда `npm run build` завершается успешно без TypeScript ошибок.
- [ ] В автономном режиме `npm run dev:mock` отображаются протокольные бейджи и пояснения.
- [ ] На боевом сервере M0 проверена связь со всеми 7 нодами кластера.
