"""Initialize the dedicated Xray configuration once, before starting the unit."""
import argparse
import base64
import json
import os
import secrets
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--sni", required=True)
parser.add_argument("--target", required=True)
args = parser.parse_args()
if not 1 <= args.port <= 65535:
    parser.error("invalid TCP port")
private_key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
config = {
    "inbounds": [{
        "port": args.port, "protocol": "vless",
        "settings": {"decryption": "none", "clients": []},
        "streamSettings": {
            "network": "tcp", "security": "reality",
            "realitySettings": {
                "dest": args.target, "serverNames": [args.sni],
                "privateKey": private_key, "shortIds": [secrets.token_hex(8)]
            }
        }
    }],
    "outbounds": [{"protocol": "freedom"}]
}
os.umask(0o077)
directory = Path("/etc/avari-vless")
directory.mkdir(mode=0o700, exist_ok=True)
with (directory / "config.json").open("x") as output:
    json.dump(config, output, indent=2)
