#!/usr/bin/env python3
"""Root-owned, allowlisted cascade route transaction helper. No private keys are read."""
import concurrent.futures
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

CONFIG = Path('/etc/avari-keys/egress.json')
STATE = Path('/root/awg/egress-selected.env')
PENDING = Path('/root/awg/egress-pending.json')
SUBNET_FILE = Path('/etc/avari-keys/egress-client-subnet')
NETWORKS = ['91.108.4.0/22', '91.108.8.0/22', '91.108.12.0/22', '91.108.16.0/22', '91.108.56.0/22', '149.154.160.0/20']


def run(*args, timeout=20):
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr.strip()[:300]}')
    return result.stdout.strip()


def atomic(path, content):
    tmp = path.with_suffix(path.suffix + '.new')
    tmp.write_text(content)
    tmp.chmod(0o600)
    with tmp.open('rb') as stream:
        os.fsync(stream.fileno())
    tmp.replace(path)
    fd = os.open(str(path.parent), os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def registry():
    entries = json.loads(CONFIG.read_text())
    seen = set()
    for item in entries:
        iface = item['interface']
        if not re.fullmatch(r'awg[1-9][0-9]*', iface) or iface in seen:
            raise ValueError('Invalid or duplicate configured egress interface')
        seen.add(iface)
        ipaddress.IPv4Address(item['endpoint'])
    return entries


def active():
    defaults = [line.split() for line in run('ip', '-4', 'route', 'show', 'table', '100').splitlines() if line.startswith('default ')]
    if len(defaults) != 1 or 'dev' not in defaults[0]:
        return ''
    row = defaults[0]
    return row[row.index('dev') + 1]


def probe(item):
    iface = item['interface']
    if not Path('/sys/class/net', iface).exists():
        raise RuntimeError('Туннель не запущен')
    # A successful tunnel HTTPS request is stronger evidence than an idle handshake.
    address = run('curl', '-4', '--fail', '--silent', '--show-error', '--noproxy', '*', '--connect-timeout', '3', '--max-time', '7', '--interface', iface, 'https://api.ipify.org', timeout=9)
    if address != item['endpoint']:
        raise RuntimeError('Внешний IP туннеля не совпадает с ожидаемым')


def rollback(snapshot):
    for prefix, routes in snapshot['routes'].items():
        args = ['ip', '-4', 'route']
        if prefix == 'default':
            suffix = ['table', '100']
        else:
            suffix = []
        subprocess.run(args + ['del', prefix] + suffix, capture_output=True)
        for route in routes:
            run(*(args + ['replace'] + route.split() + suffix))
    if snapshot['selection'] is None:
        STATE.unlink(missing_ok=True)
    else:
        atomic(STATE, snapshot['selection'])
    if snapshot.get('nat_added'):
        subprocess.run(['iptables', '-t', 'nat', '-D', 'POSTROUTING', '-s', snapshot['subnet'], '-o', snapshot['target'], '-j', 'MASQUERADE'], capture_output=True)
    PENDING.unlink(missing_ok=True)


def main():
    with open('/root/awg/awg-routing.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Другая операция переключения уже выполняется')
        if PENDING.exists():
            rollback(json.loads(PENDING.read_text()))
        if len(sys.argv) == 2 and sys.argv[1] == 'recover':
            return
        entries = registry()
        if sys.argv[1:] == ['status']:
            def check(item):
                target = dict(item, available=False, reason='')
                try:
                    probe(item)
                    target['available'] = True
                except Exception as exc:
                    target['reason'] = str(exc)
                return target
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                targets = list(pool.map(check, entries))
            current = active()
            print(json.dumps({'active_interface': current, 'available_interfaces': [x['interface'] for x in entries], 'targets': targets, 'details': 'Фактический default таблицы 100' if current else 'Активный маршрут не определён'}))
            return
        if len(sys.argv) != 3 or sys.argv[1] != 'switch':
            raise ValueError('Usage: avari-egress status | switch INTERFACE | recover')
        item = next((x for x in entries if x['interface'] == sys.argv[2]), None)
        if item is None:
            raise ValueError('Выход отсутствует в конфигурации')
        current = active()
        if not current:
            raise RuntimeError('Текущий маршрут неизвестен; переключение отменено')
        probe(item)
        if current == item['interface']:
            return
        routes = {'default': run('ip', '-4', 'route', 'show', 'table', '100', 'default').splitlines()}
        for prefix in NETWORKS:
            routes[prefix] = run('ip', '-4', 'route', 'show', 'exact', prefix).splitlines()
        subnet = str(ipaddress.IPv4Network(SUBNET_FILE.read_text().strip()))
        nat_args = ['iptables', '-t', 'nat', '-C', 'POSTROUTING', '-s', subnet, '-o', item['interface'], '-j', 'MASQUERADE']
        nat_exists = subprocess.run(nat_args, capture_output=True).returncode == 0
        snapshot = {'subnet': subnet, 'routes': routes, 'selection': STATE.read_text() if STATE.exists() else None, 'target': item['interface'], 'nat_added': not nat_exists}
        atomic(PENDING, json.dumps(snapshot))
        # Independent rollback survives API process termination and request cancellation.
        timer = 'avari-egress-rollback-' + str(time.time_ns())
        try:
            run('systemd-run', '--quiet', '--unit=' + timer, '--on-active=60s', '--property=Restart=on-failure', '--property=RestartSec=5s', '/usr/local/libexec/avari-egress', 'recover')
            if not nat_exists:
                nat_args[3] = '-A'
                run(*nat_args)
            run('ip', '-4', 'route', 'replace', 'default', 'dev', item['interface'], 'table', '100')
            for prefix in NETWORKS:
                run('ip', '-4', 'route', 'replace', prefix, 'dev', item['interface'])
            probe(item)
            if active() != item['interface']:
                raise RuntimeError('Маршрут не применён')
            atomic(STATE, f'AWG1_IF="{item["interface"]}"\nAWG1_ENDPOINT="{item["endpoint"]}"\n')
            PENDING.unlink()
        except BaseException:
            rollback(snapshot)
            raise
        finally:
            subprocess.run(['systemctl', 'stop', timer + '.timer'], capture_output=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
