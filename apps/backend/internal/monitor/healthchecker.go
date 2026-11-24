package monitor

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/client"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/netprobe"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/storage"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/telegram"
)

type rawCounters struct {
	rx int64
	tx int64
}

// HealthChecker periodically verifies node availability, collects telemetry deltas, and updates in-memory metrics.
type HealthChecker struct {
	storage          *storage.Storage
	bot              *telegram.Bot
	interval         time.Duration
	nodeTimeout      time.Duration
	failureThreshold int
	fastRetryDelay   time.Duration
	logActivity      func(category models.AuditLogCategory, action string, details string)

	serverStatuses  map[int64]models.StatusDetail
	networkProbes   map[int64][]models.NetworkProbe
	nodeStates      map[int64]bool         // nodeID -> isOnline
	nodeLatencies   map[int64]int64        // nodeID -> latencyMs
	nodeFailures    map[int64]int          // nodeID -> consecutive failure count
	prevPeerRaw     map[string]rawCounters // "nodeID:pubkey/name" -> raw counters
	prevNodeRaw     map[int64]rawCounters  // nodeID -> raw counters
	cachedDashboard *models.DashboardStatsResponse

	failoverFailures map[int64]int        // nodeID -> consecutive egress failure count
	failoverCooldown map[int64]time.Time  // nodeID -> cooldown expiration
	frozenAlerts     map[string]time.Time // "nodeID:iface" -> last frozen alert time

	mu       sync.RWMutex
	stopChan chan struct{}
	wg       sync.WaitGroup
}

// Config for HealthChecker.
type Config struct {
	Storage          *storage.Storage
	Bot              *telegram.Bot
	Interval         time.Duration
	Timeout          time.Duration
	FailureThreshold int
	FastRetryDelay   time.Duration
	LogActivity      func(category models.AuditLogCategory, action string, details string)
}

