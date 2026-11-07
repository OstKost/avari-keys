# TASK-058 — S5P premium ingress and current dashboard

Completed 2026-11-07. Added a PRO-only direct node and a separate premium cascade ingress; existing 3x-ui preserved. Deployment addresses/tokens remain in private runtime inventory. Full operational report is in the infrastructure workspace, reports/s5p-onboarding-2026-11-07.md.

The premium Slave has AWG_SCRIPT_PATH/AWG_CONFIGS_DIR/AWG_INTERFACE pointing at its dedicated manager/config/interface. Restart uses that manager; telemetry uses only the configured interface. CASCADE_EGRESS_ENABLED=false disables switches while allowing read-only status; AWG_EGRESS_HELPER supplies a separate status helper reading /etc/avari-keys/premium-egress.json (interface, table, endpoint, node, label). No premium endpoint is registered in the shared egress selector.

Monitoring obtains the current egress label from each cascade Slave and exposes active_egress. Dashboard displays the current node list, PRO indicators and actual egress, replacing obsolete fixed topology labels. Unknown egress is explicitly unconfirmed.

Validation: go vet ./..., go test -race ./..., static Linux builds, npm run build. Added regression tests for dedicated telemetry, configured restart manager, and egress refresh. Live AWG premium cascade and Hysteria HTTPS probes succeeded; non-PRO issuance returned 403 for both node registrations and both protocols. Existing x-ui PID, inbound and client counts unchanged.
