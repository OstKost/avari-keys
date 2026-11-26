# Private runtime configuration

Infrastructure addresses must not be committed, including screenshots and generated configuration. Examples use RFC 5737 and example.net/test only. Git history predates this policy and was intentionally not rewritten.

GitHub repository secrets: SSH_HOST, SLAVE_HOSTS, SSH_PRIVATE_KEY, NETWORK_PROBE_TARGETS (JSON), CASCADE_EGRESS_CONFIG (JSON), TELEGRAM_PROXY_SERVER, TELEGRAM_PROXY_SECRET, TELEGRAM_PROXY_PORT. SSH_USER and SSH_PORT are optional.

Master runtime uses NETWORK_PROBE_TARGETS and TELEGRAM_PROXY_* from systemd environment. The workflow supplies them through SSH stdin, never builds them into the frontend. S0 receives the same probe inventory and /etc/avari-keys/egress.json from deployment secrets; /etc/avari-keys/egress-client-subnet stores its private cascade subnet. These files are root-owned, mode 600. Run scripts/install_egress.sh on S0 after provisioning tunnels; it does not switch the active route.

Each slave requires NODE_DOMAIN or HYSTERIA_SERVER when Hysteria is enabled, with HYSTERIA_PORT as configured. Missing domains never fall back to another production node. Telegram proxies return an empty list until configured.

Before a release, scan tracked text and images against the private inventory. Do not upload production screenshots or runtime databases as GitHub artifacts. Endpoint values necessarily remain visible to authorized VPN clients and administrators.

SSH_JUMP_HOST optionally routes Slave deployments through an operator-configured reachable gateway using ProxyJump. The deployment key is authorized on the gateway and each target. A failed connection or inactive service fails the deployment; targets are never silently skipped.

Master accepts optional `SLAVE_ROUTES_JSON`, keyed by each node's existing API URL. Each entry can specify `interface` for the primary, `backup_url` for a separate HTTPS address of the same Slave, and `backup_interface` to bind that path to a different interface. Keep the actual map in the private Master environment. Interface binding is Linux-only and fails closed. All primary Slave API requests use the configured interface. Health checks try the backup on a network failure or timeout, within the caller's deadline, using the same API key and standard TLS verification. Mutations continue to use the primary and are never replayed to the backup.

Before rollout, verify the direct route for each affected node and provision the S1 backup with a certificate trusted by Master. Confirm the backup can reach the same Slave with the primary path unavailable and that the API key is accepted. Remove or restore the environment setting and restart Master to roll back routing configuration.