// NewHealthChecker creates a new background node monitor and telemetry collector.
func NewHealthChecker(cfg Config) *HealthChecker {
	interval := cfg.Interval
	if interval <= 0 {
		interval = 180 * time.Second
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	failThreshold := cfg.FailureThreshold
	if failThreshold <= 0 {
		failThreshold = 2
	}
	fastRetry := cfg.FastRetryDelay
	if fastRetry <= 0 {
		fastRetry = 15 * time.Second
	}

	return &HealthChecker{
		storage:          cfg.Storage,
		bot:              cfg.Bot,
		interval:         interval,
		nodeTimeout:      timeout,
		failureThreshold: failThreshold,
		fastRetryDelay:   fastRetry,
		logActivity:      cfg.LogActivity,
		nodeStates:       make(map[int64]bool),
		serverStatuses:   make(map[int64]models.StatusDetail),
		networkProbes:    make(map[int64][]models.NetworkProbe),
		nodeLatencies:    make(map[int64]int64),
		nodeFailures:     make(map[int64]int),
		prevPeerRaw:      make(map[string]rawCounters),
		prevNodeRaw:      make(map[int64]rawCounters),
		failoverFailures: make(map[int64]int),
		failoverCooldown: make(map[int64]time.Time),
		frozenAlerts:     make(map[string]time.Time),
		stopChan:         make(chan struct{}),
	}
}

// Start runs the background monitoring loop.
func (h *HealthChecker) Start(ctx context.Context) {
	h.wg.Add(1)
	go h.run(ctx)
	log.Printf("[MONITOR] HealthChecker & Telemetry Collector started (interval: %v, timeout: %v)", h.interval, h.nodeTimeout)
}

// Stop stops the HealthChecker.
func (h *HealthChecker) Stop() {
	close(h.stopChan)
	h.wg.Wait()
	log.Println("[MONITOR] HealthChecker stopped")
}

func (h *HealthChecker) run(ctx context.Context) {
	defer h.wg.Done()

	// Initial check on startup after short delay
	select {
	case <-time.After(1 * time.Second):
		h.collectTelemetryAndHealth(ctx, true)
	case <-h.stopChan:
		return
	case <-ctx.Done():
		return
	}

	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()

	// Periodic billing reminder check (every 12 hours)
	billingTicker := time.NewTicker(12 * time.Hour)
	defer billingTicker.Stop()

	for {
		select {
		case <-h.stopChan:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.collectTelemetryAndHealth(ctx, false)
		case <-billingTicker.C:
			if h.bot != nil {
				_ = h.bot.BroadcastBillingReminders(ctx)
			}
		}
	}
}

// CollectTelemetry manually triggers an immediate telemetry collection cycle.
func (h *HealthChecker) CollectTelemetry(ctx context.Context) {
	h.collectTelemetryAndHealth(ctx, false)
}

func (h *HealthChecker) collectTelemetryAndHealth(ctx context.Context, isInitial bool) {
	if h.storage == nil {
		return
	}

	nodes, err := h.storage.ListNodes(ctx)
	if err != nil {
		log.Printf("[MONITOR] Failed to list nodes: %v", err)
		return
	}

	allConfigs, err := h.storage.ListAllClientConfigs(ctx)
	if err != nil {
		allConfigs = []models.ClientConfig{}
	}

	// Index configs by "nodeID:pubkey" and "nodeID:clientName"
	configByPubKey := make(map[string]models.ClientConfig)
	configByName := make(map[string]models.ClientConfig)
	for _, cfg := range allConfigs {
		if cfg.Protocol == "vless" {
			continue
		}
		if cfg.PublicKey != "" {
			configByPubKey[fmt.Sprintf("%d:%s", cfg.NodeID, cfg.PublicKey)] = cfg
		}
		if cfg.ClientName != "" {
			configByName[fmt.Sprintf("%d:%s", cfg.NodeID, cfg.ClientName)] = cfg
		}
	}

	var wg sync.WaitGroup
	type nodeResult struct {
		activeEgress string
		node         models.Node
		online       bool
		latencyMs    int64
		health       *models.HealthResponse
		stats        *models.StatsSummaryResponse
		err          error
	}

	resultsChan := make(chan nodeResult, len(nodes))

	for _, node := range nodes {
		if !node.IsActive {
			continue
		}

		wg.Add(1)
		go func(n models.Node) {
			defer wg.Done()

			slaveCli := client.NewSlaveClient(n.APIURL, n.APIKey)

			// Attempt #1
			pingCtx1, cancel1 := context.WithTimeout(ctx, h.nodeTimeout)
			start := time.Now()
			health, hErr := slaveCli.CheckHealth(pingCtx1)
			latency := time.Since(start).Milliseconds()
			cancel1()

			isOnline := hErr == nil && health != nil && health.Status == "ok"

			// Immediate retry (Attempt #2) if Attempt #1 failed due to network jitter / transient timeout
			if !isOnline && ctx.Err() == nil {
				time.Sleep(500 * time.Millisecond)
				pingCtx2, cancel2 := context.WithTimeout(ctx, h.nodeTimeout)
				start2 := time.Now()
				health2, hErr2 := slaveCli.CheckHealth(pingCtx2)
				latency2 := time.Since(start2).Milliseconds()
				cancel2()

				if hErr2 == nil && health2 != nil && health2.Status == "ok" {
					isOnline = true
					health = health2
					hErr = nil
					latency = latency2
				} else if hErr2 != nil {
					hErr = hErr2
				}
			}

			var statsResp *models.StatsSummaryResponse
			if isOnline {
				statsCtx, statsCancel := context.WithTimeout(ctx, h.nodeTimeout)
				statsResp, _ = slaveCli.GetStats(statsCtx)
				statsCancel()
			}

			activeEgress := ""
			if isOnline && n.Type == "cascade" {
				egressCtx, cancel := context.WithTimeout(ctx, h.nodeTimeout)
				status, err := slaveCli.GetCascadeEgress(egressCtx)
				cancel()
				if err == nil && status != nil {
					var activeTarget *models.EgressTarget
					for i := range status.Targets {
						if status.Targets[i].Interface == status.ActiveInterface {
							activeTarget = &status.Targets[i]
							activeEgress = status.Targets[i].Label
							if activeEgress == "" {
								activeEgress = status.Targets[i].Node
							}
							break
						}
					}

					// Check for frozen WireGuard egress sessions and alert admin
					for _, target := range status.Targets {
						alertKey := fmt.Sprintf("%d:%s", n.ID, target.Interface)
						if target.IsFrozen {
							h.mu.Lock()
							lastAlert, alerted := h.frozenAlerts[alertKey]
							shouldAlert := !alerted || time.Since(lastAlert) > 1*time.Hour
							if shouldAlert {
								h.frozenAlerts[alertKey] = time.Now()
							}
							h.mu.Unlock()

							if shouldAlert {
								log.Printf("[MONITOR] ❄️ Cascade egress %s (%s) on node #%d is frozen (handshake age: %ds). Alerting admin.",
									target.Interface, target.Label, n.ID, target.HandshakeAgeSec)
								if h.bot != nil {
									h.bot.NotifyCascadeEgressFrozen(n, target)
								}
							}
						} else {
							h.mu.Lock()
							delete(h.frozenAlerts, alertKey)
							h.mu.Unlock()
						}
					}

					// Auto-Failover for cascade nodes
					if n.AutoFailoverEnabled {
						if activeTarget != nil && !activeTarget.Available {
							h.mu.Lock()
							h.failoverFailures[n.ID]++
							fails := h.failoverFailures[n.ID]
							cooldownUntil, hasCooldown := h.failoverCooldown[n.ID]
							inCooldown := hasCooldown && time.Now().Before(cooldownUntil)
							h.mu.Unlock()

							log.Printf("[MONITOR] ⚠️ Cascade egress %s on node #%d (%s) is down: %s (consecutive fails: %d/2, in_cooldown: %v)",
								status.ActiveInterface, n.ID, n.Name, activeTarget.Reason, fails, inCooldown)

							// Fast Confirmation Retry:
							// When initial failure occurs (fails == 1) and not in cooldown,
							// don't wait for the next 3-minute ticker! Trigger a fast confirmation check in 15 seconds.
							if fails == 1 && !inCooldown {
								go func(nid int64) {
									select {
									case <-time.After(h.fastRetryDelay):
										h.CollectTelemetry(ctx)
									case <-h.stopChan:
									case <-ctx.Done():
									}
								}(n.ID)
							}

							if fails >= 2 && !inCooldown {
								// Find the best healthy target
								var candidate *models.EgressTarget

								// 1. Check configured FailoverPriority
								if len(n.FailoverPriority) > 0 {
									for _, prefIf := range n.FailoverPriority {
										if prefIf == status.ActiveInterface {
											continue
										}
										for i := range status.Targets {
											if status.Targets[i].Interface == prefIf && status.Targets[i].Available {
												candidate = &status.Targets[i]
												break
											}
										}
										if candidate != nil {
											break
										}
									}
								}

								// 2. Fallback to any other available target
								if candidate == nil {
									for i := range status.Targets {
										if status.Targets[i].Interface != status.ActiveInterface && status.Targets[i].Available {
											candidate = &status.Targets[i]
											break
										}
									}
								}

								if candidate != nil {
									log.Printf("[MONITOR] 🔄 Auto-Failover switching egress on node #%d (%s): %s -> %s",
										n.ID, n.Name, status.ActiveInterface, candidate.Interface)

									switchCtx, switchCancel := context.WithTimeout(ctx, 45*time.Second)
									swErr := slaveCli.SwitchCascadeEgress(switchCtx, candidate.Interface)
									switchCancel()

									if swErr != nil {
										log.Printf("[MONITOR] ❌ Auto-failover failed for node #%d: %v", n.ID, swErr)
									} else {
										h.mu.Lock()
										h.failoverFailures[n.ID] = 0
										h.failoverCooldown[n.ID] = time.Now().Add(5 * time.Minute)
										h.mu.Unlock()

										oldLabel := activeTarget.Label
										if oldLabel == "" {
											oldLabel = activeTarget.Node
										}
										newLabel := candidate.Label
										if newLabel == "" {
											newLabel = candidate.Node
										}

										activeEgress = newLabel

										log.Printf("[MONITOR] ✅ Auto-failover SUCCESS on node #%d: %s (%s) -> %s (%s)",
											n.ID, oldLabel, status.ActiveInterface, newLabel, candidate.Interface)

										if h.logActivity != nil {
											h.logActivity(models.CategoryAdmin, "admin_cascade_auto_failover",
												fmt.Sprintf("Автопереключение каскада «%s» (#%d): %s (%s) -> %s (%s). Причина сбоя: %s",
													n.Name, n.ID, oldLabel, status.ActiveInterface, newLabel, candidate.Interface, activeTarget.Reason))
										}

										if h.bot != nil {
											h.bot.NotifyCascadeFailover(n, status.ActiveInterface, candidate.Interface, oldLabel, newLabel, activeTarget.Reason)
										}
									}
								} else {
									log.Printf("[MONITOR] ⚠️ Auto-failover for node #%d: no healthy candidate available among %d targets",
										n.ID, len(status.Targets))
								}
							}
						} else if activeTarget != nil && activeTarget.Available {
							h.mu.Lock()
							h.failoverFailures[n.ID] = 0
							h.mu.Unlock()
						}
					}
				}
			}
			resultsChan <- nodeResult{
				activeEgress: activeEgress,
				node:         n,
				health:       health,
				online:       isOnline,
				latencyMs:    latency,
				stats:        statsResp,
				err:          hErr,
			}
		}(node)
	}

	wg.Wait()
	close(resultsChan)
	h.refreshPublicNetwork(ctx, nodes)

	// Process results & compute telemetry deltas
	onlineNodesCount := 0
	var totalLatencySum int64
	var latencyCount int64

	nodeDashboardList := []models.NodeDashboardInfo{}
	var totalNetworkTrafficBytes int64
	var monthNetworkTrafficBytes int64
	var cascadeTrafficBytes int64
	var directTrafficBytes int64
	activeDevicesOnline := 0

	monthStr := time.Now().UTC().Format("2006-01")
	nodeMonthMap, _ := h.storage.GetNodeMonthTrafficMap(ctx, monthStr)

	for res := range resultsChan {
		n := res.node
		isOnline := res.online
		latency := res.latencyMs

		h.mu.Lock()
		status := models.StatusDetail{State: "green", CheckedAt: time.Now().UTC()}
		if !isOnline {
			status.State = "red"
			status.Reason = "API ноды недоступен; работа сервера не подтверждена"
		} else if res.health != nil && (!res.health.AWGAvailable || (n.HasHysteria && !res.health.HysteriaAvailable) || (n.HasMieru && !res.health.MieruAvailable) || (n.HasVless && !res.health.VlessAvailable)) {
			status.State = "yellow"
			status.Reason = "API отвечает, но настроенная VPN-служба недоступна"
		}
		h.serverStatuses[n.ID] = status
		wasOnline, existed := h.nodeStates[n.ID]
		prevFails := h.nodeFailures[n.ID]

		var shouldNotifyDown bool
		var shouldNotifyRecover bool
		var currentOnline bool

		if isOnline {
			h.nodeFailures[n.ID] = 0
			h.nodeStates[n.ID] = true
			h.nodeLatencies[n.ID] = latency
			currentOnline = true
			if existed && !wasOnline {
				shouldNotifyRecover = true
			}
		} else {
			h.nodeFailures[n.ID] = prevFails + 1
			h.nodeLatencies[n.ID] = 0
			if h.nodeFailures[n.ID] >= h.failureThreshold {
				h.nodeStates[n.ID] = false
				currentOnline = false
				if existed && wasOnline {
					shouldNotifyDown = true
				} else if !existed && !isInitial {
					shouldNotifyDown = true
				}
			} else {
				// While below failure threshold, preserve previous online state for status / dashboard
				if existed {
					currentOnline = wasOnline
				} else {
					currentOnline = false
					h.nodeStates[n.ID] = false
				}
				log.Printf("[MONITOR] ⚠️ Node probe failed for #%d %s (%s): %v (consecutive fails: %d/%d)", n.ID, n.Name, n.APIURL, res.err, h.nodeFailures[n.ID], h.failureThreshold)
			}
		}
		h.mu.Unlock()

		if currentOnline {
			onlineNodesCount++
			totalLatencySum += latency
			latencyCount++
		}

		if shouldNotifyDown {
			errReason := "Не отвечает (таймаут или ошибка подключения)"
			if res.err != nil {
				errReason = res.err.Error()
			}
			h.mu.RLock()
			fails := h.nodeFailures[n.ID]
			h.mu.RUnlock()
			log.Printf("[MONITOR] 🚨 Node DOWN: #%d %s (%s) - %s (consecutive fails: %d)", n.ID, n.Name, n.APIURL, errReason, fails)
			if h.logActivity != nil {
				h.logActivity(models.CategorySystem, "node_down", fmt.Sprintf("Сервер «%s» (#%d) стал недоступен: %s", n.Name, n.ID, errReason))
			}
			if h.bot != nil && h.bot.IsEnabled() {
				h.bot.NotifyNodeDown(n, errReason)
			}
		} else if shouldNotifyRecover {
			log.Printf("[MONITOR] ✅ Node RECOVERED: #%d %s (%s) - %dms", n.ID, n.Name, n.APIURL, latency)
			if h.logActivity != nil {
				h.logActivity(models.CategorySystem, "node_recovered", fmt.Sprintf("Сервер «%s» (#%d) восстановил работу (пинг: %d ms)", n.Name, n.ID, latency))
			}
			if h.bot != nil && h.bot.IsEnabled() {
				h.bot.NotifyNodeRecovered(n, latency)
			}
		}

		// Telemetry Delta Processing
		var nodePeerCount int
		var nodeTrafficTotal int64

		if res.stats != nil {
			nodePeerCount = len(res.stats.Peers)

			// 1. Process peers
			for _, peer := range res.stats.Peers {
				peerKey := peer.PublicKey
				if peerKey == "" {
					peerKey = peer.ClientName
				}
				mapKey := fmt.Sprintf("%d:%s", n.ID, peerKey)

				currRx := peer.RxBytes
				currTx := peer.TxBytes

				h.mu.Lock()
				prev, hasPrev := h.prevPeerRaw[mapKey]
				var rxDelta, txDelta int64
				if hasPrev {
					if currRx >= prev.rx {
						rxDelta = currRx - prev.rx
					} else {
						// Reset after reboot / service reload
						rxDelta = currRx
					}
					if currTx >= prev.tx {
						txDelta = currTx - prev.tx
					} else {
						txDelta = currTx
					}
				}
				h.prevPeerRaw[mapKey] = rawCounters{rx: currRx, tx: currTx}
				h.mu.Unlock()

				// Find matching config in DB
				var matchedCfg *models.ClientConfig
				if peer.PublicKey != "" {
					if cfg, ok := configByPubKey[fmt.Sprintf("%d:%s", n.ID, peer.PublicKey)]; ok {
						matchedCfg = &cfg
					}
				}
				if matchedCfg == nil && peer.ClientName != "" {
					if cfg, ok := configByName[fmt.Sprintf("%d:%s", n.ID, peer.ClientName)]; ok {
						matchedCfg = &cfg
					}
				}

				if matchedCfg != nil {
					// Update telemetry in SQLite
					_ = h.storage.RecordPeerTelemetry(ctx, matchedCfg.ID, rxDelta, txDelta, peer.LastHandshakeEpoch, peer.IsOnline)

					// Auto-fill missing PublicKey or IP
					if matchedCfg.PublicKey == "" && peer.PublicKey != "" {
						_ = h.storage.UpdateClientConfigPublicKey(ctx, matchedCfg.ID, peer.PublicKey, peer.AllowedIPs)
					}
				}

				if peer.IsOnline || (peer.LastHandshakeEpoch > 0 && (time.Now().Unix()-peer.LastHandshakeEpoch) <= 180) {
					activeDevicesOnline++
				}
			}

			// 2. Process node aggregate traffic
			currNodeRx := res.stats.TotalRx
			currNodeTx := res.stats.TotalTx
			h.mu.Lock()
			prevNode, hasNodePrev := h.prevNodeRaw[n.ID]
			var nodeRxDelta, nodeTxDelta int64
			if hasNodePrev {
				if currNodeRx >= prevNode.rx {
					nodeRxDelta = currNodeRx - prevNode.rx
				} else {
					nodeRxDelta = currNodeRx
				}
				if currNodeTx >= prevNode.tx {
					nodeTxDelta = currNodeTx - prevNode.tx
				} else {
					nodeTxDelta = currNodeTx
				}
			}
			h.prevNodeRaw[n.ID] = rawCounters{rx: currNodeRx, tx: currNodeTx}
			h.mu.Unlock()

			if nodeRxDelta > 0 || nodeTxDelta > 0 {
				_ = h.storage.RecordNodeTelemetry(ctx, n.ID, nodeRxDelta, nodeTxDelta)
			}

			nodeTrafficTotal = currNodeRx + currNodeTx
			if nodeTrafficTotal == 0 && (res.stats.TotalRx+res.stats.TotalTx > 0) {
				nodeTrafficTotal = res.stats.TotalRx + res.stats.TotalTx
			}
		}

		if mBytes, ok := nodeMonthMap[n.ID]; ok && mBytes > 0 {
			monthNetworkTrafficBytes += mBytes
		} else {
			monthNetworkTrafficBytes += nodeTrafficTotal
		}
		totalNetworkTrafficBytes += nodeTrafficTotal

		if n.Type == "cascade" {
			cascadeTrafficBytes += nodeTrafficTotal
		} else {
			directTrafficBytes += nodeTrafficTotal
		}

		nodeDashboardList = append(nodeDashboardList, models.NodeDashboardInfo{
			ActiveEgress:          res.activeEgress,
			ID:                    n.ID,
			Name:                  n.Name,
			Type:                  n.Type,
			CountryCode:           n.CountryCode,
			IsBackup:              n.IsBackup,
			Online:                isOnline,
			LatencyMs:             latency,
			PeerCount:             nodePeerCount,
			TotalTrafficFormatted: formatBytes(nodeTrafficTotal),
		})
	}

	var avgLatencyMs int64
	if latencyCount > 0 {
		avgLatencyMs = totalLatencySum / latencyCount
	}

	// Calculate topology breakdown
	cascadePct := 50
	directPct := 50
	combinedTraffic := cascadeTrafficBytes + directTrafficBytes
	if combinedTraffic > 0 {
		cascadePct = int((cascadeTrafficBytes * 100) / combinedTraffic)
		directPct = 100 - cascadePct
	}

	// System health status
	systemStatus := "operational"
	if len(nodes) > 0 {
		if onlineNodesCount == 0 {
			systemStatus = "degraded"
		} else if onlineNodesCount < len(nodes) {
			systemStatus = "degraded"
		}
	}

	// User count stats
	users, _ := h.storage.ListUsers(ctx)
	totalUsers := len(users)
	activeUsers := 0
	pendingUsers := 0
	for _, u := range users {
		if u.IsActive {
			activeUsers++
		} else {
			pendingUsers++
		}
	}

	// Total keys
	totalKeys := len(allConfigs)

	newDashboard := &models.DashboardStatsResponse{
		TotalUsers:            totalUsers,
		ActiveUsers:           activeUsers,
		PendingUsers:          pendingUsers,
		TotalKeys:             totalKeys,
		ActiveDevicesOnline:   activeDevicesOnline,
		TotalTrafficBytes:     totalNetworkTrafficBytes,
		MonthTrafficBytes:     monthNetworkTrafficBytes,
		TotalTrafficFormatted: formatBytes(totalNetworkTrafficBytes),
		MonthTrafficFormatted: formatBytes(monthNetworkTrafficBytes),
		TotalNodes:            len(nodes),
		OnlineNodes:           onlineNodesCount,
		AvgLatencyMs:          avgLatencyMs,
		SystemStatus:          systemStatus,
		TopologyBreakdown: models.TopologyTrafficBreakdown{
			CascadeTrafficBytes:     cascadeTrafficBytes,
			DirectTrafficBytes:      directTrafficBytes,
			CascadeTrafficFormatted: formatBytes(cascadeTrafficBytes),
			DirectTrafficFormatted:  formatBytes(directTrafficBytes),
			CascadePercentage:       cascadePct,
			DirectPercentage:        directPct,
		},
		Nodes:       nodeDashboardList,
		GeneratedAt: time.Now().UTC(),
	}

	h.mu.Lock()
	h.cachedDashboard = newDashboard
	h.mu.Unlock()
}

// GetLatestDashboardStats returns the latest telemetry snapshot (cached or generated).
func (h *HealthChecker) GetLatestDashboardStats(ctx context.Context) *models.DashboardStatsResponse {
	h.mu.RLock()
	cached := h.cachedDashboard
	h.mu.RUnlock()

	if cached != nil {
		return cached
	}

	h.collectTelemetryAndHealth(ctx, false)

	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.cachedDashboard
}

// CheckAllNodes returns real-time status and latency for all nodes.
func (h *HealthChecker) CheckAllNodes(ctx context.Context) ([]models.NodeWithStatus, error) {
	if h.storage == nil {
		return nil, fmt.Errorf("storage is not initialized")
	}

	nodes, err := h.storage.ListNodes(ctx)
	if err != nil {
		return nil, err
	}

	res := make([]models.NodeWithStatus, len(nodes))
	var wg sync.WaitGroup

	for i, n := range nodes {
		wg.Add(1)
		go func(idx int, node models.Node) {
			defer wg.Done()

			h.mu.RLock()
			isOnline, exists := h.nodeStates[node.ID]
			latency := h.nodeLatencies[node.ID]
			status, hasStatus := h.serverStatuses[node.ID]
			probes := append([]models.NetworkProbe{}, h.networkProbes[node.ID]...)
			h.mu.RUnlock()
			if !hasStatus {
				status = models.StatusDetail{State: "unknown", Reason: "Нет результатов фоновой проверки сервера"}
			} else if time.Since(status.CheckedAt) > 3*h.interval {
				status.State = "yellow"
				status.Reason = "Результат проверки сервера устарел"
			}

			if !exists {
				pingCtx, cancel := context.WithTimeout(ctx, h.nodeTimeout)
				defer cancel()

				slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
				start := time.Now()
				health, hErr := slaveCli.CheckHealth(pingCtx)
				latency = time.Since(start).Milliseconds()
				isOnline = hErr == nil && health != nil && health.Status == "ok"
				if !isOnline {
					latency = 0
				}
			}

			res[idx] = models.NodeWithStatus{
				Node:          node,
				Online:        isOnline,
				LatencyMs:     latency,
				ServerStatus:  status,
				NetworkStatus: netprobe.Aggregate(probes, time.Now()),
				NetworkProbes: probes,
			}
		}(i, n)
	}

	wg.Wait()
	return res, nil
}

// GetNodeDetail returns complete runtime diagnostics, stats, egress and peers for a single node.
func (h *HealthChecker) GetNodeDetail(ctx context.Context, id int64) (*models.NodeDetailResponse, error) {
	if h.storage == nil {
		return nil, fmt.Errorf("storage is not initialized")
	}

	node, err := h.storage.GetNodeByID(ctx, id)
	if err != nil {
		return nil, err
	}

	h.mu.RLock()
	isOnline, exists := h.nodeStates[node.ID]
	latency := h.nodeLatencies[node.ID]
	status, hasStatus := h.serverStatuses[node.ID]
	probes := append([]models.NetworkProbe{}, h.networkProbes[node.ID]...)
	h.mu.RUnlock()

	if !hasStatus {
		status = models.StatusDetail{State: "unknown", Reason: "Нет результатов фоновой проверки сервера"}
	} else if time.Since(status.CheckedAt) > 3*h.interval {
		status.State = "yellow"
		status.Reason = "Результат проверки сервера устарел"
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)

	// If never checked before, do an initial live ping
	if !exists {
		pingCtx, cancel := context.WithTimeout(ctx, h.nodeTimeout)
		start := time.Now()
		health, hErr := slaveCli.CheckHealth(pingCtx)
		latency = time.Since(start).Milliseconds()
		cancel()
		isOnline = hErr == nil && health != nil && health.Status == "ok"
		if !isOnline {
			latency = 0
		}
	}

	var health *models.HealthResponse
	var stats *models.StatsSummaryResponse
	var egress *models.EgressStatusResponse

	if isOnline {
		cctx, cancel := context.WithTimeout(ctx, h.nodeTimeout)
		health, _ = slaveCli.CheckHealth(cctx)
		cancel()

		sctx, scancel := context.WithTimeout(ctx, h.nodeTimeout)
		stats, _ = slaveCli.GetStats(sctx)
		scancel()

		if node.Type == "cascade" {
			ectx, ecancel := context.WithTimeout(ctx, h.nodeTimeout)
			egress, _ = slaveCli.GetCascadeEgress(ectx)
			ecancel()
		}
	}

	clientKeys, _ := h.storage.ListClientConfigsByNodeID(ctx, id)

	var failover *models.FailoverRuntimeStatus
	if node.Type == "cascade" {
		failover = h.GetFailoverStatus(node.ID)
	}

	return &models.NodeDetailResponse{
		NodeWithStatus: models.NodeWithStatus{
			Node:          *node,
			Online:        isOnline,
			LatencyMs:     latency,
			ServerStatus:  status,
			NetworkStatus: netprobe.Aggregate(probes, time.Now()),
			NetworkProbes: probes,
		},
		Health:     health,
		Stats:      stats,
		Egress:     egress,
		Failover:   failover,
		ClientKeys: clientKeys,
	}, nil
}

// DiagnoseNode runs a live diagnostic probe, latency check, and refreshes the node's cached status.
func (h *HealthChecker) DiagnoseNode(ctx context.Context, id int64) (*models.NodeDetailResponse, error) {
	if h.storage == nil {
		return nil, fmt.Errorf("storage is not initialized")
	}

	node, err := h.storage.GetNodeByID(ctx, id)
	if err != nil {
		return nil, err
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)

	pingCtx, cancel := context.WithTimeout(ctx, h.nodeTimeout)
	start := time.Now()
	health, hErr := slaveCli.CheckHealth(pingCtx)
	latency := time.Since(start).Milliseconds()
	cancel()

	isOnline := hErr == nil && health != nil && health.Status == "ok"
	if !isOnline {
		latency = 0
	}

	var status models.StatusDetail
	if isOnline {
		status = models.StatusDetail{
			State:     "green",
			CheckedAt: time.Now().UTC(),
			Reason:    fmt.Sprintf("Служба активна, время отклика API %d ms", latency),
		}
	} else {
		errMsg := "Сервер не отвечает на запросы Slave API"
		if hErr != nil {
			errMsg = hErr.Error()
		}
		status = models.StatusDetail{
			State:     "red",
			CheckedAt: time.Now().UTC(),
			Reason:    errMsg,
		}
	}

	var stats *models.StatsSummaryResponse
	var egress *models.EgressStatusResponse
	var remoteProbes []models.NetworkProbe

	if isOnline {
		sctx, scancel := context.WithTimeout(ctx, h.nodeTimeout)
		stats, _ = slaveCli.GetStats(sctx)
		scancel()

		if node.Type == "cascade" {
			ectx, ecancel := context.WithTimeout(ctx, h.nodeTimeout)
			egress, _ = slaveCli.GetCascadeEgress(ectx)
			ecancel()

			pctx, pcancel := context.WithTimeout(ctx, h.nodeTimeout)
			remoteProbes, _ = slaveCli.NetworkProbes(pctx)
			pcancel()
		}
	}

	// Run netprobe checks if configured
	targets := netprobe.TargetsFromEnv()
	var matchedTargets []netprobe.Target
	for _, t := range targets {
		if t.NodeID == node.ID {
			matchedTargets = append(matchedTargets, t)
		}
	}

	var localProbes []models.NetworkProbe
	if len(matchedTargets) > 0 {
		localProbes = netprobe.Run(ctx, "M0", matchedTargets)
	}

	for _, rp := range remoteProbes {
		rp.Source = "S0"
		localProbes = append(localProbes, rp)
	}

	h.mu.Lock()
	h.nodeStates[node.ID] = isOnline
	h.nodeLatencies[node.ID] = latency
	h.serverStatuses[node.ID] = status
	if len(localProbes) > 0 {
		h.networkProbes[node.ID] = localProbes
	}
	allProbes := append([]models.NetworkProbe{}, h.networkProbes[node.ID]...)
	h.mu.Unlock()

	clientKeys, _ := h.storage.ListClientConfigsByNodeID(ctx, id)

	var failover *models.FailoverRuntimeStatus
	if node.Type == "cascade" {
		failover = h.GetFailoverStatus(node.ID)
	}

	return &models.NodeDetailResponse{
		NodeWithStatus: models.NodeWithStatus{
			Node:          *node,
			Online:        isOnline,
			LatencyMs:     latency,
			ServerStatus:  status,
			NetworkStatus: netprobe.Aggregate(allProbes, time.Now()),
			NetworkProbes: allProbes,
		},
		Health:     health,
		Stats:      stats,
		Egress:     egress,
		Failover:   failover,
		ClientKeys: clientKeys,
	}, nil
}

// GetFailoverStatus returns the live auto-failover tracking state for a given node.
func (h *HealthChecker) GetFailoverStatus(nodeID int64) *models.FailoverRuntimeStatus {
	h.mu.RLock()
	defer h.mu.RUnlock()
	fails := h.failoverFailures[nodeID]
	cooldown, hasCooldown := h.failoverCooldown[nodeID]
	inCooldown := hasCooldown && time.Now().Before(cooldown)
	var cooldownPtr *time.Time
	if inCooldown {
		c := cooldown.UTC()
		cooldownPtr = &c
	}
	return &models.FailoverRuntimeStatus{
		InCooldown:          inCooldown,
		CooldownUntil:       cooldownPtr,
		ConsecutiveFailures: fails,
		FailureThreshold:    2,
	}
}

// ResetFailover resets the failure counter and sets a 5-minute cooldown period (e.g. after manual switch).
func (h *HealthChecker) ResetFailover(nodeID int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.failoverFailures[nodeID] = 0
	h.failoverCooldown[nodeID] = time.Now().Add(5 * time.Minute)
}

func formatBytes(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	} else if bytes < 1024*1024 {
		return fmt.Sprintf("%.2f KB", float64(bytes)/1024)
	} else if bytes < 1024*1024*1024 {
		return fmt.Sprintf("%.2f MB", float64(bytes)/(1024*1024))
	} else if bytes < 1024*1024*1024*1024 {
		return fmt.Sprintf("%.2f GB", float64(bytes)/(1024*1024*1024))
	}
	return fmt.Sprintf("%.2f TB", float64(bytes)/(1024*1024*1024*1024))
}

