# Релиз v1.10.3

## Инфраструктура: публикация бинарников в GitHub Release и опциональный bootstrap

Релиз **v1.10.3** добавляет автоматическую публикацию бинарников в GitHub Release и расширяет bootstrap-скрипт опциональной установкой Caddy.

---

### 1. GitHub Release с бинарниками

- В CI/CD добавлен job `release`, срабатывающий на push тега `v*`: собирает статические бинарники `avari-master`/`avari-slave` для **amd64** и **arm64** и публикует их как ассеты GitHub Release (`softprops/action-gh-release`, автогенерация release-notes).
- Это основа для будущего автообновления нод (TASK-085): ноды смогут скачивать новые бинарники напрямую из Release.

### 2. Опциональный bootstrap ноды

- [`scripts/bootstrap_node.sh`](scripts/bootstrap_node.sh) расширен опциональными флагами:
  - `INSTALL_CADDY=1` + `DOMAIN` — установка Caddy и генерация Caddyfile (Master: SPA+API; Slave: reverse-proxy).
  - Подсказка по установке AmneziaWG для slave-ноды.
- Всё расширение — строго опционально, базовый сценарий (бинарник + unit + env + запуск) не изменился.

### 3. Задел на автообновление (TASK-085)

- Добавлена спецификация [`_docs/tasks/TASK-085-auto-update-release-monitoring.md`](_docs/tasks/TASK-085-auto-update-release-monitoring.md) (в бэклоге).

---

### 🛡️ Верификация

- `bash -n` для bootstrap-скрипта — PASS.
- Workflow YAML прошёл `yaml.safe_load`.
- Кодовая база без логических изменений (только версия в health-эндпоинтах и мок-данных).
