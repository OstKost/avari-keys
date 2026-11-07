# TASK-025: Перенастройка CI/CD на сервер 192.0.2.10 (keys.example.net / OpenResty Manager)

## Описание задачи
Перенастроить пайплайн непрерывной интеграции и доставки (CI/CD) в GitHub Actions для деплоя на новый боевой Master-сервер:
- **IP**: `192.0.2.10`
- **Домен**: `keys.example.net`
- **Веб-сервер / Reverse Proxy**: OpenResty Manager / Nginx

## Выполненные работы
1. **GitHub Actions Workflow (`.github/workflows/ci-cd.yml`)**:
   - Обновлен дефолтный хост для деплоя на `192.0.2.10`.
   - Деплой фронтенда настроен с учетом OpenResty (`systemctl reload openresty || systemctl reload nginx || systemctl reload caddy`).
   - Деплой Master API (`avari-master`) и Slave API (`avari-slave`) настроен с дефолтом на `192.0.2.10`.
2. **Конфигурация OpenResty / Nginx (`deploy/openresty/keys.example.net.conf`)**:
   - Создан готовый конфиг виртуального хоста для `keys.example.net`.
   - Настроена раздача статики React SPA из `/var/www/avari-keys/frontend` с роутинг-фоллбеком на `index.html`.
   - Настроен reverse proxy для `/api/` на `http://127.0.0.1:8080` с поддержкой WebSocket и правильной передачей заголовков.
3. **Документация (`_docs/CICD.md`)**:
   - Обновлена инструкция по добавлению SSH-ключей, переменных GitHub Secrets и настройке OpenResty Manager.
