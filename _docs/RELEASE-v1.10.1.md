# Релиз v1.10.1

## Hotfix: восстановление автоматического деплоя нод

Релиз **v1.10.1** устраняет утечку реальных production-IP в тестовые и мок-файлы, которая блокировала security-проверку CI/CD (`check_private_inventory.py`) и останавливала автоматическое обновление нод начиная с v1.7.0.

---

### Что исправлено

- **Санитизация утёкших IP**: Реальные адреса нод заменены на документационные (RFC 5737, диапазон `192.0.2.0/24`) в:
  - [`apps/backend/internal/egress/egress_test.go`](apps/backend/internal/egress/egress_test.go) — мок-эндпоинты каскада и probe-цели.
  - [`apps/frontend/src/api/mockClient.ts`](apps/frontend/src/api/mockClient.ts) — демо-данные ключей, нод и egress.
- **Восстановление CI/CD**: security-проверка «Check private deployment inventory» снова проходит, пайплайн разблокирован.

### Влияние на артефакты

- Backend-бинарники `avari-master`/`avari-slave` не меняются по логике (правки только в тестах и мок-данных фронтенда).
- Фронтенд-бандл обновляется (мок-данные теперь без реальных адресов).

---

### 🛡️ Верификация

- `go test -race ./...` — PASS.
- `go vet ./...` — PASS.
- `npm run build` (tsc strict) — PASS.
- CI/CD: шаг `Check private deployment inventory` — ✓ PASS.
