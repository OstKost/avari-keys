# 🚀 Безопасный CI/CD пайплайн (GitHub Actions -> VPS 176.53.174.118 / keys.avari.dev)

Настроен автоматический, безопасный и атомарный процесс непрерывной интеграции и доставки (CI/CD) на базе **GitHub Actions**.

---

## 🏗 Архитектура и Режимы работы

Пайплайн разделен на автоматическую и ручную части для обеспечения максимальной стабильности продакшена:

```mermaid
flowchart TD
    subgraph CI["1. CI (Автоматически на PR и push)"]
        A["Push в develop / main / master"] --> B["Go Vet & Race Tests"]
        A --> C["Сборка статических Go бинарников (amd64)"]
        A --> D["Сборка React SPA (npm run build)"]
    end

    subgraph CD_Auto["2. Автоматический деплой на push в main"]
        D --> E{"Push в main / master?"}
        E -- Да --> F["Деплой Frontend SPA на Master VPS (176.53.174.118)"]
        E -- Да --> G["Деплой avari-master на Master VPS (176.53.174.118)"]
        E -- Да --> H["Атомарный деплой avari-slave на ВСЕ Slave-ноды"]
    end

    subgraph CD_Manual["3. Ручной деплой (On-Demand / Dispatch)"]
        I["Вкладка Actions -> Run workflow"] --> J{"Выбор цели (Target)"}
        J -- master-api --> K["Деплой avari-master"]
        J -- slave-api / all-slaves --> L["Деплой avari-slave на один или все хосты"]
        J -- all --> M["Полный деплой всех компонентов"]
    end
```

| Компонент | Как обновляется | Описание |
|---|---|---|
| **Frontend Web SPA** | **Автоматически** при каждом push/merge в `main` | Атомарный swap статики в `/var/www/avari-keys/frontend` на Master сервере. |
| **Master API (`avari-master`)** | **Автоматически** при push в `main` (или вручную) | Обновляет бинарник в `/usr/local/bin/avari-master` и перезапускает systemd сервис `avari-master`. |
| **Slave API (`avari-slave`)** | **Автоматически** при push в `main` (или вручную) | Атомарно обновляет бинарник и перезапускает `avari-slave` на всех нодах сети (`176.53.174.118`, `185.213.240.136`, `157.228.142.20`, `157.228.130.7`). |

---

## 🔒 Принципы безопасности

1. **Изоляция секретов**: Пароли и ключи хранятся исключительно в зашифрованных GitHub Secrets (`SSH_PRIVATE_KEY`).
2. **ED25519 SSH-ключи**: Выделенный SSH-ключ, созданный только для CI/CD.
3. **Атомарная замена (Atomic Swap)**:
   - Файлы загружаются во временную директорию `/tmp/avari-...`.
   - Применяются через утилиты `install -m 755` и `rsync --delete`, исключая повреждение бинарников или незавершенную загрузку.
4. **Health Check**: После рестарта сервис опрашивается на статус `active`. Если сервис упал — GitHub Actions завершится с ошибкой и уведомит вас.
5. **Защита от состояния гонки (Race conditions)**: Независимые блокировки `concurrency` для деплоя фронтенда и бэкенда.

---

## 📋 Первоначальная настройка сервера (176.53.174.118)

### Шаг 1. Настройка SSH-доступа для GitHub Actions

На локальном компьютере или сервере:
```bash
# Скопировать публичный ключ на сервер:
ssh-copy-id -i ~/.ssh/github_deploy_key.pub root@176.53.174.118

# Проверить подключение:
ssh -i ~/.ssh/github_deploy_key root@176.53.174.118 "echo 'SSH доступ успешно настроен!'"
```

*Если ключ создается с нуля:*
```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy_key -N ""
```

---

### Шаг 2. Создание директорий и Systemd-сервиса на VPS

Выполните на сервере `176.53.174.118`:
```bash
# Создание рабочих директорий
mkdir -p /opt/avari-keys/data /var/www/avari-keys/frontend

# Скопировать сервис deploy/systemd/avari-master.service в /etc/systemd/system/
systemctl daemon-reload
systemctl enable avari-master
```

---

### Шаг 3. Настройка OpenResty Manager / Nginx для keys.avari.dev

В OpenResty Manager (или конфигурационном файле `/etc/nginx/conf.d/keys.avari.dev.conf`):

1. **Статика фронтенда**:
   - `root`: `/var/www/avari-keys/frontend`
   - `index`: `index.html`
   - `try_files`: `$uri $uri/ /index.html;`
2. **Reverse Proxy для Master API**:
   - `location /api/` $\to$ `http://127.0.0.1:8080` (с поддержкой WebSocket и передачей заголовков `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`).
3. Шаблон готовой конфигурации находится в [`deploy/openresty/keys.avari.dev.conf`](file:///Volumes/KingstonM2/Projects/avari-keys-mvp/deploy/openresty/keys.avari.dev.conf).

---

### Шаг 4. Добавление Секрета в GitHub

1. Откройте репозиторий на GitHub: **`https://github.com/OstKost/avari-keys-mvp`**.
2. Перейдите в **Settings** $\to$ **Secrets and variables** $\to$ **Actions**.
3. Обновите / добавьте секреты:

| Название секрета | Обязательно? | Значение по умолчанию | Описание |
|---|---|---|---|
| **`SSH_PRIVATE_KEY`** | **Да (Критично)** | *(нет)* | Полное содержимое приватного ключа `~/.ssh/github_deploy_key` (включая строки `-----BEGIN OPENSSH PRIVATE KEY-----` и `-----END OPENSSH PRIVATE KEY-----`). |
| `SSH_HOST` | Нет | `176.53.174.118` | IP-адрес или домен (`keys.avari.dev`). |
| `SSH_USER` | Нет | `root` | Пользователь на сервере. |
| `SSH_PORT` | Нет | `22` | Порт SSH. |

---

## 🎯 Как запускать обновления

### 1. Автоматический деплой Frontend & Backend:
- Происходит **полностью автоматически** при любом коммите или merge в ветку `main` / `master`.

### 2. Ручной деплой (On-Demand):
1. Перейдите на вкладку **Actions** в репозитории на GitHub.
2. В левой колонке выберите **CI/CD Pipeline**.
3. Нажмите синюю кнопку **Run workflow**:
   - **Branch**: `main` (или нужная ветка).
   - **Компонент для деплоя**: `all`, `master-api`, `frontend-only`, `slave-api`.
   - **IP/Хост целевого VPS**: по умолчанию `176.53.174.118`.
4. Нажмите зеленую кнопку **Run workflow**.

---

## 🛠 Полезные команды на VPS для проверки:

```bash
# Проверить статус Master API и веб-сервера
systemctl status avari-master openresty --no-pager

# Просмотр логов бэкенда в реальном времени
journalctl -u avari-master -f

# Проверить версию бинарника
ls -la /usr/local/bin/avari-master
```
