package master

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/auth"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	user, err := s.storage.CreateUser(r.Context(), req.Username, req.Password)
	if err != nil {
		s.logActivity(r, nil, req.Username, models.CategoryAuth, "auth_register_failed", fmt.Sprintf("Ошибка регистрации: %v", err))
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &user.ID, user.Username, models.CategoryAuth, "auth_register", "Регистрация нового аккаунта (ожидает подтверждения администратора)")

	if s.telegramBot != nil && s.telegramBot.IsEnabled() {
		go s.telegramBot.NotifyNewUser(*user)
	}

	s.writeJSON(w, http.StatusCreated, map[string]any{
		"message": "Registration successful. Please wait for administrator approval before logging in.",
		"user": models.UserPublic{
			ID:        user.ID,
			Username:  user.Username,
			Role:      user.Role,
			IsActive:  user.IsActive,
			IsPro:     user.IsPro,
			CreatedAt: user.CreatedAt,
		},
	})
}

func (s *Server) handleResetPasswordRequest(w http.ResponseWriter, r *http.Request) {
	var req models.ResetPasswordRequestDTO
	if !s.decodeJSON(w, r, &req) {
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Имя пользователя не может быть пустым"})
		return
	}

	if len(req.NewPassword) < 6 {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Новый пароль должен содержать не менее 6 символов"})
		return
	}

	pwdReq, user, err := s.storage.CreatePasswordResetRequest(r.Context(), req.Username, req.NewPassword)
	if err != nil {
		s.logActivity(r, nil, req.Username, models.CategoryAuth, "auth_pwd_reset_failed", fmt.Sprintf("Ошибка запроса сброса пароля: %v", err))
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &user.ID, user.Username, models.CategoryAuth, "auth_pwd_reset_request", "Запрос на сброс пароля (ожидает подтверждения администратора)")

	if s.telegramBot != nil && s.telegramBot.IsEnabled() {
		go s.telegramBot.NotifyPasswordReset(*pwdReq, *user)
	}

	s.writeJSON(w, http.StatusOK, map[string]string{
		"message": "Запрос на сброс пароля отправлен администратору. Ожидайте подтверждения.",
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	user, err := s.storage.GetUserByUsername(r.Context(), req.Username)
	if err != nil || !auth.CheckPassword(req.Password, user.PasswordHash) {
		s.logActivity(r, nil, req.Username, models.CategoryAuth, "auth_login_failed", "Неудачная попытка входа (неверный пароль или пользователь не найден)")
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid username or password"})
		return
	}

	if !user.IsActive {
		s.logActivity(r, &user.ID, user.Username, models.CategoryAuth, "auth_login_blocked", "Попытка входа в неактивированный аккаунт")
		s.writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "Your account is pending administrator approval. Please contact support/admin.",
		})
		return
	}

	token, err := s.jwtMgr.GenerateToken(user)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
		return
	}

	s.logActivity(r, &user.ID, user.Username, models.CategoryAuth, "auth_login", "Успешная авторизация в системе")

	s.writeJSON(w, http.StatusOK, models.LoginResponse{
		Token: token,
		User:  s.toUserPublic(r.Context(), user),
	})
}

