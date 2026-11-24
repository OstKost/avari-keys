package master

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/auth"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.storage.ListUsers(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleAdminActivateUser(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	if err := s.storage.SetUserActive(r.Context(), id, true); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	targetUser, _ := s.storage.GetUserByID(r.Context(), id)
	targetUsername := ""
	if targetUser != nil {
		targetUsername = targetUser.Username
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_user_activate", fmt.Sprintf("Активирован доступ для пользователя «%s» (ID #%d)", targetUsername, id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "User activated"})
}

func (s *Server) handleAdminDeactivateUser(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	if err := s.storage.SetUserActive(r.Context(), id, false); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	targetUser, _ := s.storage.GetUserByID(r.Context(), id)
	targetUsername := ""
	if targetUser != nil {
		targetUsername = targetUser.Username
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_user_deactivate", fmt.Sprintf("Заблокирован доступ для пользователя «%s» (ID #%d)", targetUsername, id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "User deactivated"})
}

func (s *Server) handleAdminSetUserRole(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	var req models.SetRoleRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	if err := s.storage.SetUserRole(r.Context(), id, req.Role); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	targetUser, _ := s.storage.GetUserByID(r.Context(), id)
	targetUsername := ""
	if targetUser != nil {
		targetUsername = targetUser.Username
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_user_role", fmt.Sprintf("Изменена роль пользователя «%s» (ID #%d) на «%s»", targetUsername, id, req.Role))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Роль пользователя изменена на %s", req.Role),
	})
}

func (s *Server) handleAdminSetUserPro(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	var req models.SetUserProRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	if err := s.storage.SetUserPro(r.Context(), id, req.IsPro); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	targetUser, _ := s.storage.GetUserByID(r.Context(), id)
	targetUsername := ""
	if targetUser != nil {
		targetUsername = targetUser.Username
	}

	statusStr := "отключен"
	if req.IsPro {
		statusStr = "активирован"
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_user_pro", fmt.Sprintf("Тариф PRO %s для пользователя «%s» (ID #%d)", statusStr, targetUsername, id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("PRO status updated to %v", req.IsPro),
	})
}

func (s *Server) handleAdminApprovePasswordReset(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	targetUser, err := s.storage.GetUserByID(r.Context(), id)
	if err != nil || targetUser == nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
		return
	}

	if err := s.storage.ApprovePasswordResetByUserID(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_pwd_reset_approve", fmt.Sprintf("Одобрен сброс пароля для пользователя «%s» (ID #%d)", targetUser.Username, id))

	if s.telegramBot != nil && s.telegramBot.IsEnabled() {
		go s.telegramBot.NotifyUserPasswordResetApproved(*targetUser)
	}

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "Password reset approved"})
}

func (s *Server) handleAdminRejectPasswordReset(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	targetUser, err := s.storage.GetUserByID(r.Context(), id)
	if err != nil || targetUser == nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
		return
	}

	if err := s.storage.RejectPasswordResetByUserID(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_pwd_reset_reject", fmt.Sprintf("Отклонен сброс пароля для пользователя «%s» (ID #%d)", targetUser.Username, id))

	if s.telegramBot != nil && s.telegramBot.IsEnabled() {
		go s.telegramBot.NotifyUserPasswordResetRejected(*targetUser)
	}

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "Password reset rejected"})
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid user ID"})
		return
	}

	targetUser, _ := s.storage.GetUserByID(r.Context(), id)
	targetUsername := ""
	if targetUser != nil {
		targetUsername = targetUser.Username
	}

	keys, err := s.storage.ListClientConfigsByUser(r.Context(), id)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key lookup failed"})
		return
	}
	for _, key := range keys {
		if key.Protocol == "vless" {
			s.writeJSON(w, http.StatusConflict, map[string]string{"error": "Сначала отзовите VLESS-ключи"})
			return
		}
	}
	if err := s.storage.DeleteUser(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_user_delete", fmt.Sprintf("Удален пользователь «%s» (ID #%d)", targetUsername, id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{Success: true, Message: "User deleted"})
}

func (s *Server) handleAdminListAuditLogs(w http.ResponseWriter, r *http.Request) {
	var filter models.AuditLogFilter

	if uidStr := strings.TrimSpace(r.URL.Query().Get("user_id")); uidStr != "" {
		if uid, err := strconv.ParseInt(uidStr, 10, 64); err == nil && uid > 0 {
			filter.UserID = &uid
		}
	}

	filter.Username = strings.TrimSpace(r.URL.Query().Get("username"))
	filter.Category = strings.TrimSpace(r.URL.Query().Get("category"))
	filter.Action = strings.TrimSpace(r.URL.Query().Get("action"))
	filter.FromDate = strings.TrimSpace(r.URL.Query().Get("from"))
	filter.ToDate = strings.TrimSpace(r.URL.Query().Get("to"))

	page := 1
	limit := 50
	if pStr := r.URL.Query().Get("page"); pStr != "" {
		if p, err := strconv.Atoi(pStr); err == nil && p > 0 {
			page = p
		}
	}
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			limit = l
		}
	}
	filter.Page = page
	filter.Limit = limit

	logs, totalCount, err := s.storage.ListAuditLogs(r.Context(), filter)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	totalPages := (totalCount + limit - 1) / limit
	if totalPages == 0 {
		totalPages = 1
	}

	s.writeJSON(w, http.StatusOK, models.PaginatedAuditLogsResponse{
		Logs:       logs,
		TotalCount: totalCount,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	})
}

