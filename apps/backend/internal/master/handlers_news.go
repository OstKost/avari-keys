package master

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/auth"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

func (s *Server) handleListNews(w http.ResponseWriter, r *http.Request) {
	news, err := s.storage.ListNews(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Ошибка получения списка новостей"})
		return
	}
	s.writeJSON(w, http.StatusOK, news)
}

func (s *Server) handleAdminCreateNews(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	var req models.CreateNewsRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	req.Title = strings.TrimSpace(req.Title)
	req.Content = strings.TrimSpace(req.Content)
	if req.Title == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Заголовок новости не может быть пустым"})
		return
	}
	if req.Content == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Текст новости не может быть пустым"})
		return
	}

	if req.Category == "" {
		req.Category = models.NewsCategoryGeneral
	}

	item := &models.NewsItem{
		Title:          req.Title,
		Content:        req.Content,
		Category:       req.Category,
		IsPinned:       req.IsPinned,
		AuthorName:     claims.Username,
		NotifyTelegram: req.NotifyTelegram,
	}

	created, err := s.storage.CreateNews(r.Context(), item)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Ошибка сохранения новости: %v", err)})
		return
	}

	// If notify_telegram is enabled, broadcast via Telegram Bot to subscribers
	if req.NotifyTelegram && s.telegramBot != nil && s.telegramBot.IsEnabled() {
		go func(ni models.NewsItem) {
			if err := s.telegramBot.BroadcastNews(ni); err != nil {
				log.Printf("[MASTER NEWS] Telegram broadcast error: %v", err)
			}
		}(*created)
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_news_create", fmt.Sprintf("Опубликована новость «%s» (ID #%d, TG: %v)", created.Title, created.ID, req.NotifyTelegram))

	s.writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleAdminUpdateNews(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Некорректный ID новости"})
		return
	}

	var req models.UpdateNewsRequest
	if !s.decodeJSON(w, r, &req) {
		return
	}

	req.Title = strings.TrimSpace(req.Title)
	req.Content = strings.TrimSpace(req.Content)
	if req.Title == "" || req.Content == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Заголовок и текст не могут быть пустыми"})
		return
	}

	if req.Category == "" {
		req.Category = models.NewsCategoryGeneral
	}

	updated, err := s.storage.UpdateNews(r.Context(), id, req)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Ошибка обновления новости: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_news_update", fmt.Sprintf("Отредактирована новость «%s» (ID #%d)", updated.Title, updated.ID))

	s.writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleAdminDeleteNews(w http.ResponseWriter, r *http.Request) {
	claims, _ := auth.GetUserFromContext(r.Context())
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Некорректный ID новости"})
		return
	}

	existing, _ := s.storage.GetNewsByID(r.Context(), id)
	title := ""
	if existing != nil {
		title = existing.Title
	}

	if err := s.storage.DeleteNews(r.Context(), id); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Ошибка удаления новости: %v", err)})
		return
	}

	s.logActivity(r, &claims.UserID, claims.Username, models.CategoryAdmin, "admin_news_delete", fmt.Sprintf("Удалена новость «%s» (ID #%d)", title, id))

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Новость успешно удалена",
	})
}
