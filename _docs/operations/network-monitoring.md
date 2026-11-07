# Server and public network monitoring

The admin node response retains `online` and `latency_ms` for compatibility. `latency_ms` measures the Slave API response, not ICMP. New fields:

- `server_status`: `state`, `checked_at`, `reason`; API unavailable is red, API responds but a configured VPN service is unavailable is yellow.
- `network_status`: aggregate assessment from the configured probe sources.
- `network_probes`: timestamped source samples containing DNS, public IP ICMP/TCP, and domain ICMP/TCP checks. Individual checks include target, success, latency and failure reason.

Configure the following environment variable on Master and the cascade gateway Slave using private deployment configuration:

```json
NETWORK_PROBE_TARGETS=[{"node_id":1,"ip":"192.0.2.10","domain":"vpn.example.test","port":443}]
```

The sample values are documentation placeholders. Each node ID must match the Master database. `ip` must be a public unicast IP, `domain` must be the public node domain, and `port` a TCP service expected to be reachable publicly (for example the HTTPS API front end). This tests TCP connectivity, not a Hysteria UDP or AWG handshake.

Master runs probes from M0 in the background telemetry loop. Gateway Slave samples from S0 every 60 seconds and exposes cached results at authenticated `GET /api/v1/network/probes`. It accepts no request-supplied targets. Master retrieves that cache through the active cascade node API credentials. Without target configuration the UI shows no network data.

Green requires all checks to pass at both configured sources. Partial reachability, mismatched DNS, source failure, or any sample older than three minutes is yellow. Red requires all available sources to fail public ICMP/TCP checks. API service health is independent of this outcome. Neither a failed ICMP check nor these two network vantage points prove an ISP-wide block.

The UI shows the source and timestamp with diagnostics. Public network checks never execute as part of loading the node list. Before the first background server sample, `server_status` is unknown. Existing `online` behavior is retained for old clients.