func (s *Server) handleAdminCleanupAuditLogs(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	var req models.CleanupLogsRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	days := req.Days
	if days <= 0 {
		days = 90 // Default 3 months
	}

	deleted, err := s.storage.PurgeAuditLogsOlderThan(r.Context(), days)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_logs_cleanup", fmt.Sprintf("Очищен журнал аудита старше %d дней (удалено записей: %d)", days, deleted))

	s.writeJSON(w, http.StatusOK, models.CleanupLogsResponse{
		Success:      true,
		Message:      fmt.Sprintf("Успешно удалено записей старше %d дней: %d", days, deleted),
		DeletedCount: deleted,
	})
}

func (s *Server) handleAdminGetTelegramStatus(w http.ResponseWriter, r *http.Request) {
	chats, err := s.storage.ListTelegramChats(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	botUsername := s.cfg.TelegramBotUsername
	var settings *models.TelegramSettings
	isEnabled := false
	if s.telegramBot != nil {
		snap := s.telegramBot.GetSettings()
		settings = &snap
		if snap.BotUsername != "" {
			botUsername = snap.BotUsername
		}
		isEnabled = s.telegramBot.IsEnabled()
	} else {
		dbSettings, err := s.storage.GetTelegramSettings(r.Context())
		if err == nil && dbSettings != nil {
			settings = dbSettings
			if dbSettings.BotUsername != "" {
				botUsername = dbSettings.BotUsername
			}
			isEnabled = dbSettings.Enabled
		}
	}

	s.writeJSON(w, http.StatusOK, models.TelegramStatusResponse{
		Enabled:          isEnabled,
		BotUsername:      botUsername,
		Settings:         settings,
		Subscribers:      chats,
		TotalSubscribers: len(chats),
	})
}

func (s *Server) handleAdminGetTelegramSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.storage.GetTelegramSettings(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Also sync live bot username if known
	if s.telegramBot != nil {
		snap := s.telegramBot.GetSettings()
		if snap.BotUsername != "" && settings.BotUsername == "" {
			settings.BotUsername = snap.BotUsername
		}
	}

	s.writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleAdminUpdateTelegramSettings(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.TelegramSettings
	if !s.decodeJSON(w, r, &req) {
		return
	}

	req.BotToken = strings.TrimSpace(req.BotToken)
	req.BotUsername = strings.TrimSpace(req.BotUsername)
	req.AdminSecret = strings.TrimSpace(req.AdminSecret)

	// If token is provided and enabled, validate with Telegram getMe API
	if req.Enabled && req.BotToken != "" && s.telegramBot != nil {
		detectedUsername, _, err := s.telegramBot.ValidateToken(req.BotToken)
		if err != nil {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("Ошибка валидации токена Telegram: %v", err)})
			return
		}
		if detectedUsername != "" {
			req.BotUsername = detectedUsername
		}
	}

	saved, err := s.storage.UpdateTelegramSettings(r.Context(), req)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Hot reload running Telegram bot instance
	if s.telegramBot != nil {
		_ = s.telegramBot.UpdateConfig(context.Background(), *saved)
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_telegram_settings_update", fmt.Sprintf("Обновлены настройки Telegram-бота @%s (Enabled: %v)", saved.BotUsername, saved.Enabled))

	s.writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleAdminDeleteTelegramSubscriber(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid chat ID"})
		return
	}

	if err := s.storage.DeleteTelegramChat(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_telegram_subscriber_delete", fmt.Sprintf("Удален получатель Telegram-оповещений (Chat ID #%d)", id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Получатель успешно удален из списка рассылки",
	})
}

func (s *Server) handleAdminToggleTelegramSubscriber(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid chat ID"})
		return
	}

	var req models.TelegramSubscriberToggleRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	if err := s.storage.SetTelegramAlertsEnabled(r.Context(), id, req.AlertsEnabled); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	statusText := "отключены"
	if req.AlertsEnabled {
		statusText = "включены"
	}
	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_telegram_subscriber_toggle", fmt.Sprintf("Оповещения для Telegram-чата #%d %s", id, statusText))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Оповещения для чата %s", statusText),
	})
}

