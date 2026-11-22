package mieru

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMieruStoreBasicCRUD(t *testing.T) {
	tmpDir := t.TempDir()
	usersFile := filepath.Join(tmpDir, "mieru_users.json")

	cfg := Config{
		FilePath:       usersFile,
		MitaConfigPath: filepath.Join(tmpDir, "server_config.json"),
		Server:         "s2.example.net",
		Port:           28443,
		Transport:      "TCP",
	}

	st, err := NewStore(cfg)
	if err != nil {
		t.Fatalf("failed to create mieru store: %v", err)
	}

	ctx := context.Background()

	// 1. Add user
	resp, err := st.AddUser(ctx, "u1_test_device")
	if err != nil {
		t.Fatalf("failed to add user: %v", err)
	}

	if resp.Protocol != "mieru" {
		t.Fatalf("expected protocol 'mieru', got %q", resp.Protocol)
	}
	if !strings.HasPrefix(resp.VPNURI, "mierus://u1_test_device:") {
		t.Fatalf("unexpected VPNURI: %q", resp.VPNURI)
	}
	if !strings.Contains(resp.VPNURI, "@s2.example.net:28443") {
		t.Fatalf("VPNURI missing server/port: %q", resp.VPNURI)
	}

	var prof map[string]any
	if err := json.Unmarshal([]byte(resp.Config), &prof); err != nil {
		t.Fatalf("invalid json config: %v", err)
	}
	if prof["protocol_type"] != "mieru" || prof["server"] != "s2.example.net" || prof["server_port"] != float64(28443) {
		t.Fatalf("unexpected profile contents: %+v", prof)
	}

	// 2. Get user
	getResp, err := st.GetUser(ctx, "u1_test_device")
	if err != nil {
		t.Fatalf("failed to get user: %v", err)
	}
	if getResp.VPNURI != resp.VPNURI {
		t.Fatalf("expected matching VPNURI, got %q vs %q", getResp.VPNURI, resp.VPNURI)
	}

	// 3. List users
	list, err := st.ListUsers(ctx)
	if err != nil {
		t.Fatalf("failed to list users: %v", err)
	}
	if len(list) != 1 || list[0].Name != "u1_test_device" {
		t.Fatalf("unexpected users list: %+v", list)
	}

	// 4. Persistence test (reload from disk)
	st2, err := NewStore(cfg)
	if err != nil {
		t.Fatalf("failed to re-open store: %v", err)
	}
	getResp2, err := st2.GetUser(ctx, "u1_test_device")
	if err != nil {
		t.Fatalf("failed to get user after reload: %v", err)
	}
	if getResp2.VPNURI != resp.VPNURI {
		t.Fatalf("persisted VPNURI mismatch: %q vs %q", getResp2.VPNURI, resp.VPNURI)
	}

	// 5. Remove user
	if err := st2.RemoveUser(ctx, "u1_test_device"); err != nil {
		t.Fatalf("failed to remove user: %v", err)
	}
	if _, err := st2.GetUser(ctx, "u1_test_device"); err == nil {
		t.Fatalf("expected error getting deleted user")
	}
}

func TestMieruStoreAdminAPISync(t *testing.T) {
	tmpDir := t.TempDir()
	tokenFile := filepath.Join(tmpDir, "token")
	_ = os.WriteFile(tokenFile, []byte("test-admin-secret-token"), 0600)

	var addedUser, deletedUser string
	var authHeader string

	mockAdmin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if r.Method == http.MethodGet && r.URL.Path == "/status" {
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"mita": map[string]any{"proxy_running": true},
			})
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/users" {
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			addedUser = body["name"]
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
			return
		}
		if r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/users/") {
			deletedUser = strings.TrimPrefix(r.URL.Path, "/users/")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer mockAdmin.Close()

	cfg := Config{
		FilePath:       filepath.Join(tmpDir, "mieru_users.json"),
		AdminURL:       mockAdmin.URL,
		AdminTokenPath: tokenFile,
		Server:         "s3.example.net",
		Port:           28443,
	}

	st, err := NewStore(cfg)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	if !st.CheckServiceRunning() {
		t.Fatalf("expected CheckServiceRunning to return true with mock admin")
	}

	ctx := context.Background()
	_, err = st.AddUser(ctx, "u2_macbook")
	if err != nil {
		t.Fatalf("AddUser failed: %v", err)
	}
	if addedUser != "u2_macbook" {
		t.Fatalf("expected admin API to receive user 'u2_macbook', got %q", addedUser)
	}
	if authHeader != "Bearer test-admin-secret-token" {
		t.Fatalf("expected Bearer token, got %q", authHeader)
	}

	err = st.RemoveUser(ctx, "u2_macbook")
	if err != nil {
		t.Fatalf("RemoveUser failed: %v", err)
	}
	if deletedUser != "u2_macbook" {
		t.Fatalf("expected admin API to receive delete for 'u2_macbook', got %q", deletedUser)
	}
}
