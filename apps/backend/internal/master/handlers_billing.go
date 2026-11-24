package master

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/auth"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

func (s *Server) handleGetDashboardStats(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	isFresh := r.URL.Query().Get("fresh") == "true" || r.URL.Query().Get("force") == "true"

	if isFresh && s.healthChecker != nil {
		s.healthChecker.CollectTelemetry(r.Context())
	}

	var stats *models.DashboardStatsResponse
	if s.healthChecker != nil {
		stats = s.healthChecker.GetLatestDashboardStats(r.Context())
	}

	if stats == nil {
		users, _ := s.storage.ListUsers(r.Context())
		allConfigs, _ := s.storage.ListAllClientConfigs(r.Context())
		nodes, _ := s.storage.ListNodes(r.Context())
		activeUsers := 0
		pendingUsers := 0
		for _, u := range users {
			if u.IsActive {
				activeUsers++
			} else {
				pendingUsers++
			}
		}

		stats = &models.DashboardStatsResponse{
			TotalUsers:            len(users),
			ActiveUsers:           activeUsers,
			PendingUsers:          pendingUsers,
			TotalKeys:             len(allConfigs),
			TotalNodes:            len(nodes),
			OnlineNodes:           len(nodes),
			SystemStatus:          "operational",
			GeneratedAt:           time.Now().UTC(),
			TotalTrafficFormatted: "0 B",
			MonthTrafficFormatted: "0 B",
		}
	}

	respCopy := *stats
	if claims == nil || claims.Role != models.RoleAdmin {
		respCopy.PendingUsers = 0
	}

	s.writeJSON(w, http.StatusOK, respCopy)
}

func (s *Server) handleGetBillingStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	status, err := s.storage.GetBillingStatus(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, status)
}

func (s *Server) handlePayDues(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.PayDuesRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	rec, err := s.storage.RecordPayment(r.Context(), claims.UserID, claims.Username, req.Amount, req.Note)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	details := fmt.Sprintf("Подтверждение оплаты взноса: период %s", rec.PeriodMonth)
	if req.Note != "" {
		details += fmt.Sprintf(" (%s)", req.Note)
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryBilling, "payment_recorded", details)

	status, err := s.storage.GetBillingStatus(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleSnoozeDues(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.SnoozeDuesRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Days <= 0 {
		req.Days = 1
	}

	if err := s.storage.SnoozeBillingReminder(r.Context(), claims.UserID, req.Days); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryBilling, "reminder_snoozed", fmt.Sprintf("Напоминание о взносе отложено на %d дн.", req.Days))

	status, err := s.storage.GetBillingStatus(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleAdminGetBilling(w http.ResponseWriter, r *http.Request) {
	summary, err := s.storage.GetAllBillingRecords(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleGetBillingRequisites(w http.ResponseWriter, r *http.Request) {
	reqs, err := s.storage.GetBillingRequisites(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, reqs)
}

func (s *Server) handleAdminUpdateBillingRequisites(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.BillingRequisites
	if !s.decodeJSON(w, r, &req) {
		return
	}

	updated, err := s.storage.UpdateBillingRequisites(r.Context(), req)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "billing_requisites_update", fmt.Sprintf("Обновлены платежные реквизиты: СБП %s (%s)", updated.SBPPhone, updated.SBPBank))

	s.writeJSON(w, http.StatusOK, updated)
}
