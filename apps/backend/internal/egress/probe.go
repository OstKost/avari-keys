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

// ProbeTarget performs comprehensive multi-service health verification of an egress target:
// 1. Interface exists in sysfs (Linux).
// 2. IP match check via api.ipify.org.
// 3. Telegram check (api.telegram.org) -> verifies Telegram connectivity over egress routing.
// 4. ChatGPT check (chatgpt.com) -> verifies Cloudflare/OpenAI access without 403 block.
func ProbeTarget(ctx context.Context, cfg Config, target TargetConfig, prober HTTPProber) error {
	// 1. Sysfs interface check if running on Linux
	sysPath := filepath.Join("/sys/class/net", target.Interface)
	if _, err := os.Stat("/sys/class/net"); err == nil {
		if _, err := os.Stat(sysPath); err != nil {
			return fmt.Errorf("туннель %s не запущен: %w", target.Interface, err)
		}
	}

	// 2. IP verification via api.ipify.org
	ipCtx, ipCancel := context.WithTimeout(ctx, 7*time.Second)
	actualIP, statusCode, ipErr := prober.FetchIP(ipCtx, target.Interface, cfg.IpifyURL)
	ipCancel()
	if ipErr != nil {
		return fmt.Errorf("ipify недоступен: %w", ipErr)
	}
	if statusCode < 200 || statusCode >= 400 {
		return fmt.Errorf("ipify вернул HTTP %d", statusCode)
	}
	if actualIP != target.Endpoint {
		return fmt.Errorf("внешний IP туннеля (%s) не совпадает с ожидаемым (%s)", actualIP, target.Endpoint)
	}

	// 3. Telegram verification
	tgCtx, tgCancel := context.WithTimeout(ctx, 7*time.Second)
	tgStatus, tgErr := prober.FetchStatus(tgCtx, target.Interface, cfg.TelegramURL)
	tgCancel()
	if tgErr != nil {
		return fmt.Errorf("telegram недоступен: %w", tgErr)
	}
	// Telegram typically returns 200 or 302 Found
	if tgStatus >= 400 {
		return fmt.Errorf("telegram вернул ошибку HTTP %d", tgStatus)
	}

	// 4. ChatGPT verification
	gptCtx, gptCancel := context.WithTimeout(ctx, 7*time.Second)
	gptStatus, gptErr := prober.FetchStatus(gptCtx, target.Interface, cfg.ChatGPTURL)
	gptCancel()
	if gptErr != nil {
		return fmt.Errorf("chatgpt недоступен: %w", gptErr)
	}
	if gptStatus == 403 {
		return fmt.Errorf("chatgpt заблокирован (HTTP 403 Forbidden)")
	}
	if gptStatus >= 500 {
		return fmt.Errorf("chatgpt вернул серверную ошибку HTTP %d", gptStatus)
	}

	return nil
}
