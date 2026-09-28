# TASK-025: Перенастройка CI/CD на сервер 176.53.174.118 (keys.avari.dev / OpenResty Manager)

## Описание задачи
Перенастроить пайплайн непрерывной интеграции и доставки (CI/CD) в GitHub Actions для деплоя на новый боевой Master-сервер:
- **IP**: `176.53.174.118`
- **Домен**: `keys.avari.dev`
- **Веб-сервер / Reverse Proxy**: OpenResty Manager / Nginx

## Выполненные работы
1. **GitHub Actions Workflow (`.github/workflows/ci-cd.yml`)**:
   - Обновлен дефолтный хост для деплоя на `176.53.174.118`.
   - Деплой фронтенда настроен с учетом OpenResty (`systemctl reload openresty || systemctl reload nginx || systemctl reload caddy`).
   - Деплой Master API (`avari-master`) и Slave API (`avari-slave`) настроен с дефолтом на `176.53.174.118`.
2. **Конфигурация OpenResty / Nginx (`deploy/openresty/keys.avari.dev.conf`)**:
   - Создан готовый конфиг виртуального хоста для `keys.avari.dev`.
   - Настроена раздача статики React SPA из `/var/www/avari-keys/frontend` с роутинг-фоллбеком на `index.html`.
   - Настроен reverse proxy для `/api/` на `http://127.0.0.1:8080` с поддержкой WebSocket и правильной передачей заголовков.
3. **Документация (`_docs/CICD.md`)**:
   - Обновлена инструкция по добавлению SSH-ключей, переменных GitHub Secrets и настройке OpenResty Manager.
