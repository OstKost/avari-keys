package slave

import (
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/runner"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNetworkProbesAreAuthenticatedCachedAndConfiguredOnly(t *testing.T) {
	t.Setenv("NETWORK_PROBE_TARGETS", "")
	t.Setenv("HYSTERIA_ENABLED", "false")
	s := NewServer(Config{APIKey: "test-key"}, runner.NewMockRunner(true))
	for _, tc := range []struct {
		key  string
		want int
	}{{"", http.StatusUnauthorized}, {"wrong", http.StatusUnauthorized}, {"test-key", http.StatusOK}} {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/network/probes?target=127.0.0.1", nil)
		r.Header.Set("X-API-Key", tc.key)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("got %d want %d", w.Code, tc.want)
		}
		if w.Code == http.StatusOK && strings.TrimSpace(w.Body.String()) != "[]" {
			t.Fatalf("expected no probes without operator config, got %s", w.Body.String())
		}
	}
}
