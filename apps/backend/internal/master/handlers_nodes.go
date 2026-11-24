package master

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/auth"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/client"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// User: Nodes & Telegram Proxies

func (s *Server) handleListActiveNodes(w http.ResponseWriter, r *http.Request) {
	nodes, err := s.storage.ListActiveNodesPublic(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) handleGetTelegramProxies(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("TELEGRAM_PROXY_SECRET")
	server := os.Getenv("TELEGRAM_PROXY_SERVER")
	port := 8443
	if raw := os.Getenv("TELEGRAM_PROXY_PORT"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 65535 {
			s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Invalid proxy port"})
			return
		}
		port = n
	}
	if server == "" || secret == "" {
		s.writeJSON(w, http.StatusOK, []models.TelegramProxyInfo{})
		return
	}
	params := url.Values{"server": {server}, "port": {strconv.Itoa(port)}, "secret": {secret}}
	link := "tg://proxy?" + params.Encode()

	proxies := []models.TelegramProxyInfo{
		{
			ID:          "s2-fin",
			Name:        "Финляндия (FIN)",
			CountryCode: "FIN",
			Server:      server,
			Port:        port,
			Secret:      secret,
			Link:        link,
			Status:      "online",
		},
	}
	s.writeJSON(w, http.StatusOK, proxies)
}

// Admin: Nodes Management & Diagnostics

func (s *Server) handleAdminListNodes(w http.ResponseWriter, r *http.Request) {
	nodes, err := s.healthChecker.CheckAllNodes(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) handleAdminGetNode(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	detail, err := s.healthChecker.GetNodeDetail(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleAdminDiagnoseNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	detail, err := s.healthChecker.DiagnoseNode(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if claims != nil {
		s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_diagnose", fmt.Sprintf("Выполнена диагностика узла «%s» (ID #%d)", detail.Name, detail.ID))
	}

	s.writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleAdminRestartNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	if err := slaveCli.Restart(r.Context()); err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Restart failed: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_restart", fmt.Sprintf("Перезапущен сервис AmneziaWG на узле «%s» (ID #%d)", node.Name, node.ID))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Node '%s' AWG service restarted successfully", node.Name),
	})
}

func (s *Server) handleAdminBackupNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	backup, err := slaveCli.Backup(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Backup failed: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_backup", fmt.Sprintf("Выгружена резервная копия конфигурации узла «%s» (ID #%d)", node.Name, node.ID))

	s.writeJSON(w, http.StatusOK, backup)
}

func (s *Server) handleAdminRestoreNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	var req models.RestoreNodeRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}
	if req.BackupData == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "backup_data is required"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	if err := slaveCli.Restore(r.Context(), req.BackupData); err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Restore failed: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_restore", fmt.Sprintf("Восстановлена конфигурация узла «%s» (ID #%d) из резервной копии", node.Name, node.ID))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Node '%s' restored successfully from backup", node.Name),
	})
}

func (s *Server) handleAdminGetNodeEgress(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	if node.Type != "cascade" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Node is not a cascade node"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	egress, err := slaveCli.GetCascadeEgress(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to get egress status: %v", err)})
		return
	}

	s.writeJSON(w, http.StatusOK, egress)
}

func (s *Server) handleAdminSwitchNodeEgress(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	if node.Type != "cascade" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Node is not a cascade node"})
		return
	}

	var req models.SwitchEgressRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}
	if req.Interface == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "interface is required (e.g. 'awg1' or 'awg3')"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	if err := slaveCli.SwitchCascadeEgress(r.Context(), req.Interface); err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to switch egress: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_switch_egress", fmt.Sprintf("Переключен шлюз выхода каскада для узла «%s» (ID #%d) на интерфейс %s", node.Name, node.ID, req.Interface))

	if s.healthChecker != nil {
		s.healthChecker.ResetFailover(node.ID)
	}

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Cascade egress on node '%s' switched to %s", node.Name, req.Interface),
	})
}

func (s *Server) handleAdminRestartNodeEgress(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	if node.Type != "cascade" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Node is not a cascade node"})
		return
	}

	var req models.SwitchEgressRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}
	if req.Interface == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "interface is required (e.g. 'awg1' or 'awg3')"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	if err := slaveCli.RestartCascadeEgress(r.Context(), req.Interface); err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to restart egress: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_restart_egress", fmt.Sprintf("Перезапущен шлюз выхода каскада для узла «%s» (ID #%d) на интерфейсе %s", node.Name, node.ID, req.Interface))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Cascade egress %s on node '%s' restarted successfully", req.Interface, node.Name),
	})
}

