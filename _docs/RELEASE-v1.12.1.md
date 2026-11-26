# v1.12.1

- Master supports per-node Linux interface binding for Slave API traffic. This allows direct nodes to be checked independently of the shared tunnel.
- Health checks can use a separately configured HTTPS endpoint for the same Slave after a transport failure. TLS verification and API authentication remain enabled.
- Master processes completed node results without waiting for public network probes. Telegram transport errors redact the bot token.

See [private configuration](operations/private-configuration.md) for rollout and rollback. A backup endpoint must be provisioned and verified before enabling it.
