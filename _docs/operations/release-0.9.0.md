# v0.9.0

Independent server and public-network traffic lights, cached checks from Master and cascade gateway, IP/domain DNS+ICMP+TCP diagnostics, and non-wrapping latency labels. Node protocol tags appear below the node name.

Cascade selection uses a configured target list with confirmation and unavailable reasons. Switching validates public egress, serializes routing changes, updates NAT and special routes, persists the selected target, and recovers failed/incomplete transactions.

New direct/cascade node onboarding preserves the existing management panel and clients. Hysteria server addresses and Telegram proxies require runtime environment settings. Deployment host defaults were removed; private inventory is held in GitHub Secrets and root-owned runtime configuration. Documentation, examples, and demo screenshots contain no production infrastructure addresses. Historical Git commits were intentionally retained.

Telegram lifecycle shutdown no longer waits under the polling configuration lock.

Validation: Go vet; full race test suite; static Linux Master/Slave builds; frontend TypeScript/Vite build; Python route-helper tests; workflow YAML/shell syntax. Live namespace test verified both configured working exits and direct domestic routing; final selected exit remains S3. Full host reboot and OS upgrade were not performed.
