#!/usr/bin/env bash
# Run on S0 as root after copying avari-egress.py beside this script.
set -euo pipefail
[[ $EUID == 0 ]]
BASE="$(cd "$(dirname "$0")" && pwd)"
BACKUP="/root/network-backups/egress-manager-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP" /usr/local/libexec /etc/avari-keys
chmod 700 "$BACKUP"
cp -a /root/awg/awg-routing.sh /etc/systemd/system/awg-routing.service "$BACKUP/"
for path in /etc/avari-keys/egress.json /root/awg/egress-selected.env /usr/local/libexec/avari-egress; do
  [[ ! -e "$path" ]] || cp -a "$path" "$BACKUP/"
done
install -m 700 "$BASE/avari-egress.py" /usr/local/libexec/avari-egress
python3 - <<'PY'
import json, pathlib, re, subprocess
registry = pathlib.Path('/etc/avari-keys/egress.json')
if not registry.exists():
    raise SystemExit('Install root-owned /etc/avari-keys/egress.json from deployment secrets first')
entries = json.loads(registry.read_text())
if not entries:
    raise SystemExit('Egress registry must not be empty')
path = pathlib.Path('/root/awg/awg-routing.sh')
s = path.read_text()
needle = '    EP_ROUTE='
if 'egress-selected.env' not in s:
    if needle not in s:
        raise SystemExit('Unexpected routing script: refusing to patch')
    s = s.replace(needle, '''    # Selection is read only while holding the shared routing lock.
    if [[ -f /root/awg/egress-selected.env ]]; then
        source /root/awg/egress-selected.env
    fi
    systemctl start "awg-quick@${AWG1_IF}.service"
    EP_ROUTE=''', 1)
    path.write_text(s)
unit = pathlib.Path('/etc/systemd/system/awg-routing.service')
s = unit.read_text()
s = re.sub(r'^Requires=.*$', 'Requires=awg-quick@awg0.service', s, flags=re.M)
if 'avari-egress recover' not in s:
    s = s.replace('[Service]', '[Service]\nExecStartPre=/usr/local/libexec/avari-egress recover', 1)
unit.write_text(s)
PY
bash -n /root/awg/awg-routing.sh
systemctl daemon-reload
# No route changes or service restarts at installation time.
/usr/local/libexec/avari-egress status
printf 'Backup: %s\n' "$BACKUP"
