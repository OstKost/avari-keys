# TASK-068: Усиление Egress каскада: Fast Retry сбоев (30с), Safety Gate по IP, UI-детализация проверок и CI/CD автоматизация

## Статус: ✅ Done
**Ветка**: `feature/TASK-068-cascade-egress-hardening`

---

## 1. Цели и скоуп

1. **Fast Confirmation Retry для Auto-Failover (реакция за 30 секунд)**:
   - При обнаружении сбоя активного выхода каскада в цикле HealthChecker (раз в 3 мин) контроллер не ждет следующие 3 минуты для подтверждения сбоя (`FailureThreshold = 2`).
   - Вместо этого контроллер выполняет быструю контрольную перепроверку через короткую паузу (15–20 секунд). Если сбой подтверждается, счетчик достигает 2 и автопереключение срабатывает за ~30 секунд, защищая пользователей от долгого простоя.

2. **Mandatory Safety Gate по IP (защита от утечки прямого трафика)**:
   - Проверка `api.ipify.org` становится обязательным шлюзом безопасности (Safety Gate).
   - Если исходящий IP не совпадает с эндпоинтом выхода (`target.Endpoint`), направление бракуется безусловно (`available = false`), предотвращая деанонимизацию и утечку прямого трафика в сеть РФ.
   - Общее правило: направление считается доступным, если IP подтвержден И успешно ответили минимум 2 из 4 остальных сервисов (Telegram, ChatGPT, Grok, Meta).

3. **Детализация проверок в DTO и UI (Observability)**:
   - В структуру `models.EgressTarget` добавляются поля `PassedChecks int`, `TotalChecks int` и массив `Checks []TargetProbeResult` с именами сервисов (`ip`, `telegram`, `chatgpt`, `grok`, `meta`) и их индивидуальными статусами.
   - В веб-интерфейсе ([ServerDetailPage.tsx](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/components/ServerDetailPage.tsx) и [AdminNodes.tsx](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/apps/frontend/src/components/AdminNodes.tsx)) выводятся наглядные бейджи по каждому сервису (`[IP: ✅] [TG: ✅] [GPT: ✅] [Grok: ✅] [Meta: ❌] (4/5)`).
   - Синхронно обновляется `mockClient.ts` для автономного режима `dev:mock`.

4. **CI/CD Автоматизация симлинка**:
   - В [scripts/deploy_slave_nodes.sh](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/scripts/deploy_slave_nodes.sh) добавляется автоматическое создание симлинка `/usr/local/libexec/avari-egress -> /usr/local/bin/avari-slave`.

---

## 2. Затронутые модули и файлы

- `apps/backend/internal/models/contracts.go` — поля `Checks`, `PassedChecks`, `TotalChecks` в `EgressTarget`, структура `TargetProbeResult`.
- `apps/backend/internal/egress/probe.go` — структура `ProbeReport`, логика Safety Gate по IP и возврат списка проверок.
- `apps/backend/internal/egress/manager.go` — заполнение полей `Checks`, `PassedChecks`, `TotalChecks` в результатах `GetStatus`.
- `apps/backend/internal/monitor/healthchecker.go` — Fast Confirmation Retry при первом сбое активного шлюза каскада.
- `apps/backend/internal/egress/egress_test.go` — тесты Safety Gate, детализации проверок и быстрого ретрая.
- `apps/frontend/src/types/index.ts` — типизация `TargetProbeResult`, `checks`, `passed_checks`, `total_checks`.
- `apps/frontend/src/api/mockClient.ts` — синхронизация мок-данных DTO.
- `apps/frontend/src/components/AdminNodes.tsx` & `ServerDetailPage.tsx` — отображение бейджей проверок.
- `scripts/deploy_slave_nodes.sh` — создание симлинка на узлах.
- `_docs/TASKS.md` — канбан-доска.

---

## 3. Чек-лист верификации

- [x] `go test -v -race ./...` проходит без ошибок.
- [x] IP mismatch бракует выход даже при ответе остальных 4 сервисов.
- [x] Быстрый ретрай подтверждает падение выхода и переключает каскад за ~15-30 сек.
- [x] Сборка фронтенда `npm run build` проходит без ошибок TypeScript.
- [x] В `dev:mock` и реальном API отображаются бейджи `[IP] [TG] [GPT] [Grok] [Meta]`.
