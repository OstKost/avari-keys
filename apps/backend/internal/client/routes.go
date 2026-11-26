package client

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/netprobe"
)

type slaveRoute struct {
	Interface       string `json:"interface"`
	BackupURL       string `json:"backup_url"`
	BackupInterface string `json:"backup_interface"`
}

type routes map[string]configuredRoute
type configuredRoute struct {
	primary   *http.Client
	backupURL string
	backup    *http.Client
}

var configuredRoutes atomic.Pointer[routes]

// ConfigureSlaveRoutes loads operator-owned routes indexed by the primary API URL.
func ConfigureSlaveRoutes(raw string) error {
	settings := map[string]slaveRoute{}
	if raw != "" && json.Unmarshal([]byte(raw), &settings) != nil {
		return fmt.Errorf("SLAVE_ROUTES_JSON must be a JSON object")
	}
	next := make(routes, len(settings))
	for primary, route := range settings {
		primary = strings.TrimRight(primary, "/")
		backup := strings.TrimRight(route.BackupURL, "/")
		if !validRouteURL(primary, false) || (backup != "" && (!validRouteURL(backup, true) || backup == primary)) || (backup == "" && route.BackupInterface != "") {
			return fmt.Errorf("invalid primary or backup in SLAVE_ROUTES_JSON")
		}
		if _, exists := next[primary]; exists {
			return fmt.Errorf("duplicate primary in SLAVE_ROUTES_JSON")
		}
		mainClient, err := boundClient(route.Interface)
		if err != nil {
			return err
		}
		backupClient, err := boundClient(route.BackupInterface)
		if err != nil {
			return err
		}
		next[primary] = configuredRoute{primary: mainClient, backupURL: backup, backup: backupClient}
	}
	configuredRoutes.Store(&next)
	return nil
}

func validRouteURL(raw string, httpsOnly bool) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" &&
		(u.Scheme == "https" || (!httpsOnly && u.Scheme == "http"))
}

func boundClient(iface string) (*http.Client, error) {
	if iface == "" {
		return sharedHTTPClient, nil
	}
	dialer, err := netprobe.InterfaceDialer(iface)
	if err != nil {
		return nil, err
	}
	transport := defaultTransport.Clone()
	transport.DialContext = dialer.DialContext
	return &http.Client{Timeout: sharedHTTPClient.Timeout, Transport: transport, CheckRedirect: rejectRedirect}, nil
}

func rejectRedirect(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse
}
