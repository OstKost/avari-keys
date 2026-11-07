// Package netprobe checks only operator-configured public targets, never request-supplied addresses.
package netprobe

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
	"log"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Target struct {
	NodeID int64  `json:"node_id"`
	IP     string `json:"ip"`
	Domain string `json:"domain"`
	Port   int    `json:"port"`
}

func TargetsFromEnv() []Target {
	raw := os.Getenv("NETWORK_PROBE_TARGETS")
	if raw == "" {
		return nil
	}
	var targets []Target
	if err := json.Unmarshal([]byte(raw), &targets); err != nil {
		log.Printf("[PROBE] invalid NETWORK_PROBE_TARGETS: %v", err)
		return nil
	}
	for _, t := range targets {
		ip := net.ParseIP(t.IP)
		if t.NodeID <= 0 || ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || t.Port < 1 || t.Port > 65535 || t.Domain == "" || strings.ContainsAny(t.Domain, " /:;\\") {
			log.Printf("[PROBE] invalid target configuration for node %d", t.NodeID)
			return nil
		}
	}
	return targets
}
func Run(ctx context.Context, source string, targets []Target) []models.NetworkProbe {
	out := make([]models.NetworkProbe, len(targets))
	var wg sync.WaitGroup
	for i, t := range targets {
		wg.Add(1)
		go func(i int, t Target) { defer wg.Done(); out[i] = Check(ctx, source, t) }(i, t)
	}
	wg.Wait()
	return out
}
func Check(ctx context.Context, source string, t Target) models.NetworkProbe {
	p := models.NetworkProbe{NodeID: t.NodeID, Source: source, StatusDetail: models.StatusDetail{State: "green", CheckedAt: time.Now().UTC()}, Checks: []models.ProbeCheck{}}
	dns := models.ProbeCheck{Kind: "dns", Target: t.Domain}
	dctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	start := time.Now()
	ips, err := net.DefaultResolver.LookupHost(dctx, t.Domain)
	cancel()
	dns.LatencyMs = time.Since(start).Milliseconds()
	dns.OK = err == nil
	if err != nil {
		dns.Error = err.Error()
	} else {
		matches := false
		for _, ip := range ips {
			if net.ParseIP(ip).Equal(net.ParseIP(t.IP)) {
				matches = true
			}
		}
		if !matches {
			dns.OK = false
			dns.Error = "DNS не содержит настроенный публичный IP"
		}
	}
	p.Checks = append(p.Checks, dns)
	for _, host := range []string{t.IP, t.Domain} {
		kind := "ip"
		if host == t.Domain {
			kind = "domain"
		}
		c := models.ProbeCheck{Kind: kind + "_icmp", Target: host}
		cctx, stop := context.WithTimeout(ctx, 3*time.Second)
		start = time.Now()
		output, pingErr := exec.CommandContext(cctx, "ping", "-n", "-c", "1", host).Output()
		err = pingErr
		stop()
		c.OK = err == nil
		c.LatencyMs = time.Since(start).Milliseconds()
		if match := regexp.MustCompile(`time[=<]([0-9.]+)`).FindSubmatch(output); len(match) == 2 {
			if ms, e := strconv.ParseFloat(string(match[1]), 64); e == nil {
				c.LatencyMs = int64(ms)
			}
		}
		if err != nil {
			c.Error = err.Error()
		}
		p.Checks = append(p.Checks, c)
		c = models.ProbeCheck{Kind: kind + "_tcp", Target: net.JoinHostPort(host, strconv.Itoa(t.Port))}
		cctx, stop = context.WithTimeout(ctx, 3*time.Second)
		start = time.Now()
		conn, e := (&net.Dialer{}).DialContext(cctx, "tcp", c.Target)
		stop()
		c.OK = e == nil
		c.LatencyMs = time.Since(start).Milliseconds()
		if conn != nil {
			conn.Close()
		}
		if e != nil {
			c.Error = e.Error()
		}
		p.Checks = append(p.Checks, c)
	}
	anyReachable := false
	for _, c := range p.Checks {
		if !c.OK {
			p.State = "yellow"
		}
		if c.Kind != "dns" && c.OK {
			anyReachable = true
		}
	}
	if !anyReachable {
		p.State = "red"
	}
	if p.State != "green" {
		p.Reason = "Часть проверок публичной сети не проходит; это не доказывает блокировку"
	}
	return p
}

// Collector owns a cached background sample. Call Stop when its server shuts down.
type Collector struct {
	mu      sync.RWMutex
	samples []models.NetworkProbe
	cancel  context.CancelFunc
}

func NewCollector(source string) *Collector {
	c := &Collector{}
	targets := TargetsFromEnv()
	if len(targets) == 0 {
		return c
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	go func() {
		for {
			samples := Run(ctx, source, targets)
			c.mu.Lock()
			c.samples = samples
			c.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-time.After(60 * time.Second):
			}
		}
	}()
	return c
}
func (c *Collector) Samples() []models.NetworkProbe {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return append([]models.NetworkProbe{}, c.samples...)
}
func (c *Collector) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
}
func Aggregate(probes []models.NetworkProbe, now time.Time) models.StatusDetail {
	s := models.StatusDetail{State: "unknown", Reason: "Нет результатов фоновых проверок сети"}
	if len(probes) == 0 {
		return s
	}
	s.State = "green"
	s.Reason = ""
	allRed := true
	stale := false
	for _, p := range probes {
		if p.CheckedAt.After(s.CheckedAt) {
			s.CheckedAt = p.CheckedAt
		}
		if p.State != "red" {
			allRed = false
		}
		if now.Sub(p.CheckedAt) > 3*time.Minute {
			stale = true
		}
		if p.State != "green" || now.Sub(p.CheckedAt) > 3*time.Minute {
			s.State = "yellow"
		}
	}
	if allRed {
		s.State = "red"
	}
	// An outage at a probe source must not turn an old success into a fresh green.
	if stale {
		s.State = "yellow"
		s.Reason = "Результаты сетевых проверок устарели"
	} else if s.State != "green" {
		s.Reason = fmt.Sprintf("Есть ошибки или расхождения между источниками проверок (%d)", len(probes))
	}
	return s
}