func (s *Server) handleTelegramMiniAppAuth(w http.ResponseWriter, r *http.Request) {
	var req models.TelegramMiniAppAuthRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	botToken := ""
	if s.telegramBot != nil {
		botToken = s.telegramBot.GetToken()
	}
	if botToken == "" {
		botToken = s.cfg.TelegramBotToken
	}
	if botToken == "" {
		s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "Telegram bot is not configured or disabled",
		})
		return
	}

	// 1. Validate initData cryptographically
	webAppData, err := auth.ValidateTelegramWebAppData(req.InitData, botToken, 24*time.Hour)
	if err != nil {
		s.logActivity(r, nil, "telegram_miniapp", models.CategoryAuth, "tg_miniapp_invalid_signature", fmt.Sprintf("Ошибка валидации initData: %v", err))
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "Invalid Telegram signature or expired session",
		})
		return
	}

	if webAppData.User == nil || webAppData.User.ID == 0 {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Telegram user data is missing in initData",
		})
		return
	}

	tgUserID := webAppData.User.ID

	// 2. Check if this Telegram user has linked their chat to an account or is admin
	chat, err := s.storage.GetTelegramChatByChatID(r.Context(), tgUserID)
	if err != nil || chat == nil {
		s.logActivity(r, nil, fmt.Sprintf("tg:%d", tgUserID), models.CategoryAuth, "tg_miniapp_unlinked", "Попытка входа в Mini App с непривязанного Telegram-чата")
		s.writeJSON(w, http.StatusForbidden, map[string]any{
			"error":     "unlinked_chat",
			"message":   "Ваш Telegram-аккаунт еще не подключен к Avari Keys. Подключите аккаунт через команду /link в боте.",
			"is_linked": false,
		})
		return
	}

	var user *models.User
	if chat.UserID != nil {
		u, err := s.storage.GetUserByID(r.Context(), *chat.UserID)
		if err == nil && u != nil {
			user = u
		}
	} else if chat.IsAdmin {
		// Admin chat without explicit user_id binding -> bind to default admin (Forve or first active admin)
		users, _ := s.storage.ListUsers(r.Context())
		for _, u := range users {
			if u.Role == models.RoleAdmin && u.IsActive {
				adminUser, err := s.storage.GetUserByID(r.Context(), u.ID)
				if err == nil && adminUser != nil {
					user = adminUser
					break
				}
			}
		}
	}

	if user == nil {
		s.writeJSON(w, http.StatusForbidden, map[string]any{
			"error":     "user_not_found",
			"message":   "Привязанная учетная запись не найдена в системе.",
			"is_linked": false,
		})
		return
	}

	if !user.IsActive {
		s.logActivity(r, &user.ID, user.Username, models.CategoryAuth, "tg_miniapp_inactive", "Вход в Mini App неактивного пользователя")
		s.writeJSON(w, http.StatusForbidden, map[string]any{
			"error":     "account_inactive",
			"message":   "Ваша учетная запись ожидает одобрения администратором.",
			"is_linked": true,
		})
		return
	}

	token, err := s.jwtMgr.GenerateToken(user)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to generate token"})
		return
	}

	s.logActivity(r, &user.ID, user.Username, models.CategoryAuth, "tg_miniapp_login", "Успешный вход через Telegram Mini App")

	s.writeJSON(w, http.StatusOK, models.TelegramMiniAppAuthResponse{
		Token:    token,
		User:     s.toUserPublic(r.Context(), user),
		IsAdmin:  user.Role == models.RoleAdmin,
		IsLinked: true,
	})
}

func (s *Server) toUserPublic(ctx context.Context, user *models.User) models.UserPublic {
	uPublic := models.UserPublic{
		ID:        user.ID,
		Username:  user.Username,
		Role:      user.Role,
		IsActive:  user.IsActive,
		IsPro:     user.IsPro,
		CreatedAt: user.CreatedAt,
	}
	if mt, err := s.storage.GetUserMonthTraffic(ctx, user.ID, ""); err == nil && mt != nil {
		uPublic.MonthTraffic = mt
		uPublic.MonthTrafficBytes = mt.TotalBytes
		uPublic.MonthTrafficFormatted = mt.Formatted
	}
	return uPublic
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	user, err := s.storage.GetUserByID(r.Context(), claims.UserID)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
		return
	}

	s.writeJSON(w, http.StatusOK, s.toUserPublic(r.Context(), user))
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.UpdateProfileRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	updatedUser, err := s.storage.UpdateUserProfile(r.Context(), claims.UserID, req.Username, req.Password)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	s.logActivity(r, &updatedUser.ID, updatedUser.Username, models.CategoryProfile, "profile_update", "Обновлены учетные данные профиля")

	token, _ := s.jwtMgr.GenerateToken(updatedUser)

	s.writeJSON(w, http.StatusOK, models.LoginResponse{
		Token: token,
		User:  s.toUserPublic(r.Context(), updatedUser),
	})
}
