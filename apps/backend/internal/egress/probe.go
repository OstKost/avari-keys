package egress

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HTTPProber executes HTTP checks bound to a network interface.
type HTTPProber interface {
	FetchIP(ctx context.Context, iface string, url string) (string, int, error)
	FetchStatus(ctx context.Context, iface string, url string) (int, error)
}

// DefaultHTTPProber uses curl (standard on nodes) or pure Go fallback.
type DefaultHTTPProber struct{}

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

// FetchIP queries the IP provider (e.g. api.ipify.org) and returns body and status code.
func (p *DefaultHTTPProber) FetchIP(ctx context.Context, iface string, targetURL string) (string, int, error) {
	if _, err := exec.LookPath("curl"); err == nil {
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

// FetchStatus queries the target URL discarding body, returning only HTTP status code.
func (p *DefaultHTTPProber) FetchStatus(ctx context.Context, iface string, targetURL string) (int, error) {
	if _, err := exec.LookPath("curl"); err == nil {
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

type checkResult struct {
	name    string
	success bool
	err     error
}

// ProbeTarget performs comprehensive multi-service health verification of an egress target.
// 5 services are probed concurrently:
// 1. IP check via api.ipify.org (must match target.Endpoint).
// 2. Telegram check (api.telegram.org).
// 3. ChatGPT check (chatgpt.com, no 403 block).
// 4. Grok check (grok.com, no 403 block).
// 5. Meta check (instagram.com, no 403 block).
//
// The target is considered available if at least 3 out of 5 checks pass (quorum >= 3/5).
func ProbeTarget(ctx context.Context, cfg Config, target TargetConfig, prober HTTPProber) error {
	// 1. Sysfs interface check if running on Linux
	sysPath := filepath.Join("/sys/class/net", target.Interface)
	if _, err := os.Stat("/sys/class/net"); err == nil {
		if _, err := os.Stat(sysPath); err != nil {
			return fmt.Errorf("туннель %s не запущен: %w", target.Interface, err)
		}
	}

	results := make([]checkResult, 5)
	var wg sync.WaitGroup

	// 1. IP verification via api.ipify.org
	wg.Add(1)
	go func() {
		defer wg.Done()
		ipCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
		defer cancel()
		actualIP, statusCode, err := prober.FetchIP(ipCtx, target.Interface, cfg.IpifyURL)
		if err != nil {
			results[0] = checkResult{name: "ipify", err: fmt.Errorf("ipify недоступен: %w", err)}
			return
		}
		if statusCode < 200 || statusCode >= 400 {
			results[0] = checkResult{name: "ipify", err: fmt.Errorf("ipify вернул HTTP %d", statusCode)}
			return
		}
		if actualIP != target.Endpoint {
			results[0] = checkResult{name: "ipify", err: fmt.Errorf("внешний IP (%s) != ожидаемому (%s)", actualIP, target.Endpoint)}
			return
		}
		results[0] = checkResult{name: "ipify", success: true}
	}()

	// 2. Telegram verification (api.telegram.org)
	wg.Add(1)
	go func() {
		defer wg.Done()
		tgCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
		defer cancel()
		tgStatus, err := prober.FetchStatus(tgCtx, target.Interface, cfg.TelegramURL)
		if err != nil {
			results[1] = checkResult{name: "telegram", err: fmt.Errorf("telegram недоступен: %w", err)}
			return
		}
		if tgStatus >= 400 {
			results[1] = checkResult{name: "telegram", err: fmt.Errorf("telegram вернул ошибку HTTP %d", tgStatus) }
			return
		}
		results[1] = checkResult{name: "telegram", success: true}
	}()

	// 3. ChatGPT verification (chatgpt.com)
	wg.Add(1)
	go func() {
		defer wg.Done()
		gptCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
		defer cancel()
		gptStatus, err := prober.FetchStatus(gptCtx, target.Interface, cfg.ChatGPTURL)
		if err != nil {
			results[2] = checkResult{name: "chatgpt", err: fmt.Errorf("chatgpt недоступен: %w", err)}
			return
		}
		if gptStatus == 403 {
			results[2] = checkResult{name: "chatgpt", err: fmt.Errorf("chatgpt заблокирован (HTTP 403 Forbidden)")}
			return
		}
		if gptStatus >= 500 {
			results[2] = checkResult{name: "chatgpt", err: fmt.Errorf("chatgpt вернул серверную ошибку HTTP %d", gptStatus)}
			return
		}
		results[2] = checkResult{name: "chatgpt", success: true}
	}()

	// 4. Grok verification (grok.com)
	wg.Add(1)
	go func() {
		defer wg.Done()
		grokCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
		defer cancel()
		grokStatus, err := prober.FetchStatus(grokCtx, target.Interface, cfg.GrokURL)
		if err != nil {
			results[3] = checkResult{name: "grok", err: fmt.Errorf("grok недоступен: %w", err)}
			return
		}
		if grokStatus == 403 {
			results[3] = checkResult{name: "grok", err: fmt.Errorf("grok заблокирован (HTTP 403 Forbidden)")}
			return
		}
		if grokStatus >= 500 {
			results[3] = checkResult{name: "grok", err: fmt.Errorf("grok вернул серверную ошибку HTTP %d", grokStatus)}
			return
		}
		results[3] = checkResult{name: "grok", success: true}
	}()

	// 5. Meta verification (instagram.com)
	wg.Add(1)
	go func() {
		defer wg.Done()
		metaCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
		defer cancel()
		metaStatus, err := prober.FetchStatus(metaCtx, target.Interface, cfg.MetaURL)
		if err != nil {
			results[4] = checkResult{name: "meta", err: fmt.Errorf("meta недоступен: %w", err)}
			return
		}
		if metaStatus == 403 {
			results[4] = checkResult{name: "meta", err: fmt.Errorf("meta заблокирован (HTTP 403 Forbidden)")}
			return
		}
		if metaStatus >= 500 {
			results[4] = checkResult{name: "meta", err: fmt.Errorf("meta вернул серверную ошибку HTTP %d", metaStatus)}
			return
		}
		results[4] = checkResult{name: "meta", success: true}
	}()

	wg.Wait()

	successCount := 0
	var failures []string
	for _, r := range results {
		if r.success {
			successCount++
		} else if r.err != nil {
			failures = append(failures, r.err.Error())
		}
	}

	// Quorum: at least 3 out of 5 checks must pass
	if successCount >= 3 {
		return nil
	}

	return fmt.Errorf("пройдено только %d/5 проверок (сбои: %s)", successCount, strings.Join(failures, "; "))
}
