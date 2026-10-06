package slave

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/hysteria"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/runner"
)

// Config holds configuration for the Slave API server.
type Config struct {
	APIKey        string
	Port          string
	HysteriaStore *hysteria.Store
}

// Server is the HTTP server for Slave API.
type Server struct {
	cfg      Config
	runner   runner.AWGRunner
	hysteria *hysteria.Store
	mux      *http.ServeMux
}

// NewServer creates a new Slave API server instance.
func NewServer(cfg Config, r runner.AWGRunner) *Server {
	if cfg.APIKey == "" {
		bytes := make([]byte, 24)
		_, _ = rand.Read(bytes)
		cfg.APIKey = hex.EncodeToString(bytes)
		log.Printf("\n======================================================\n[SLAVE API] Generated API Key: %s\n======================================================\n", cfg.APIKey)
	}

	hyStore := cfg.HysteriaStore
	if hyStore == nil {
		var err error
		hyStore, err = hysteria.NewStore("/opt/avari-keys/hysteria_users.json", "s2.avari.dev", 443)
		if err != nil {
			log.Printf("[SLAVE] Warning: failed to init hysteria store: %v", err)
		}
	}

	s := &Server{
		cfg:      cfg,
		runner:   r,
		hysteria: hyStore,
		mux:      http.NewServeMux(),
	}
	s.routes()
	return s
}

// APIKey returns the configured API key (useful for tests and bootstrap logging).
func (s *Server) APIKey() string {
	return s.cfg.APIKey
}

// Handler returns the underlying http.Handler.
func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	// 1. Decoy Root Page (neutral status page)
	s.mux.HandleFunc("GET /{$}", s.handleDecoy)

	// 2. Public Health Check
	s.mux.HandleFunc("GET /health", s.handleHealth)

	// 3. Hysteria 2 HTTP Auth Hook (called locally by Hysteria server daemon)
	s.mux.HandleFunc("POST /api/v1/hysteria/auth", s.handleHysteriaAuth)

	// 4. Protected API Routes
	s.mux.Handle("POST /api/v1/clients", s.authMiddleware(http.HandlerFunc(s.handleCreateClient)))
	s.mux.Handle("GET /api/v1/clients", s.authMiddleware(http.HandlerFunc(s.handleListClients)))
	s.mux.Handle("GET /api/v1/clients/{name}", s.authMiddleware(http.HandlerFunc(s.handleGetClient)))
	s.mux.Handle("DELETE /api/v1/clients/{name}", s.authMiddleware(http.HandlerFunc(s.handleDeleteClient)))
	s.mux.Handle("GET /api/v1/stats", s.authMiddleware(http.HandlerFunc(s.handleStats)))
	s.mux.Handle("POST /api/v1/restart", s.authMiddleware(http.HandlerFunc(s.handleRestart)))
	s.mux.Handle("GET /api/v1/backup", s.authMiddleware(http.HandlerFunc(s.handleBackup)))
	s.mux.Handle("POST /api/v1/restore", s.authMiddleware(http.HandlerFunc(s.handleRestore)))
	s.mux.Handle("GET /api/v1/cascade/egress", s.authMiddleware(http.HandlerFunc(s.handleGetCascadeEgress)))
	s.mux.Handle("POST /api/v1/cascade/egress", s.authMiddleware(http.HandlerFunc(s.handleSwitchCascadeEgress)))
}


func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiKey := r.Header.Get("X-API-Key")
		if apiKey == "" {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				apiKey = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}

		if apiKey == "" || apiKey != s.cfg.APIKey {
			s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized: invalid or missing API key"})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleDecoy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Server Status</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #94a3b8; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 2rem 3rem; border-radius: 12px; border: 1px solid #334155; text-align: center; }
        h1 { color: #f8fafc; font-size: 1.5rem; margin-bottom: 0.5rem; }
        p { margin: 0; font-size: 0.95rem; }
        .badge { display: inline-block; background: #065f46; color: #34d399; font-weight: 600; font-size: 0.75rem; padding: 0.25rem 0.75rem; border-radius: 9999px; margin-top: 1rem; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Node Gateway</h1>
        <p>Host status: Normal operating parameters.</p>
        <span class="badge">ONLINE</span>
    </div>
</body>
</html>`))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	healthy := s.runner.CheckHealth(r.Context())
	s.writeJSON(w, http.StatusOK, models.HealthResponse{
		Status:       "ok",
		Service:      "avari-slave",
		AWGAvailable: healthy,
		Version:      "v0.4.4",
	})
}

func (s *Server) handleHysteriaAuth(w http.ResponseWriter, r *http.Request) {
	if s.hysteria == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Auth string `json:"auth"`
		Addr string `json:"addr"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	ok, id := s.hysteria.Authenticate(req.Auth)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"id": id,
	})
}

func (s *Server) handleCreateClient(w http.ResponseWriter, r *http.Request) {
	var req models.ClientCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "client name is required"})
		return
	}

	if req.Protocol == "hysteria2" {
		if s.hysteria == nil {
			s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Hysteria service not available on this node"})
			return
		}
		res, err := s.hysteria.AddUser(r.Context(), req.Name)
		if err != nil {
			s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		s.writeJSON(w, http.StatusCreated, res)
		return
	}

	res, err := s.runner.AddClient(r.Context(), req.Name, req.PSK)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusCreated, res)
}

func (s *Server) handleListClients(w http.ResponseWriter, r *http.Request) {
	clients, err := s.runner.ListClients(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if s.hysteria != nil {
		hList, err := s.hysteria.ListUsers(r.Context())
		if err == nil {
			clients = append(clients, hList...)
		}
	}
	s.writeJSON(w, http.StatusOK, clients)
}

func (s *Server) handleGetClient(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "client name required"})
		return
	}

	res, err := s.runner.GetClient(r.Context(), name)
	if err != nil && s.hysteria != nil {
		// Try Hysteria store
		if hRes, hErr := s.hysteria.GetUser(r.Context(), name); hErr == nil {
			s.writeJSON(w, http.StatusOK, hRes)
			return
		}
	}
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleDeleteClient(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "client name required"})
		return
	}

	if s.hysteria != nil {
		_ = s.hysteria.RemoveUser(r.Context(), name)
	}

	if err := s.runner.RemoveClient(r.Context(), name); err != nil {
		// If it was a hysteria user, removing from AWG runner might fail harmlessly
		if s.hysteria != nil {
			s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
				Success: true,
				Message: "Client successfully removed",
			})
			return
		}
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "Client successfully removed",
	})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.runner.GetStats(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	if err := s.runner.RestartAWG(r.Context()); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "AmneziaWG service successfully restarted",
	})
}

func (s *Server) handleBackup(w http.ResponseWriter, r *http.Request) {
	backup, err := s.runner.BackupAWG(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, backup)
}

func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	var req models.RestoreNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if req.BackupData == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "backup_data is required"})
		return
	}

	if err := s.runner.RestoreAWG(r.Context(), req.BackupData); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: "AmneziaWG configuration successfully restored",
	})
}

func (s *Server) handleGetCascadeEgress(w http.ResponseWriter, r *http.Request) {
	status, err := s.runner.GetEgressStatus(r.Context())
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleSwitchCascadeEgress(w http.ResponseWriter, r *http.Request) {
	var req models.SwitchEgressRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if req.Interface == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "interface is required (e.g. 'awg1' or 'awg3')"})
		return
	}

	if err := s.runner.SwitchEgress(r.Context(), req.Interface); err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, models.GenericSuccessResponse{
		Success: true,
		Message: fmt.Sprintf("Cascade egress successfully switched to %s", req.Interface),
	})
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