func (s *Server) handleAdminSendTelegramTest(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	if s.telegramBot == nil || !s.telegramBot.IsEnabled() {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Telegram bot is not configured or disabled"})
		return
	}

	if err := s.telegramBot.SendTestAlert(0); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Failed to send test alert: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_telegram_test", "Отправлено тестовое оповещение в Telegram")
	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Тестовое оповещение успешно отправлено во все привязанные Telegram-чаты",
	})
}

func (s *Server) handleGetUserTelegramStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())

	botUsername := s.cfg.TelegramBotUsername
	botEnabled := false
	if s.telegramBot != nil {
		snap := s.telegramBot.GetSettings()
		botEnabled = s.telegramBot.IsEnabled()
		if snap.BotUsername != "" {
			botUsername = snap.BotUsername
		}
	} else {
		dbSettings, err := s.storage.GetTelegramSettings(r.Context())
		if err == nil && dbSettings != nil {
			if dbSettings.BotUsername != "" {
				botUsername = dbSettings.BotUsername
			}
			botEnabled = dbSettings.Enabled
		}
	}

	chat, _ := s.storage.GetTelegramChatByUserID(r.Context(), claims.UserID)
	isLinked := chat != nil
	var chatID *int64
	tgUsername := ""
	alertsEnabled := false
	if chat != nil {
		chatID = &chat.ChatID
		tgUsername = chat.Username
		alertsEnabled = chat.AlertsEnabled
	}

	token, _ := s.storage.GetOrCreateTelegramLinkToken(r.Context(), claims.UserID)
	deepLink := ""
	if botUsername != "" {
		deepLink = fmt.Sprintf("https://t.me/%s?start=link_%s", botUsername, token)
	}

	s.writeJSON(w, http.StatusOK, models.UserTelegramStatusResponse{
		BotUsername:      botUsername,
		BotEnabled:       botEnabled,
		IsLinked:         isLinked,
		TelegramChatID:   chatID,
		TelegramUsername: tgUsername,
		AlertsEnabled:    alertsEnabled,
		DeepLink:         deepLink,
	})
}

func (s *Server) handleUserUnlinkTelegram(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	chat, err := s.storage.GetTelegramChatByUserID(r.Context(), claims.UserID)
	if err == nil && chat != nil {
		_ = s.storage.DeleteTelegramChat(r.Context(), chat.ChatID)
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAuth, "user_telegram_unlink", "Отвязан Telegram-чат пользователя")

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Telegram успешно отвязан от вашего аккаунта",
	})
}
