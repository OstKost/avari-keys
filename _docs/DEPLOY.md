# Инструкция по полному развертыванию Avari Keys MVP

В этом руководстве детально описан пошаговый процесс развертывания распределенной VPN-инфраструктуры Avari Keys:
- **Сервер M0 (РФ)**: Master Web UI (React SPA), Master Backend API (Go), Cascade Slave API (AWG Ingress).
- **Сервер S1 (EU/Зарубеж)**: Cascade Egress (шлюз выхода в интернет).
- **Сервер S2 (EU/Зарубеж)**: Автономный прямой узел AWG (Direct Slave API).

---

## 📑 Содержание
1. [Сборка и артефакты (Нужны ли .env перед сборкой?)](#1-сборка-и-артефакты)
2. [Таблица параметров и откуда брать данные](#2-таблица-параметров-и-откуда-брать-данные)
3. [Настройка DNS-записей доменов](#3-настройка-dns-записей-доменов)
4. [Шаг 0: Подготовка серверов и остановка конфликтующих веб-серверов](#шаг-0-подготовка-серверов-и-остановка-конфликтующих-веб-серверов)
5. [Шаг 1: Установка AmneziaWG и настройка Каскада](#шаг-1-установка-amneziawg-и-настройка-каскада)
6. [Шаг 2: Установка веб-сервера Caddy](#шаг-2-установка-веб-сервера-caddy)
7. [Шаг 3: Развертывание Master-сервера M0 (РФ)](#шаг-3-развертывание-master-сервера-m0-рф)
8. [Шаг 4: Развертывание Standalone Slave-сервера S2 (Зарубеж)](#шаг-4-развертывание-standalone-slave-сервера-s2-зарубеж)
9. [Шаг 5: Первичная настройка через Web UI](#шаг-5-первичная-настройка-через-web-ui)
10. [Полезные команды обслуживания и Траблшутинг](#полезные-команды-обслуживания-и-траблшутинг)

---

## 1. Сборка и артефакты

### ❓ Нужно ли заполнять какие-то `.env` перед сборкой?
**НЕТ, перед сборкой ничего заполнять не нужно!**
- **Go-бинарники (`avari-master`, `avari-slave`)**: компилируются в полностью автономные статические бинарники (`CGO_ENABLED=0`). Все переменные конфигурации они считывают **в рантайме на самом сервере** из переменных окружения (задаются в systemd-сервисах).
- **Frontend SPA**: собран для работы в продакшене. Все запросы к API отправляются по относительному пути `/api/v1` и проксируются веб-сервером Caddy.

### Команды компиляции (на локальном компьютере):
```bash
# 1. Сборка бинарников под Linux x86_64 (amd64) и Linux ARM64 (aarch64)
mkdir -p dist/linux-amd64 dist/linux-arm64 dist/frontend

cd apps/backend
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/linux-amd64/avari-master ./cmd/master
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/linux-amd64/avari-slave ./cmd/slave

GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/linux-arm64/avari-master ./cmd/master
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/linux-arm64/avari-slave ./cmd/slave

# 2. Сборка Frontend SPA
cd ../frontend
npm run build
cp -r dist/* ../../dist/frontend/
cd ../..
```

### Где лежат готовые файлы для копирования:
- **Для стандартных VPS (Intel / AMD x86_64)**:
  - `dist/linux-amd64/avari-master` — Master Backend API
  - `dist/linux-amd64/avari-slave` — Slave API (обертка над AWG)
- **Для ARM VPS (Oracle ARM, Ampere aarch64)**:
  - `dist/linux-arm64/avari-master`
  - `dist/linux-arm64/avari-slave`
- **Веб-интерфейс (Frontend SPA)**:
  - `dist/frontend/` — папка со статикой (`index.html`, `assets/`, `favicon.png`).

---

## 2. Таблица параметров и откуда брать данные

Перед началом развертывания выпишите себе значения следующих переменных:

| Плейсхолдер | Пример значения | Что это такое | Откуда брать данные |
|---|---|---|---|
| `<M0_IP>` | `185.22.15.10` | Публичный IPv4 сервера **M0 (РФ)** | Панель хостинга РФ VPS или команда `curl -4 ifconfig.me` на M0 |
| `<S1_IP>` | `192.0.2.10` | Публичный IPv4 сервера **S1 (EU Egress)** | Панель хостинга зарубежного VPS или команда `curl -4 ifconfig.me` на S1 |
| `<S2_IP>` | `192.0.2.10` | Публичный IPv4 сервера **S2 (EU Direct)** | Панель хостинга зарубежного VPS или команда `curl -4 ifconfig.me` на S2 |
| `<M0_DOMAIN>` | `m0.yourdomain.com` | Домен для входа в панель Master Web UI | Придумать поддомен и создать DNS A-запись на `<M0_IP>` |
| `<S1_DOMAIN>` | `s1.yourdomain.com` | Домен для Cascade Slave API на M0 | Придумать поддомен и создать DNS A-запись на `<M0_IP>` |
| `<S2_DOMAIN>` | `s2.yourdomain.com` | Домен для Direct Slave API на S2 | Придумать поддомен и создать DNS A-запись на `<S2_IP>` |
| `<ADMIN_PASSWORD>` | *(любой стойкий пароль)* | Пароль администратора `Forve` | Придумать свой или взять автосгенерированный из логов `avari-master` |
| `<JWT_SECRET>` | `a9f8e7d6c5...` | Секретный ключ подписи JWT-токенов | Сгенерировать командой `openssl rand -hex 32` |
| `<SLAVE_KEY_M0>` | `m0_sec_token_...` | Токен доступа к Slave API на M0 | Придумать ключ или взять автосгенерированный из логов `avari-slave` |
| `<SLAVE_KEY_S2>` | `s2_sec_token_...` | Токен доступа к Slave API на S2 | Придумать ключ или взять автосгенерированный из логов `avari-slave` |

---

## 3. Настройка DNS-записей доменов

В панели управления вашим доменом (Cloudflare, Reg.ru, Beget, Namecheap и т.п.) добавьте следующие **A-записи**:

```
Тип: A | Имя: m0 | Значение: <M0_IP> | Проксирование: DNS Only (Отключено)
Тип: A | Имя: s1 | Значение: <M0_IP> | Проксирование: DNS Only (Отключено)
Тип: A | Имя: s2 | Значение: <S2_IP> | Проксирование: DNS Only (Отключено)
```

> ⚠️ **Важно**: Если используете Cloudflare, отключите оранжевое облако (Proxy status: **DNS only**), чтобы Caddy мог автоматически выпустить TLS/SSL сертификаты Let's Encrypt через HTTP-01 challenge.

---

## Шаг 0: Подготовка серверов и остановка конфликтующих веб-серверов

На многих чистых образах VPS провайдеры по умолчанию запускают Apache или Nginx, которые блокируют порты `80` и `443`.

Выполните на **M0** и **S2**:
```bash
sudo systemctl stop nginx apache2 httpd 2>/dev/null || true
sudo systemctl disable nginx apache2 httpd 2>/dev/null || true
```

---

## Шаг 1: Установка AmneziaWG и настройка Каскада

### 1.1. Настройка Каскадной связки (M0 $\to$ S1):
1. **На сервере S1 (EU Egress)**:
   Установите AmneziaWG скриптом:
   ```bash
   bash <(curl -sSL https://raw.githubusercontent.com/bivlked/amneziawg-installer/main/amneziawg-install.sh)
   ```
2. **На сервере M0 (РФ Ingress)** и **S1 (EU Egress)**:
   Настройте каскадный туннель по официальному гайду:
   👉 [Официальная инструкция CASCADE.md](https://github.com/bivlked/amneziawg-installer/blob/main/CASCADE.md)
3. Проверьте, что на **M0** существует и исполняется скрипт управления:
   ```bash
   ls -la /root/awg/manage_amneziawg.sh
   ```

### 1.2. Настройка прямого узла S2 (EU Direct):
На сервере **S2**:
```bash
bash <(curl -sSL https://raw.githubusercontent.com/bivlked/amneziawg-installer/main/amneziawg-install.sh)
# Убедитесь, что скрипт управления создан
ls -la /root/awg/manage_amneziawg.sh
```

---

## Шаг 2: Установка веб-сервера Caddy

Caddy автоматически выпускает и продлевает бесплатные HTTPS-сертификаты Let's Encrypt без необходимости настройки cron и certbot.

Выполните установку на **M0** и **S2**:
```bash
# Ubuntu / Debian
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

---

## Шаг 3: Развертывание Master-сервера M0 (РФ)

На сервере M0 работают:
- Web UI (React SPA)
- Master Backend API (порт `8080`)
- Локальный Cascade Slave API (порт `8081`)
- Caddy (порты `80` и `443`)

### 3.1. Копирование файлов на M0 (выполняйте на вашем компьютере):
*(Если ваш VPS на базе x86_64, используйте `dist/linux-amd64/`, если ARM — `dist/linux-arm64/`)*

```bash
# Создание рабочих директорий на M0
ssh root@<M0_IP> "mkdir -p /var/www/avari-keys/frontend /opt/avari-keys/data /usr/local/bin"

# Копирование бинарников
scp dist/linux-amd64/avari-master root@<M0_IP>:/usr/local/bin/avari-master
scp dist/linux-amd64/avari-slave root@<M0_IP>:/usr/local/bin/avari-slave
ssh root@<M0_IP> "chmod +x /usr/local/bin/avari-master /usr/local/bin/avari-slave"

# Копирование Frontend SPA
scp -r dist/frontend/* root@<M0_IP>:/var/www/avari-keys/frontend/

# Копирование шаблонов systemd-сервисов
scp deploy/systemd/avari-master.service root@<M0_IP>:/etc/systemd/system/
scp deploy/systemd/avari-slave.service root@<M0_IP>:/etc/systemd/system/
```

### 3.2. Настройка переменных окружения на M0:

Отредактируйте файл `/etc/systemd/system/avari-master.service` на M0 (`nano /etc/systemd/system/avari-master.service`):
```ini
[Unit]
Description=Avari Keys Master Backend Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/avari-keys
Environment="MASTER_PORT=8080"
Environment="DB_PATH=/opt/avari-keys/data/avari-master.db"
Environment="ADMIN_USER=Forve"
Environment="ADMIN_PASSWORD=<ADMIN_PASSWORD>"
Environment="JWT_SECRET=<JWT_SECRET>"
ExecStart=/usr/local/bin/avari-master
Restart=always
RestartSec=5s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Отредактируйте файл `/etc/systemd/system/avari-slave.service` на M0 (`nano /etc/systemd/system/avari-slave.service`):
```ini
[Unit]
Description=Avari Keys Cascade Slave API Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/avari-keys
Environment="SLAVE_PORT=8081"
Environment="SLAVE_API_KEY=<SLAVE_KEY_M0>"
Environment="AWG_SCRIPT_PATH=/root/awg/manage_amneziawg.sh"
Environment="AWG_CONFIGS_DIR=/root/awg"
ExecStart=/usr/local/bin/avari-slave
Restart=always
RestartSec=5s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

### 3.3. Настройка Caddyfile на M0:
Создайте файл `/etc/caddy/Caddyfile` на M0 (`nano /etc/caddy/Caddyfile`):

```caddy
# Домен панели управления и API
<M0_DOMAIN> {
    # Проксирование API-запросов к Master Backend
    handle /api/* {
        reverse_proxy localhost:8080
    }

    # Раздача статики React SPA
    handle {
        root * /var/www/avari-keys/frontend
        try_files {path} /index.html
        file_server
    }

    encode gzip zstd
}

# Домен для Cascade Slave API (M0)
<S1_DOMAIN> {
    reverse_proxy localhost:8081
    encode gzip zstd
}
```

### 3.4. Запуск и активация сервисов на M0:
```bash
ssh root@<M0_IP>
systemctl daemon-reload
systemctl enable --now avari-master avari-slave caddy
```

### 3.5. Проверка статуса и паролей:
```bash
# Проверить статус сервисов
systemctl status avari-master avari-slave caddy --no-pager

# Посмотреть пароль администратора Forve (если не задавали ADMIN_PASSWORD явно)
journalctl -u avari-master -n 30 --no-pager

# Посмотреть API Key для Slave (если не задавали SLAVE_API_KEY явно)
journalctl -u avari-slave -n 30 --no-pager
```

---

## Шаг 4: Развертывание Standalone Slave-сервера S2 (Зарубеж)

На сервере S2 работают:
- Direct Slave API (порт `8081`)
- Caddy (порты `80` и `443` — HTTPS прокси и Decoy-заглушка)

### 4.1. Копирование файлов на S2 (с локального компьютера):
```bash
# Создание директорий на S2
ssh root@<S2_IP> "mkdir -p /opt/avari-keys /usr/local/bin"

# Копирование бинарника Slave API
scp dist/linux-amd64/avari-slave root@<S2_IP>:/usr/local/bin/avari-slave
ssh root@<S2_IP> "chmod +x /usr/local/bin/avari-slave"

# Копирование шаблона сервиса
scp deploy/systemd/avari-slave.service root@<S2_IP>:/etc/systemd/system/
```

### 4.2. Настройка сервиса на S2:
Отредактируйте `/etc/systemd/system/avari-slave.service` на S2 (`nano /etc/systemd/system/avari-slave.service`):
```ini
[Unit]
Description=Avari Keys Direct Slave API Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/avari-keys
Environment="SLAVE_PORT=8081"
Environment="SLAVE_API_KEY=<SLAVE_KEY_S2>"
Environment="AWG_SCRIPT_PATH=/root/awg/manage_amneziawg.sh"
Environment="AWG_CONFIGS_DIR=/root/awg"
ExecStart=/usr/local/bin/avari-slave
Restart=always
RestartSec=5s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

### 4.3. Настройка Caddyfile на S2:
Создайте `/etc/caddy/Caddyfile` на S2 (`nano /etc/caddy/Caddyfile`):

```caddy
<S2_DOMAIN> {
    reverse_proxy localhost:8081
    encode gzip zstd
}
```

### 4.4. Запуск сервисов на S2:
```bash
ssh root@<S2_IP>
systemctl daemon-reload
systemctl enable --now avari-slave caddy
```

---

## Шаг 5: Первичная настройка через Web UI

1. Откройте в браузере `https://<M0_DOMAIN>`.
2. Авторизуйтесь:
   - **Логин**: `Forve`
   - **Пароль**: ваш `<ADMIN_PASSWORD>` (или сгенерированный из `journalctl -u avari-master`).
3. Перейдите в раздел **«Управление серверами»** и нажмите **«Добавить ноду»**:

   **Нода 1 (Каскад M0 -> S1)**:
   - **Название**: `Каскад Россия ➔ Нидерланды`
   - **Тип**: `Каскадный (Cascade)`
   - **URL API**: `http://127.0.0.1:8081` *(или `https://<S1_DOMAIN>`)*
   - **API Token**: `<SLAVE_KEY_M0>`

   **Нода 2 (Прямой S2)**:
   - **Название**: `Прямой EU (Германия)`
   - **Тип**: `Прямой (Direct)`
   - **URL API**: `https://<S2_DOMAIN>`
   - **API Token**: `<SLAVE_KEY_S2>`

4. Проверьте статус нод: нажмите **«Проверить доступность (Health)»**. Индикаторы должны загореться зеленым цветом (`Online`).
5. **Тест создания ключа**:
   - Перейдите в раздел **«Мои ключи»** $\to$ **«Создать ключ»**.
   - Выберите каскадную или прямую ноду, укажите имя устройства (например, `iPhone`).
   - Убедитесь, что QR-код и файл `.conf` сгенерировались корректно.

---

## Полезные команды обслуживания и Траблшутинг

### Просмотр логов в реальном времени:
```bash
# Логи Master API
journalctl -u avari-master -f

# Логи Slave API
journalctl -u avari-slave -f

# Логи веб-сервера Caddy
journalctl -u caddy -f
```

### Перезапуск компонентов:
```bash
systemctl restart avari-master
systemctl restart avari-slave
systemctl reload caddy
```

### Резервное копирование базы данных Master:
Все пользователи, ноды, логи и привязки ключей хранятся в одном файле SQLite:
```bash
# Создание бэкапа
cp /opt/avari-keys/data/avari-master.db /opt/avari-keys/data/avari-master_backup_$(date +%F).db
```

### Что делать, если Slave нода показывает `Offline`?
1. Проверьте доступность эндпоинта health через curl:
   ```bash
   curl -i https://<S2_DOMAIN>/health
   ```
   *Ожидаемый ответ: `{"status":"ok","script_found":true}`*.
2. Убедитесь, что скрипт `/root/awg/manage_amneziawg.sh` существует и имеет права на исполнение (`chmod +x`).
3. Проверьте, что в настройках ноды в Web UI указан верный API-ключ (`X-API-Key`).