func (s *Server) handleAdminAddNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.AddNodeRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.APIURL = strings.TrimSpace(req.APIURL)
	req.APIKey = strings.TrimSpace(req.APIKey)
	req.Type = strings.TrimSpace(req.Type)
	req.CountryCode = strings.ToUpper(strings.TrimSpace(req.CountryCode))
	req.ProviderURL = strings.TrimSpace(req.ProviderURL)

	if req.Name == "" || req.APIURL == "" || req.APIKey == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Name, API URL, and API Key are required"})
		return
	}

	if req.Type != "cascade" && req.Type != "direct" {
		req.Type = "direct"
	}

	node, err := s.storage.CreateNode(r.Context(), req.Name, req.Type, req.CountryCode, req.ProviderURL, req.APIURL, req.APIKey, req.IsMobileOptimized, req.IsBackup, req.HasHysteria, req.HasMieru, req.HasVless)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	backupTag := ""
	if node.IsBackup {
		backupTag = " [Запасной/Backup]"
	}
	mobileTag := ""
	if node.IsMobileOptimized {
		mobileTag = " [Mobile 443/UDP]"
	}
	hysteriaTag := ""
	if node.HasHysteria {
		hysteriaTag = " [Hysteria 2]"
	}
	mieruTag := ""
	if node.HasMieru {
		mieruTag = " [Mieru]"
	}
	countryTag := ""
	if node.CountryCode != "" {
		countryTag = fmt.Sprintf(" [%s]", node.CountryCode)
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_create", fmt.Sprintf("Добавлен новый сервер «%s» (%s%s%s%s%s%s, URL: %s)", node.Name, node.Type, countryTag, mobileTag, backupTag, hysteriaTag, mieruTag, node.APIURL))

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusCreated, node)
}

func (s *Server) handleAdminUpdateNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	var req models.UpdateNodeRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.APIURL = strings.TrimSpace(req.APIURL)
	req.APIKey = strings.TrimSpace(req.APIKey)
	req.Type = strings.TrimSpace(req.Type)
	req.CountryCode = strings.ToUpper(strings.TrimSpace(req.CountryCode))
	req.ProviderURL = strings.TrimSpace(req.ProviderURL)

	if req.Name == "" || req.APIURL == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Name and API URL are required"})
		return
	}

	if req.Type != "cascade" && req.Type != "direct" {
		req.Type = "direct"
	}

	capabilities := []bool{req.HasMieru}
	if req.HasVless != nil {
		capabilities = append(capabilities, *req.HasVless)
	}
	node, err := s.storage.UpdateNode(r.Context(), id, req.Name, req.Type, req.CountryCode, req.ProviderURL, req.APIURL, req.APIKey, req.IsMobileOptimized, req.IsBackup, req.HasHysteria, capabilities...)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if req.AutoFailoverEnabled != nil || req.FailoverPriority != nil {
		autoVal := node.AutoFailoverEnabled
		if req.AutoFailoverEnabled != nil {
			autoVal = *req.AutoFailoverEnabled
		}
		prioVal := node.FailoverPriority
		if req.FailoverPriority != nil {
			prioVal = req.FailoverPriority
		}
		node, err = s.storage.UpdateNodeFailoverSettings(r.Context(), id, autoVal, prioVal)
		if err != nil {
			s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}

	backupTag := ""
	if node.IsBackup {
		backupTag = " [Запасной/Backup]"
	}
	mobileTag := ""
	if node.IsMobileOptimized {
		mobileTag = " [Mobile 443/UDP]"
	}
	hysteriaTag := ""
	if node.HasHysteria {
		hysteriaTag = " [Hysteria 2]"
	}
	mieruTag := ""
	if node.HasMieru {
		mieruTag = " [Mieru]"
	}
	countryTag := ""
	if node.CountryCode != "" {
		countryTag = fmt.Sprintf(" [%s]", node.CountryCode)
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_update", fmt.Sprintf("Обновлены параметры сервера «%s» (ID #%d, %s%s%s%s%s%s, URL: %s)", node.Name, node.ID, node.Type, countryTag, mobileTag, backupTag, hysteriaTag, mieruTag, node.APIURL))

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusOK, node)
}

func (s *Server) handleAdminUpdateNodeFailover(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	var req models.NodeFailoverSettingsRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}
	if node.Type != "cascade" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Auto-Failover is only applicable to cascade nodes"})
		return
	}

	updatedNode, err := s.storage.UpdateNodeFailoverSettings(r.Context(), id, req.AutoFailoverEnabled, req.FailoverPriority)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	stateStr := "отключено"
	if req.AutoFailoverEnabled {
		stateStr = fmt.Sprintf("включено (приоритеты: %v)", req.FailoverPriority)
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_cascade_failover_settings",
		fmt.Sprintf("Обновлены настройки Auto-Failover для каскада «%s» (#%d): %s", node.Name, node.ID, stateStr))

	s.writeJSON(w, http.StatusOK, updatedNode)
}

func (s *Server) handleAdminDeleteNode(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid node ID"})
		return
	}

	node, _ := s.storage.GetNodeByID(r.Context(), id)
	nodeName := ""
	if node != nil {
		nodeName = node.Name
	}

	keys, err := s.storage.ListClientConfigsByNodeID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, 500, map[string]string{"error": "key lookup failed"})
		return
	}
	for _, key := range keys {
		if key.Protocol == "vless" {
			s.writeJSON(w, 409, map[string]string{"error": "Сначала отзовите VLESS-ключи"})
			return
		}
	}
	if err := s.storage.DeleteNode(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_node_delete", fmt.Sprintf("Удален сервер «%s» (ID #%d)", nodeName, id))

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "Node deleted"})
}
