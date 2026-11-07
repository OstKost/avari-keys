# Private runtime configuration

Infrastructure addresses must not be committed, including screenshots and generated configuration. Examples use RFC 5737 and example.net/test only. Git history predates this policy and was intentionally not rewritten.

GitHub repository secrets: SSH_HOST, SLAVE_HOSTS, SSH_PRIVATE_KEY, NETWORK_PROBE_TARGETS (JSON), CASCADE_EGRESS_CONFIG (JSON), TELEGRAM_PROXY_SERVER, TELEGRAM_PROXY_SECRET, TELEGRAM_PROXY_PORT. SSH_USER and SSH_PORT are optional.

Master runtime uses NETWORK_PROBE_TARGETS and TELEGRAM_PROXY_* from systemd environment. The workflow supplies them through SSH stdin, never builds them into the frontend. S0 receives the same probe inventory and /etc/avari-keys/egress.json from deployment secrets; /etc/avari-keys/egress-client-subnet stores its private cascade subnet. These files are root-owned, mode 600. Run scripts/install_egress.sh on S0 after provisioning tunnels; it does not switch the active route.

Each slave requires NODE_DOMAIN or HYSTERIA_SERVER when Hysteria is enabled, with HYSTERIA_PORT as configured. Missing domains never fall back to another production node. Telegram proxies return an empty list until configured.

Before a release, scan tracked text and images against the private inventory. Do not upload production screenshots or runtime databases as GitHub artifacts. Endpoint values necessarily remain visible to authorized VPN clients and administrators.
