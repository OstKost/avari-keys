# VLESS+Reality на прямой ноде

Установите Xray-core v26.11.9 для архитектуры ноды в `/usr/local/bin/xray`. Сверьте SHA-256 архива с digest соответствующего артефакта релиза XTLS/Xray-core. Для службы нужен systemd с поддержкой LoadCredential. Выберите свободный TCP-порт и откройте его в firewall. Укажите доступный с ноды TLS target и подходящее ему SNI.

От root в каталоге репозитория выполните команды, заменив значения примера.

```sh
python3 scripts/init_vless.py --port 8443 --sni tls.example.org --target tls.example.org:443
/usr/local/bin/xray run -test -c /etc/avari-vless/config.json
install -m644 deploy/systemd/avari-vless.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now avari-vless.service
systemctl edit avari-slave.service
```

В drop-in добавьте следующие параметры и укажите публичное имя прямой ноды.

```ini
[Service]
Environment=VLESS_ENABLED=1
Environment=VLESS_SERVER=direct.example.org
```

Перезапустите обновлённый Slave. Убедитесь, что его `/health` сообщает `vless_available: true`, затем включите VLESS+Reality для этой ноды в админке обновлённого Master. Создание или отзыв ключа кратко перезапускает выделенный Xray.

Сохраняйте защищённую резервную копию `/etc/avari-vless/config.json` вместе с согласованной копией метаданных Master. Конфиг содержит приватный ключ и UUID всех клиентов. Для восстановления остановите Slave и Xray, восстановите конфиг с правами root:root 0600, проверьте через `xray run -test` и запустите обе службы. Для вывода из эксплуатации отключите выпуск в админке, отзовите ключи и только после этого отключите службу.
