# Релиз v1.10.2

## Инфраструктурное обновление: автодеплой systemd-юнитов и bootstrap нод

Релиз **v1.10.2** закрывает разрыв в автоматизации развертывания: CI/CD теперь доставляет не только бинарники, но и systemd-юниты, а для настройки нового VPS добавлен единый bootstrap-скрипт.

---

### 1. Автодеплой systemd-юнитов в CI/CD

- В артефакты сборки добавлены `deploy/systemd/avari-master.service`, `avari-slave.service`, `avari-vless.service`.
- Деплой Master (`deploy-master`) теперь устанавливает `avari-master.service`.
- Деплой всех Slave (`deploy-slaves`) устанавливает канонический `avari-slave.service` при первом деплое (не перезаписывает node-local override), включая `ExecStartPre` создания `/etc/avari-keys` и `FIREWALL_STATE_PATH`.

### 2. Bootstrap нового VPS

- Новый скрипт [`scripts/bootstrap_node.sh`](scripts/bootstrap_node.sh): установка бинарника, systemd-юнита, настройка окружения через drop-in и запуск сервиса одной командой для `ROLE=slave` или `ROLE=master`.
- [`_docs/DEPLOY.md`](_docs/DEPLOY.md) дополнен ссылкой на автоматизацию.

---

### 🛡️ Верификация

- Bash-скрипт прошёл `bash -n`; workflow YAML прошёл валидацию `yaml.safe_load`.
- Кодовая база не менялась по логике (только версия в health-эндпоинтах и мок-данных).
