# TASK-074: Надежный пул IP-проверок (4 провайдера), DoH-резолвинг, детектирование зависаний WireGuard и UI ручной проверки Egress

**Дата создания**: 2026-11-22  
**Статус**: Done  
**Ветка**: `feature/TASK-074-cascade-egress-robust-multi-ip-probes-and-ui`  
**Ответственные**: Orchestrator (Architect), Developer (Go/React), QA-Tester  

---

## 1. Цели и скоуп задачи

При эксплуатации каскадной маршрутизации (Double-Hop Cascade: M0 -> S1/S2/S3/S4) были выявлены критические проблемы ложного срабатывания проверок доступности шлюзов выхода:
1. **Единая точка отказа при проверке IP**: безальтернативный запрос к `https://api.ipify.org`. Anycast-сеть Lumen (`8.6.112.0`/`8.47.69.0`) недоступна у ряда хостеров (например, 100% loss у ihor-hosting на S2 в Финляндии), из-за чего полностью рабочий сервер признавался мертвым.
2. **Отравление и блокировка DNS в РФ**: при вызове `curl --interface awgX` TCP-сокет биндится к туннелю, но DNS-резолвинг libc шел через `/etc/resolv.conf` хоста M0 в РФ. Из-за этого DNS Instagram блокировался (`exit status 6`), а ChatGPT/Grok получали поддельные региональные IP ТСПУ.
3. **Зависание неактивных сессий WireGuard (Зомби-туннели)**: резервные туннели без трафика со временем теряют состояние NAT у хостеров (`transfer: 0 B received`, handshake 15 дней назад). Нет детектирования зависания и рекомендаций по перезапуску.
4. **Отсутствие кнопки ручной проверки шлюзов в UI**: администраторы не могли на лету перепроверить статусы Egress-направлений на странице сервера или перед переключением в модальном окне.

### Ключевые требования:
- **Пул из 4 IP-провайдеров**:
  1. `https://api.ipify.org`
  2. `https://icanhazip.com`
  3. `https://ipinfo.io/ip`
  4. `https://api.myip.com` (с поддержкой парсинга JSON `{"ip":"..."}`)
- **Чистый зарубежный DNS через DoH**: использование `--doh-url https://dns.google/dns-query` (с fallback) при проверках зарубежных веб-ресурсов (ChatGPT, Grok, Meta, Telegram), изолируя проверку от российского DNS.
- **Детектирование зависаний WireGuard**: чтение `awg show <iface> dump`, проверка возраста последнего handshake и `transfer_rx == 0`. Выставление флага `is_frozen: true`, расчет `handshake_age_sec` и формирование понятной рекомендации: *"Зависла сессия WireGuard (последний handshake X мин назад, 0 B получено). Рекомендуется перезапустить службу туннеля: systemctl restart awg-quick@<iface>"*.
- **Уведомления в Telegram-бота**: отправка алерта администраторам при обнаружении зависшей сессии шлюза или недоступности с рекомендацией действия.
- **UI на странице сервера (`ServerDetailPage.tsx`)**: кнопка «Проверить шлюзы» со спиннером, отображение бейджей 5 проверок, плашки `is_frozen` и рекомендации.
- **UI в модальном окне (`AdminNodes.tsx`)**: кнопка экспресс-проверки прямо перед кликом «Переключить».
- **Telegram Mini App (`TelegramMiniApp.tsx`)**: обновление каскадной вкладки под новую схему с кнопкой проверки, бейджами проверок и предупреждениями о зависших сессиях.
- **Синхронизация Mock Mode (`mockClient.ts`)**: поддержка новых полей и сценариев в `dev:mock`.

---

## 2. Затронутые модули и файлы

- `apps/backend/internal/models/contracts.go`: расширение `EgressTarget` полями `HandshakeAgeSec`, `IsFrozen`, `Recommendation`.
- `apps/backend/internal/egress/config.go`: конфигурация `IPProviders` (4 провайдера) и `DoHURL`.
- `apps/backend/internal/egress/probe.go`: DoH резолвинг, перебор пула IP-провайдеров, парсинг JSON/текста.
- `apps/backend/internal/egress/manager.go`: сбор метрик `awg show <iface> dump`, детекция `IsFrozen`, рекомендации.
- `apps/backend/internal/telegram/bot.go`: методы нотификаций о зависших шлюзах.
- `apps/backend/internal/monitor/healthchecker.go`: интеграция проверки зависаний и передачи рекомендаций.
- `apps/frontend/src/types/index.ts`: обновление TypeScript интерфейса `EgressTarget`.
- `apps/frontend/src/api/mockClient.ts`: синхронизация мок-данных и методов.
- `apps/frontend/src/components/ServerDetailPage.tsx`: кнопка «Проверить шлюзы», плашка `is_frozen` и блок рекомендаций.
- `apps/frontend/src/components/AdminNodes.tsx`: экспресс-проверка в модальном окне Egress.
- `apps/frontend/src/components/TelegramMiniApp.tsx`: кнопка проверки шлюзов, бейджи и алерты зависания.

---

## 3. Чек-лист верификации

- [x] Модульные тесты Go: `go test -race ./...` в `apps/backend` (пройдено успешно).
- [x] Статический анализ Go: `go vet ./...` в `apps/backend` (пройдено успешно).
- [x] Zero-CGO Linux сборка: `make build-linux` (Linux amd64/arm64 собраны без C-зависимостей).
- [x] Сборка фронтенда: `cd apps/frontend && npm run build` (tsc + vite успешно без ошибок).
- [x] Проверка автономного dev:mock режима: `mockClient.ts` полностью синхронизирован.
- [x] Публикация в Git, слияние в `develop` и `main`, создание релиза `v1.7.0`.
