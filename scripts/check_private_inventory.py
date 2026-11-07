#!/usr/bin/env python3
"""Reject deployment addresses in tracked content without printing secret values."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
values = set()
for key in ('SSH_HOST', 'SLAVE_HOSTS', 'CASCADE_GATEWAY_HOST', 'TELEGRAM_PROXY_SERVER'):
    values.update(os.environ.get(key, '').split())
for key, fields in [('NETWORK_PROBE_TARGETS', ('ip', 'domain')), ('CASCADE_EGRESS_CONFIG', ('endpoint',))]:
    raw = os.environ.get(key, '')
    if raw:
        for row in json.loads(raw):
            values.update(str(row[f]) for f in fields if row.get(f))
if not values:
    print('No private inventory supplied; content scan skipped.')
    sys.exit(0)
files = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).decode().split('\0')
failed = []
for name in filter(None, files):
    path = root / name
    if not path.is_file():
        continue
    content = path.read_bytes()
    if any(v.encode() in content or v in name for v in values):
        failed.append(name)
if failed:
    print('Private deployment address found in tracked paths:')
    print('\n'.join(failed))
    sys.exit(1)
print('Private inventory scan passed.')
