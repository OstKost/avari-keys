package egress

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/models"
)

// HTTPProber executes HTTP checks bound to a network interface.
type HTTPProber interface {
	FetchIP(ctx context.Context, iface string, url string) (string, int, error)
	FetchStatus(ctx context.Context, iface string, url string) (int, error)
}

// InterfaceChecker is an optional interface that a prober can implement to verify interface presence.
type InterfaceChecker interface {
	CheckInterface(iface string) error
}

// DefaultHTTPProber uses curl (standard on nodes) or pure Go fallback.
type DefaultHTTPProber struct {
	DoHURL string
}

// CheckInterface verifies interface existence in sysfs on Linux.
func (p *DefaultHTTPProber) CheckInterface(iface string) error {
	if iface == "" {
		return nil
	}
	sysPath := filepath.Join("/sys/class/net", iface)
	if _, err := os.Stat("/sys/class/net"); err == nil {
		if _, err := os.Stat(sysPath); err != nil {
			return fmt.Errorf("туннель %s не запущен: %w", iface, err)
		}
	}
	return nil
}

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

var ipv4Regex = regexp.MustCompile(`\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b`)

// ParseIPv4FromBody extracts an IPv4 address from either plain-text, JSON, or mixed text.
func ParseIPv4FromBody(body string) string {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return ""
	}

	// 1. Direct IPv4
	if ip := net.ParseIP(trimmed); ip != nil && ip.To4() != nil {
		return ip.String()
	}

	// 2. JSON: {"ip": "1.2.3.4", ...} (e.g. from api.myip.com)
	var jsonPayload struct {
		IP string `json:"ip"`
	}
	if err := json.Unmarshal([]byte(trimmed), &jsonPayload); err == nil && jsonPayload.IP != "" {
		if ip := net.ParseIP(strings.TrimSpace(jsonPayload.IP)); ip != nil && ip.To4() != nil {
			return ip.String()
		}
	}

	// 3. Fallback regex to find first valid IPv4
	if match := ipv4Regex.FindString(trimmed); match != "" {
		if ip := net.ParseIP(match); ip != nil && ip.To4() != nil {
			return ip.String()
		}
	}

	return ""
}

func (p *DefaultHTTPProber) runCurlFetchIP(ctx context.Context, iface, targetURL, dohURL string) (string, int, error) {
	args := []string{
		"-4",
		"--silent",
		"--show-error",
		"--noproxy", "*",
		"-A", userAgent,
		"--connect-timeout", "3",
		"--max-time", "6",
	}
	if iface != "" {
		args = append(args, "--interface", iface)
	}
	if dohURL != "" {
		args = append(args, "--doh-url", dohURL)
	}
	args = append(args, "-w", "\n%{http_code}", targetURL)

	cmd := exec.CommandContext(ctx, "curl", args...)
	out, err := cmd.Output()
	if err != nil {
		return "", 0, fmt.Errorf("curl failed: %w", err)
	}

	lines := strings.Split(strings.TrimRight(string(out), "\r\n"), "\n")
	if len(lines) == 0 {
		return "", 0, fmt.Errorf("empty response from curl")
	}

	codeStr := strings.TrimSpace(lines[len(lines)-1])
	code, err := strconv.Atoi(codeStr)
	if err != nil {
		return "", 0, fmt.Errorf("invalid http status code %q", codeStr)
	}

	body := strings.TrimSpace(strings.Join(lines[:len(lines)-1], "\n"))
	return body, code, nil
}

// FetchIP queries the IP provider (e.g. api.ipify.org, icanhazip.com, ipinfo.io, api.myip.com) and returns body and status code.
func (p *DefaultHTTPProber) FetchIP(ctx context.Context, iface string, targetURL string) (string, int, error) {
	if _, err := exec.LookPath("curl"); err == nil {
		if p.DoHURL != "" {
			body, code, err := p.runCurlFetchIP(ctx, iface, targetURL, p.DoHURL)
			if err == nil && code >= 200 && code < 400 {
				return body, code, nil
			}
		}
		return p.runCurlFetchIP(ctx, iface, targetURL, "")
	}

	// Fallback to pure Go HTTP client
	client := &http.Client{
		Timeout: 6 * time.Second,
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1024))
	if err != nil {
		return "", resp.StatusCode, err
	}
	return strings.TrimSpace(string(bodyBytes)), resp.StatusCode, nil
}

