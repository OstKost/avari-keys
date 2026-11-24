package master

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/auth"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/client"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// Admin: Torrent Traffic Policy & Blocklist

// handleAdminGetTrafficPolicy returns the current policy and blocklist.
func (s *Server) handleAdminGetTrafficPolicy(w http.ResponseWriter, r *http.Request) {
	mode, err := s.storage.GetTrafficPolicy(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	blocklist, err := s.storage.ListTorrentBlocklist(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, models.TrafficPolicyView{
		Mode:      mode,
		Blocklist: blocklist,
	})
}

// handleAdminUpdateTrafficPolicy persists a new mode and fans it out to all active nodes.
func (s *Server) handleAdminUpdateTrafficPolicy(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	var req models.TrafficPolicyRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}
	if !req.Mode.Valid() {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid traffic policy %q", req.Mode)})
		return
	}
	if req.Mode == models.PolicyStrict {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "strict policy is not implemented yet"})
		return
	}

	if err := s.storage.SetTrafficPolicy(r.Context(), req.Mode); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	applied, failed, errs := s.fanoutTrafficPolicy(r.Context(), req.Mode)

	if claims != nil {
		s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_traffic_policy", fmt.Sprintf("Установлена политика фильтрации торрентов: %s (нод применено: %d, ошибок: %d)", req.Mode, applied, failed))
	}

	s.writeJSON(w, http.StatusOK, models.TrafficPolicyFanoutResponse{
		Mode:         req.Mode,
		AppliedNodes: applied,
		FailedNodes:  failed,
		Errors:       errs,
	})
}

// handleAdminListTorrentBlocklist returns the editable domain blocklist.
func (s *Server) handleAdminListTorrentBlocklist(w http.ResponseWriter, r *http.Request) {
	entries, err := s.storage.ListTorrentBlocklist(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, entries)
}

// handleAdminAddTorrentBlocklist adds a domain and re-fans the list out to nodes.
func (s *Server) handleAdminAddTorrentBlocklist(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	var req models.TorrentBlocklistRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}
	if req.Domain == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "domain is required"})
		return
	}

	entry, err := s.storage.AddTorrentBlocklistDomain(r.Context(), req.Domain, claims.Username)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Re-push the updated list (only relevant while the filter is soft).
	s.refreshBlocklistOnNodes(r)

	if claims != nil {
		s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_torrent_blocklist_add", fmt.Sprintf("Добавлен домен «%s» в блок-лист торрентов", entry.Domain))
	}

	s.writeJSON(w, http.StatusCreated, entry)
}

// handleAdminDeleteTorrentBlocklist removes a domain and re-fans the list out to nodes.
func (s *Server) handleAdminDeleteTorrentBlocklist(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid blocklist entry ID"})
		return
	}

	if err := s.storage.DeleteTorrentBlocklistDomain(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "Blocklist entry not found"})
		return
	}

	s.refreshBlocklistOnNodes(r)

	if claims != nil {
		s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_torrent_blocklist_delete", fmt.Sprintf("Удалён домен из блок-листа торрентов (ID #%d)", id))
	}

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "Blocklist entry removed"})
}

// fanoutTrafficPolicy applies the policy and current blocklist to every active node.
func (s *Server) fanoutTrafficPolicy(ctx context.Context, mode models.TrafficPolicy) (applied, failed int, errs []string) {
	domains := s.blocklistDomains(ctx)

	nodes, err := s.storage.ListNodes(ctx)
	if err != nil {
		return 0, 0, []string{err.Error()}
	}

	for _, n := range nodes {
		if !n.IsActive {
			continue
		}
		slaveCli := client.NewSlaveClient(n.APIURL, n.APIKey)
		if err := slaveCli.ApplyFirewall(ctx, mode); err != nil {
			failed++
			errs = append(errs, fmt.Sprintf("%s: %v", n.Name, err))
			continue
		}
		if err := slaveCli.ApplyFirewallBlocklist(ctx, domains); err != nil {
			failed++
			errs = append(errs, fmt.Sprintf("%s: %v", n.Name, err))
			continue
		}
		applied++
	}
	return applied, failed, errs
}

// refreshBlocklistOnNodes re-pushes the blocklist to active nodes (best effort).
func (s *Server) refreshBlocklistOnNodes(r *http.Request) {
	domains := s.blocklistDomains(r.Context())
	nodes, err := s.storage.ListNodes(r.Context())
	if err != nil {
		return
	}
	for _, n := range nodes {
		if !n.IsActive {
			continue
		}
		slaveCli := client.NewSlaveClient(n.APIURL, n.APIKey)
		_ = slaveCli.ApplyFirewallBlocklist(r.Context(), domains)
	}
}

// blocklistDomains returns the current blocklist as a plain domain slice.
func (s *Server) blocklistDomains(ctx context.Context) []string {
	entries, err := s.storage.ListTorrentBlocklist(ctx)
	if err != nil {
		return []string{}
	}
	domains := make([]string, 0, len(entries))
	for _, e := range entries {
		domains = append(domains, e.Domain)
	}
	return domains
}
