# TASK-061: Оптимизация и повышение отказоустойчивости автоматического деплоя Slave-нод в CI/CD

## 1. Цели и скоуп
- **Проблема**: Пайплайн `CI/CD Pipeline / ⚡ Deploy All Slave Nodes (Automated)` падал на шаге деплоя второй ноды (S1) с ошибкой `Connection timed out during banner exchange` / `Connection to UNKNOWN port 65535 timed out`.
- **Причины**:
  1. Глобальный `ControlMaster auto` для `Host *` вступал в конфликт с `-J` (`ProxyJump`), когда дочерний процесс проксирования `ssh -W` и родительский процесс деплоя пытались делить один сокет мультиплексирования.
  2. Запуск `ssh-keyscan` напрямую с IP runner'а перед подключением через Jump Host посылал пачку из 5 параллельных запросов на порт 22, триггеря UFW rate-limit на S1 (`-m recent --hitcount 6 --seconds 30`). При наличии `StrictHostKeyChecking=accept-new` вызов `ssh-keyscan` полностью избыточен.
  3. Таймаут `ConnectTimeout=15` был слишком коротким для многокаскадного международного маршрута (Runner -> Москва Jump Host -> Германия S1).
  4. Отсутствие повторных попыток (retries) при транзиентных задержках рукопожатия SSH.
- **Решение**:
  - Устранить конфликт `ControlMaster` на `Host *`.
  - Увеличить `ConnectTimeout` до 30 секунд, добавить `ServerAliveInterval 10`, `ServerAliveCountMax 3`, `TCPKeepAlive yes`.
  - Убрать избыточный `ssh-keyscan`, вызывающий скачки rate-limit на нодах.
  - Внедрить политику повторных попыток (до 3 попыток с экспоненциальной/линейной паузой) для каждой slave-ноды.

## 2. Затронутые модули и файлы
- `.github/workflows/ci-cd.yml`: блок `deploy-slaves`.
- `scripts/deploy_slave_nodes.sh`: увеличение таймаута проверки доступности до 10 сек.
- `_docs/TASKS.md`: добавление задачи TASK-061.

## 3. Чек-лист верификации
- [x] Анализ причин сбоя в логах GitHub Actions (Run ID: 42361578682) и journalctl на серверах S0, S1, S4.
- [x] Диагностика кластера (все ноды и сервисы в строю).
- [x] Устранение конфликта мультиплексирования SSH и UFW rate-limit.
- [x] Прогон `make test` и `make lint`.
- [x] Прогон `make build-linux` и `npm run build`.
- [x] Подготовка патч-релиза v1.2.1 по Gitflow.
