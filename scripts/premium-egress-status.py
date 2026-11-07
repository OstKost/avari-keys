#!/usr/bin/env python3
"""Read-only status for the dedicated S0 premium route (never changes table 100)."""
import json
from pathlib import Path
import subprocess
import sys

if sys.argv[1:] != ['status']:
    raise SystemExit('Only status is supported')
cfg = json.loads(Path('/etc/avari-keys/premium-egress.json').read_text())
iface, table, endpoint = cfg['interface'], str(int(cfg['table'])), cfg['endpoint']
route = subprocess.check_output(['ip', '-j', '-4', 'route', 'show', 'table', table, 'default'], text=True)
rows = json.loads(route)
active = rows[0].get('dev', '') if len(rows) == 1 else ''
try:
    result = subprocess.run(['curl', '-4', '--fail', '--silent', '--show-error', '--noproxy', '*', '--connect-timeout', '3', '--max-time', '7', '--interface', iface, 'https://api.ipify.org'], capture_output=True, text=True, timeout=9)
    available = result.returncode == 0 and result.stdout.strip() == endpoint
except subprocess.TimeoutExpired:
    available = False
print(json.dumps(dict(active_interface=active, available_interfaces=[iface], targets=[dict(interface=iface, node=cfg['node'], label=cfg['label'], endpoint=endpoint, available=available)], details='Фактический default премиум-таблицы 105; общий каскад использует таблицу 100')))