func (p *DefaultHTTPProber) runCurlFetchStatus(ctx context.Context, iface, targetURL, dohURL string) (int, error) {
	args := []string{
		"-4",
		"--silent",
		"--show-error",
		"--noproxy", "*",
		"-A", userAgent,
		"-o", "/dev/null",
		"--connect-timeout", "3",
		"--max-time", "6",
	}
	if iface != "" {
		args = append(args, "--interface", iface)
	}
	if dohURL != "" {
		args = append(args, "--doh-url", dohURL)
	}
	args = append(args, "-w", "%{http_code}", targetURL)

	cmd := exec.CommandContext(ctx, "curl", args...)
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("curl failed: %w", err)
	}

	codeStr := strings.TrimSpace(string(out))
	code, err := strconv.Atoi(codeStr)
	if err != nil {
		return 0, fmt.Errorf("invalid status code %q", codeStr)
	}
	return code, nil
}

// FetchStatus queries the target URL discarding body, returning only HTTP status code.
func (p *DefaultHTTPProber) FetchStatus(ctx context.Context, iface string, targetURL string) (int, error) {
	if _, err := exec.LookPath("curl"); err == nil {
		if p.DoHURL != "" {
			code, err := p.runCurlFetchStatus(ctx, iface, targetURL, p.DoHURL)
			if err == nil {
				return code, nil
			}
		}
		return p.runCurlFetchStatus(ctx, iface, targetURL, "")
	}

	// Fallback to pure Go HTTP client (don't follow redirects so 302 from telegram is captured directly)
	client := &http.Client{
		Timeout: 6 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

// ProbeReport contains the aggregate and detailed outcome of an egress target probe.
type ProbeReport struct {
	Available    bool                       `json:"available"`
	PassedChecks int                        `json:"passed_checks"`
	TotalChecks  int                        `json:"total_checks"`
	Checks       []models.TargetProbeResult `json:"checks"`
	Reason       string                     `json:"reason,omitempty"`
	Err          error                      `json:"-"`
}

// ProbeTarget performs multi-service health verification and returns error if unavailable.
func ProbeTarget(ctx context.Context, cfg Config, target TargetConfig, prober HTTPProber) error {
	rep := RunTargetProbe(ctx, cfg, target, prober)
	return rep.Err
}

// RunTargetProbe performs comprehensive multi-service health verification of an egress target.
// 5 services are probed concurrently:
// 1. IP check via api.ipify.org (Safety Gate: must match target.Endpoint).
// 2. Telegram check (api.telegram.org).
// 3. ChatGPT check (chatgpt.com, no 403 block).
// 4. Grok check (grok.com, no 403 block).
// 5. Meta check (instagram.com, no 403 block).
//
// The target is considered available if IP matches AND at least 3 out of 5 checks pass.
func RunTargetProbe(ctx context.Context, cfg Config, target TargetConfig, prober HTTPProber) ProbeReport {
	// 1. Sysfs interface check if prober implements InterfaceChecker
	if checker, ok := prober.(InterfaceChecker); ok {
		if err := checker.CheckInterface(target.Interface); err != nil {
			errStr := err.Error()
			return ProbeReport{
				Available:   false,
				TotalChecks: 5,
				Reason:      errStr,
				Err:         errors.New(errStr),
			}
		}
	}

	checks := make([]models.TargetProbeResult, 5)
	var wg sync.WaitGroup

	// 1. IP verification via Multi-Provider Pool (Safety Gate)
	wg.Add(1)
	go func() {
		defer wg.Done()
		providers := cfg.IPProviders
		if len(providers) == 0 {
			if cfg.IpifyURL != "" {
				providers = []string{cfg.IpifyURL}
			} else {
				providers = []string{
					"https://api.ipify.org",
					"https://icanhazip.com",
					"https://ipinfo.io/ip",
					"https://api.myip.com",
				}
			}
		}

		res := models.TargetProbeResult{Name: "ip", Target: providers[0]}
		var lastErr error
		var lastStatusCode int
		var detectedIP string
		ipMatched := false

		for _, providerURL := range providers {
			ipCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
			rawBody, statusCode, err := prober.FetchIP(ipCtx, target.Interface, providerURL)
			cancel()

			lastStatusCode = statusCode
			if err != nil {
				lastErr = err
				continue
			}
			if statusCode < 200 || statusCode >= 400 {
				lastErr = fmt.Errorf("HTTP %d", statusCode)
				continue
			}

			parsedIP := ParseIPv4FromBody(rawBody)
			if parsedIP == "" {
				parsedIP = strings.TrimSpace(rawBody)
			}
			detectedIP = parsedIP
			res.Target = providerURL
			res.Status = statusCode

			if parsedIP == target.Endpoint {
				ipMatched = true
				res.OK = true
				break
			} else {
				lastErr = fmt.Errorf("внешний IP (%s) != ожидаемому (%s)", parsedIP, target.Endpoint)
			}
		}

		if !ipMatched {
			if detectedIP != "" {
				res.Error = fmt.Sprintf("внешний IP (%s) != ожидаемому (%s) через %s", detectedIP, target.Endpoint, res.Target)
			} else if lastErr != nil {
				res.Error = fmt.Sprintf("все IP-провайдеры (%d) недоступны: %v", len(providers), lastErr)
			} else {
				res.Error = "не удалось определить внешний IP"
			}
			res.Status = lastStatusCode
		}

		checks[0] = res
	}()

	// 2. Telegram verification (api.telegram.org)
	wg.Add(1)
	go func() {
		defer wg.Done()
		res := models.TargetProbeResult{Name: "telegram", Target: cfg.TelegramURL}
		tgCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
		defer cancel()
		tgStatus, err := prober.FetchStatus(tgCtx, target.Interface, cfg.TelegramURL)
		res.Status = tgStatus
		if err != nil {
			res.Error = fmt.Sprintf("telegram недоступен: %v", err)
		} else if tgStatus >= 400 {
			res.Error = fmt.Sprintf("telegram вернул ошибку HTTP %d", tgStatus)
		} else {
			res.OK = true
		}
		checks[1] = res
	}()

	// 3. ChatGPT verification (chatgpt.com)
	wg.Add(1)
	go func() {
		defer wg.Done()
		res := models.TargetProbeResult{Name: "chatgpt", Target: cfg.ChatGPTURL}
		gptCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
		defer cancel()
		gptStatus, err := prober.FetchStatus(gptCtx, target.Interface, cfg.ChatGPTURL)
		res.Status = gptStatus
		if err != nil {
			res.Error = fmt.Sprintf("chatgpt недоступен: %v", err)
		} else if gptStatus == 403 {
			res.Error = "chatgpt заблокирован (HTTP 403 Forbidden)"
		} else if gptStatus >= 500 {
			res.Error = fmt.Sprintf("chatgpt вернул серверную ошибку HTTP %d", gptStatus)
		} else {
			res.OK = true
		}
		checks[2] = res
	}()

	// 4. Grok verification (grok.com)
	wg.Add(1)
	go func() {
		defer wg.Done()
		res := models.TargetProbeResult{Name: "grok", Target: cfg.GrokURL}
		grokCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
		defer cancel()
		grokStatus, err := prober.FetchStatus(grokCtx, target.Interface, cfg.GrokURL)
		res.Status = grokStatus
		if err != nil {
			res.Error = fmt.Sprintf("grok недоступен: %v", err)
		} else if grokStatus == 403 {
			res.Error = "grok заблокирован (HTTP 403 Forbidden)"
		} else if grokStatus >= 500 {
			res.Error = fmt.Sprintf("grok вернул серверную ошибку HTTP %d", grokStatus)
		} else {
			res.OK = true
		}
		checks[3] = res
	}()

	// 5. Meta verification (instagram.com)
	wg.Add(1)
	go func() {
		defer wg.Done()
		res := models.TargetProbeResult{Name: "meta", Target: cfg.MetaURL}
		metaCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
		defer cancel()
		metaStatus, err := prober.FetchStatus(metaCtx, target.Interface, cfg.MetaURL)
		res.Status = metaStatus
		if err != nil {
			res.Error = fmt.Sprintf("meta недоступен: %v", err)
		} else if metaStatus == 403 {
			res.Error = "meta заблокирован (HTTP 403 Forbidden)"
		} else if metaStatus >= 500 {
			res.Error = fmt.Sprintf("meta вернул серверную ошибку HTTP %d", metaStatus)
		} else {
			res.OK = true
		}
		checks[4] = res
	}()

	wg.Wait()

	passed := 0
	var failures []string
	for _, c := range checks {
		if c.OK {
			passed++
		} else {
			failures = append(failures, c.Error)
		}
	}

	ipGatePassed := checks[0].OK
	// Safety Gate: IP must match target.Endpoint to guarantee no leakage outside the tunnel.
	// Quorum: overall passed checks must be at least 3 out of 5.
	available := ipGatePassed && (passed >= 3)

	var reason string
	var returnErr error
	if !available {
		if !ipGatePassed {
			reason = fmt.Sprintf("утечка или несовпадение IP (%s); пройдено только %d/5 проверок", checks[0].Error, passed)
		} else {
			reason = fmt.Sprintf("пройдено только %d/5 проверок (сбои: %s)", passed, strings.Join(failures, "; "))
		}
		returnErr = errors.New(reason)
	}

	return ProbeReport{
		Available:    available,
		PassedChecks: passed,
		TotalChecks:  5,
		Checks:       checks,
		Reason:       reason,
		Err:          returnErr,
	}
}