// refreshPublicNetwork is called by the telemetry loop, never by the node list endpoint.
func (h *HealthChecker) refreshPublicNetwork(ctx context.Context, nodes []models.Node) {
	targets := netprobe.TargetsFromEnv()
	if len(targets) == 0 {
		return
	}
	samples := netprobe.Run(ctx, "M0", targets)
	for _, n := range nodes {
		if n.Type != "cascade" || !n.IsActive {
			continue
		}
		cctx, cancel := context.WithTimeout(ctx, h.nodeTimeout)
		remote, err := client.NewSlaveClient(n.APIURL, n.APIKey).NetworkProbes(cctx)
		cancel()
		if err != nil || len(remote) == 0 {
			for _, t := range targets {
				samples = append(samples, models.NetworkProbe{NodeID: t.NodeID, Source: "S0", StatusDetail: models.StatusDetail{State: "unknown", CheckedAt: time.Now().UTC(), Reason: "Источник проверок S0 недоступен"}, Checks: []models.ProbeCheck{}})
			}
		} else {
			for _, p := range remote {
				p.Source = "S0"
				samples = append(samples, p)
			}
		}
		break
	}
	grouped := make(map[int64][]models.NetworkProbe)
	for _, p := range samples {
		grouped[p.NodeID] = append(grouped[p.NodeID], p)
	}
	h.mu.Lock()
	h.networkProbes = grouped
	h.mu.Unlock()
}
