package netprobe

import (
	"context"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestTargetsRejectInvalidConfiguration(t *testing.T) {
	for _, raw := range []string{`not-json`, `[{"node_id":1,"ip":"127.0.0.1","domain":"vpn.example.test","port":443}]`, `[{"node_id":1,"ip":"192.0.2.1","domain":"-bad;cmd","port":443}]`, `[{"node_id":1,"ip":"192.0.2.1","domain":"vpn.example.test","port":0}]`} {
		t.Setenv("NETWORK_PROBE_TARGETS", raw)
		if got := TargetsFromEnv(); len(got) != 0 {
			t.Fatalf("accepted invalid configuration: %s", raw)
		}
	}
	t.Setenv("NETWORK_PROBE_TARGETS", `[{"node_id":1,"ip":"192.0.2.1","domain":"vpn.example.test","port":443}]`)
	if got := TargetsFromEnv(); len(got) != 1 || got[0].NodeID != 1 {
		t.Fatalf("valid target rejected: %+v", got)
	}
}
func TestAggregateSourcesAndStaleness(t *testing.T) {
	now := time.Now().UTC()
	sample := func(state string, age time.Duration) models.NetworkProbe {
		return models.NetworkProbe{StatusDetail: models.StatusDetail{State: state, CheckedAt: now.Add(-age)}}
	}
	for _, tc := range []struct {
		name   string
		probes []models.NetworkProbe
		want   string
	}{
		{"no samples", nil, "unknown"},
		{"both working", []models.NetworkProbe{sample("green", 0), sample("green", 0)}, "green"},
		{"source disagreement", []models.NetworkProbe{sample("green", 0), sample("red", 0)}, "yellow"},
		{"both unreachable", []models.NetworkProbe{sample("red", 0), sample("red", 0)}, "red"},
		{"source unavailable", []models.NetworkProbe{sample("red", 0), sample("unknown", 0)}, "yellow"},
		{"one source stale", []models.NetworkProbe{sample("red", 0), sample("red", 5*time.Minute)}, "yellow"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := Aggregate(tc.probes, now); got.State != tc.want {
				t.Fatalf("got %+v want %s", got, tc.want)
			}
		})
	}
}
func TestCheckIncludesIPAndDomainAndDetectsDNSMismatch(t *testing.T) {
	t.Setenv("NETWORK_PROBE_INTERFACE", "")
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	_, port, _ := net.SplitHostPort(l.Addr().String())
	p, _ := strconv.Atoi(port)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	result := Check(ctx, "test", Target{NodeID: 1, IP: "127.0.0.1", Domain: "localhost", Port: p})
	if len(result.Checks) != 5 || result.Source != "test" || result.CheckedAt.IsZero() {
		t.Fatalf("missing sample details: %+v", result)
	}
	for _, c := range result.Checks {
		if c.Kind == "ip_tcp" && !c.OK {
			t.Fatalf("IP TCP failed: %+v", c)
		}
	}
	// A DNS mismatch must degrade the result even when TCP and ICMP work.
	mismatch := Check(ctx, "test", Target{NodeID: 1, IP: "127.0.0.2", Domain: "localhost", Port: p})
	if mismatch.State != "yellow" || mismatch.Checks[0].OK {
		t.Fatalf("DNS mismatch was not reported: %+v", mismatch)
	}
}

func TestInterfaceConfigurationNeverFallsBack(t *testing.T) {
	t.Setenv("NETWORK_PROBE_INTERFACE", "missing-probe-device")
	result := Check(context.Background(), "test", Target{NodeID: 1, IP: "192.0.2.1", Domain: "vpn.example.test", Port: 443})
	if result.Interface != "missing-probe-device" || result.State != "unknown" || result.Reason == "" || len(result.Checks) != 0 {
		t.Fatalf("invalid interface must report source failure, never run unbound probes: %+v", result)
	}
}
func TestPingArgumentsBindConfiguredInterface(t *testing.T) {
	for _, tc := range []struct {
		iface string
		want  string
	}{{"", "-n -c 1 vpn.example.test"}, {"physical-test", "-n -c 1 -I physical-test vpn.example.test"}} {
		if got := strings.Join(pingArguments(tc.iface, "vpn.example.test"), " "); got != tc.want {
			t.Fatalf("got %q want %q", got, tc.want)
		}
	}
}
func TestUnconfiguredInterfaceUsesDefaultDialer(t *testing.T) {
	dialer, err := interfaceDialer("")
	if err != nil || dialer == nil || dialer.Control != nil {
		t.Fatalf("unconfigured interface should retain platform default dialer: %+v %v", dialer, err)
	}
}
