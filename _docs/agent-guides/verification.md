## 7. Команды разработки и верификации (Checklist)

Перед коммитом или передачей задачи агент обязан выполнить верификацию:

```bash
# 1. Запуск всех тестов бэкенда (с проверкой race condition)
make test
# или: cd apps/backend && go test -v -race ./...

# 2. Проверка линтером Go и Frontend
make lint
# или: cd apps/backend && go vet ./... && cd ../frontend && npm run lint

# 3. Проверка статической компиляции (Linux amd64/arm64, Zero CGO)
make build-linux
# или: cd apps/backend && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /dev/null ./cmd/master

# 4. Проверка сборки фронтенда со строгой типизацией TypeScript
cd apps/frontend && npm run build

# 5. Проверка приватного инвентаря на отсутствие утечек боевых IP (Zero-Leakage)
python3 scripts/check_private_inventory.py

# 💡 Или единый запуск всех шагов CI перед коммитом / публикацией:
make check-ci

# 6. После git push ОБЯЗАТЕЛЬНО проверить статус удаленного GitHub Actions:
gh run list --limit 3
# Доклад пользователю разрешен ТОЛЬКО после получения зеленого статуса (success)!
```

### Локальное dev-окружение:
- `make dev-ui-mock` — запуск фронтенда в чистом демо-режиме (без бэкенда) на `http://localhost:3000`.
- `make dev-ui` — запуск фронтенда с проксированием к Master API на `:8080`.
- `make dev-master` — запуск Master API (`:8080`, логин `Forve` / пароль `admin`).
- `make dev-slave-mock` — запуск Slave API в Mock-режиме на порту `:8081`.
