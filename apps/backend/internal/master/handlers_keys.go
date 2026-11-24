package master

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/auth"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/client"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/runner"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/vless"
)

func (s *Server) handleListUserKeys(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	keys, err := s.storage.ListClientConfigsByUser(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, keys)
}

func (s *Server) handleCreateKey(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	var req models.CreateKeyRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	req.DeviceName = strings.TrimSpace(req.DeviceName)
	if req.DeviceName == "" {
		req.DeviceName = "device"
	}

	node, err := s.storage.GetNodeByID(r.Context(), req.NodeID)
	if err != nil || !node.IsActive {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Selected node is unavailable"})
		return
	}

	user, err := s.storage.GetUserByID(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "User not found"})
		return
	}

	if node.IsBackup && !user.IsPro && user.Role != models.RoleAdmin {
		s.writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "Данный сервер является запасным и доступен только для пользователей с тарифом PRO. Обратитесь к администратору для подключения.",
		})
		return
	}

	// Transliterate Russian/Cyrillic device names into clean Latin for client names and stored device name
	translitDevice := Transliterate(req.DeviceName)
	cleanDevice := SanitizeDeviceNameForClient(req.DeviceName)
	clientName := fmt.Sprintf("u%d_%s", claims.UserID, cleanDevice)
	proto := strings.ToLower(strings.TrimSpace(req.Protocol))
	if proto == "vless" {
		req.PSK = false
		if !user.IsActive || !node.HasVless || node.Type != "direct" {
			s.writeJSON(w, 403, map[string]string{"error": "VLESS недоступен"})
			return
		}
		health, err := client.NewSlaveClient(node.APIURL, node.APIKey).CheckHealth(r.Context())
		if err != nil || !health.VlessAvailable {
			s.writeJSON(w, 503, map[string]string{"error": "VLESS недоступен на ноде"})
			return
		}
		ref, err := vless.NewUUID()
		if err != nil {
			s.writeJSON(w, 500, map[string]string{"error": "key identifier unavailable"})
			return
		}
		clientName = "vless_" + ref
	} else if proto == "hysteria2" {
		if !node.HasHysteria {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "Выбранный сервер не поддерживает протокол Hysteria 2",
			})
			return
		}
	} else if proto == "mieru" {
		if !node.HasMieru {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "Выбранный сервер не поддерживает протокол Mieru",
			})
			return
		}
	} else {
		proto = "awg"
	}

	// Call Slave API
	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	slaveResp, err := slaveCli.CreateClient(r.Context(), clientName, req.PSK, proto)
	if err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Slave node failed: %v", err)})
		return
	}

	if proto == "vless" {
		if slaveResp.Protocol != "vless" || !strings.HasPrefix(slaveResp.VPNURI, "vless://") {
			s.writeJSON(w, 502, map[string]string{"error": "Invalid VLESS response"})
			return
		}
		slaveResp.PublicKey = ""
		w.Header().Set("Cache-Control", "no-store")
	}
	// Extract allocated IP from config
	allocIP := ""
	for _, l := range strings.Split(slaveResp.Config, "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "Address") {
			parts := strings.SplitN(l, "=", 2)
			if len(parts) == 2 {
				ips := strings.Split(parts[1], ",")
				if len(ips) > 0 {
					allocIP = strings.TrimSpace(strings.Split(strings.TrimSpace(ips[0]), "/")[0])
				}
			}
			break
		}
	}

	// Save record in DB with PublicKey, AllocatedIP, and Protocol (using transliterated device name)
	keyRecord, err := s.storage.CreateClientConfig(r.Context(), claims.UserID, node.ID, clientName, translitDevice, slaveResp.PublicKey, allocIP, proto)
	if err != nil {
		if proto == "vless" {
			if revokeErr := slaveCli.DeleteClient(context.WithoutCancel(r.Context()), clientName, "vless"); revokeErr != nil {
				log.Printf("VLESS cleanup required on node %d for reference %s", node.ID, clientName)
			}
		}
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	pskDetails := ""
	if proto == "vless" {
		pskDetails = " [VLESS+Reality]"
	}
	if req.PSK {
		pskDetails = " [PSK / Shadowrocket]"
	}
	if proto == "hysteria2" {
		pskDetails += " [Hysteria 2]"
	} else if proto == "mieru" {
		pskDetails += " [Mieru]"
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryKeys, "key_create", fmt.Sprintf("Создан VPN-ключ «%s» (%s)%s на сервере «%s»", translitDevice, clientName, pskDetails, node.Name))

	if proto == "awg" {
		cleanConfig := runner.SanitizeAWGConfig(slaveResp.Config)
		if cleanConfig != "" {
			slaveResp.Config = cleanConfig
		}
	}

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusCreated, map[string]any{
		"id":                keyRecord.ID,
		"client_name":       clientName,
		"device_name":       keyRecord.DeviceName,
		"node_id":           node.ID,
		"node_name":         node.Name,
		"node_type":         node.Type,
		"node_country_code": node.CountryCode,
		"protocol":          keyRecord.Protocol,
		"config":            slaveResp.Config,
		"qr_code":           slaveResp.QRCode,
		"vpn_uri":           slaveResp.VPNURI,
		"vpn_qr_code":       slaveResp.VPNQRCode,
		"created_at":        keyRecord.CreatedAt,
	})
}

func (s *Server) handleGetKey(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid key ID"})
		return
	}

	keyRecord, err := s.storage.GetClientConfigByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Key not found"})
		return
	}

	// Verify ownership unless admin
	if keyRecord.UserID != claims.UserID && claims.Role != models.RoleAdmin {
		s.writeJSON(w, http.StatusForbidden, map[string]string{"error": "Access denied"})
		return
	}

	node, err := s.storage.GetNodeByID(r.Context(), keyRecord.NodeID)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Node not found"})
		return
	}

	slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
	slaveResp, err := slaveCli.GetClient(r.Context(), keyRecord.ClientName, keyRecord.Protocol)
	if err != nil {
		s.writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("Failed to retrieve config from slave: %v", err)})
		return
	}

	if keyRecord.Protocol == "vless" {
		if slaveResp.Protocol != "vless" || !strings.HasPrefix(slaveResp.VPNURI, "vless://") {
			s.writeJSON(w, 502, map[string]string{"error": "Invalid VLESS response"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
	}
	if keyRecord.Protocol == "" || keyRecord.Protocol == "awg" {
		cleanKeyConfig := runner.SanitizeAWGConfig(slaveResp.Config)
		if cleanKeyConfig != "" {
			slaveResp.Config = cleanKeyConfig
		}
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryKeys, "key_view", fmt.Sprintf("Просмотр конфигурации / QR-кода ключа «%s» (%s)", keyRecord.DeviceName, keyRecord.ClientName))

	s.writeJSON(w, http.StatusOK, map[string]any{
		"id":                keyRecord.ID,
		"client_name":       keyRecord.ClientName,
		"device_name":       keyRecord.DeviceName,
		"node_id":           node.ID,
		"node_name":         node.Name,
		"node_type":         node.Type,
		"node_country_code": node.CountryCode,
		"protocol":          keyRecord.Protocol,
		"config":            slaveResp.Config,
		"qr_code":           slaveResp.QRCode,
		"vpn_uri":           slaveResp.VPNURI,
		"vpn_qr_code":       slaveResp.VPNQRCode,
		"created_at":        keyRecord.CreatedAt,
	})
}

func (s *Server) handleDeleteKey(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid key ID"})
		return
	}

	keyRecord, err := s.storage.GetClientConfigByID(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Key not found"})
		return
	}

	if keyRecord.UserID != claims.UserID && claims.Role != models.RoleAdmin {
		s.writeJSON(w, http.StatusForbidden, map[string]string{"error": "Access denied"})
		return
	}

	// Delete from Slave
	node, err := s.storage.GetNodeByID(r.Context(), keyRecord.NodeID)
	if err == nil {
		slaveCli := client.NewSlaveClient(node.APIURL, node.APIKey)
		err = slaveCli.DeleteClient(r.Context(), keyRecord.ClientName, keyRecord.Protocol)
	}

	if err != nil && keyRecord.Protocol == "vless" {
		s.writeJSON(w, 502, map[string]string{"error": "VLESS revoke failed"})
		return
	}
	if err := s.storage.DeleteClientConfig(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryKeys, "key_delete", fmt.Sprintf("Отозван и удален VPN-ключ «%s» (%s)", keyRecord.DeviceName, keyRecord.ClientName))

	s.invalidateDashboardCache()

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Key successfully deleted",
	})
}

func (s *Server) handleAdminListAllKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := s.storage.ListAllClientConfigs(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Filter by search and node_id
	search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
	nodeIDStr := strings.TrimSpace(r.URL.Query().Get("node_id"))
	var filterNodeID int64
	if nodeIDStr != "" {
		filterNodeID, _ = strconv.ParseInt(nodeIDStr, 10, 64)
	}

	var filtered []models.ClientConfig
	for _, k := range keys {
		if filterNodeID > 0 && k.NodeID != filterNodeID {
			continue
		}
		if search != "" {
			matchDevice := strings.Contains(strings.ToLower(k.DeviceName), search)
			matchClient := strings.Contains(strings.ToLower(k.ClientName), search)
			matchNode := strings.Contains(strings.ToLower(k.NodeName), search)
			matchUser := strings.Contains(strings.ToLower(k.Username), search)
			if !matchDevice && !matchClient && !matchNode && !matchUser {
				continue
			}
		}
		filtered = append(filtered, k)
	}

	// Guarantee reverse sort by ID (newest keys first)
	sort.SliceStable(filtered, func(i, j int) bool {
		return filtered[i].ID > filtered[j].ID
	})

	// Pagination
	page := 1
	limit := 10
	if pStr := r.URL.Query().Get("page"); pStr != "" {
		if p, pErr := strconv.Atoi(pStr); pErr == nil && p > 0 {
			page = p
		}
	}
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, lErr := strconv.Atoi(lStr); lErr == nil && l > 0 {
			limit = l
		}
	}

	totalCount := len(filtered)
	totalPages := (totalCount + limit - 1) / limit
	if totalPages == 0 {
		totalPages = 1
	}

	startIndex := (page - 1) * limit
	var pagedKeys []models.ClientConfig
	if startIndex < totalCount {
		endIndex := startIndex + limit
		if endIndex > totalCount {
			endIndex = totalCount
		}
		pagedKeys = filtered[startIndex:endIndex]
	} else {
		pagedKeys = []models.ClientConfig{}
	}

	s.writeJSON(w, http.StatusOK, models.PaginatedKeysResponse{
		Keys:       pagedKeys,
		TotalCount: totalCount,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	})
}
