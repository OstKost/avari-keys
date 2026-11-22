package egress

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// TargetConfig represents an egress target interface configuration.
type TargetConfig struct {
	Interface string `json:"interface"`
	Endpoint  string `json:"endpoint"`
	Node      string `json:"node,omitempty"`
	Label     string `json:"label,omitempty"`
}

// Config paths for cascade egress management.
type Config struct {
	RegistryPath string
	StatePath    string
	PendingPath  string
	SubnetPath   string
	LockPath     string

	IpifyURL    string
	IPProviders []string
	TelegramURL string
	ChatGPTURL  string
	GrokURL     string
	MetaURL     string
	DoHURL      string
}

var ifaceRegex = regexp.MustCompile(`^awg[1-9][0-9]*$`)

// DefaultConfig returns configuration with standard production paths and env overrides.
func DefaultConfig() Config {
	reg := os.Getenv("AVARI_EGRESS_CONFIG")
	if reg == "" {
		reg = "/etc/avari-keys/egress.json"
	}
	state := os.Getenv("AVARI_EGRESS_STATE")
	if state == "" {
		state = "/root/awg/egress-selected.env"
	}
	pending := os.Getenv("AVARI_EGRESS_PENDING")
	if pending == "" {
		pending = "/root/awg/egress-pending.json"
	}
	subnet := os.Getenv("AVARI_EGRESS_SUBNET")
	if subnet == "" {
		subnet = "/etc/avari-keys/egress-client-subnet"
	}
	lock := os.Getenv("AVARI_EGRESS_LOCK")
	if lock == "" {
		lock = "/root/awg/awg-routing.lock"
	}

	ipifyURL := os.Getenv("AVARI_PROBE_IPIFY_URL")
	if ipifyURL == "" {
		ipifyURL = "https://api.ipify.org"
	}

	ipProviders := []string{
		ipifyURL,
		"https://icanhazip.com",
		"https://ipinfo.io/ip",
		"https://api.myip.com",
	}
	if customProviders := os.Getenv("AVARI_PROBE_IP_PROVIDERS"); customProviders != "" {
		parts := strings.Split(customProviders, ",")
		var clean []string
		for _, p := range parts {
			if trimmed := strings.TrimSpace(p); trimmed != "" {
				clean = append(clean, trimmed)
			}
		}
		if len(clean) > 0 {
			ipProviders = clean
		}
	}

	tgURL := os.Getenv("AVARI_PROBE_TELEGRAM_URL")
	if tgURL == "" {
		tgURL = "https://api.telegram.org"
	}
	chatgptURL := os.Getenv("AVARI_PROBE_CHATGPT_URL")
	if chatgptURL == "" {
		chatgptURL = "https://chatgpt.com"
	}
	grokURL := os.Getenv("AVARI_PROBE_GROK_URL")
	if grokURL == "" {
		grokURL = "https://grok.com"
	}
	metaURL := os.Getenv("AVARI_PROBE_META_URL")
	if metaURL == "" {
		metaURL = "https://www.instagram.com"
	}

	dohURL := os.Getenv("AVARI_PROBE_DOH_URL")
	if dohURL == "" {
		dohURL = "https://dns.google/dns-query"
	}

	return Config{
		RegistryPath: reg,
		StatePath:    state,
		PendingPath:  pending,
		SubnetPath:   subnet,
		LockPath:     lock,
		IpifyURL:     ipifyURL,
		IPProviders:  ipProviders,
		TelegramURL:  tgURL,
		ChatGPTURL:   chatgptURL,
		GrokURL:      grokURL,
		MetaURL:      metaURL,
		DoHURL:       dohURL,
	}
}

// ReadRegistry reads and validates egress targets from the JSON registry.
func ReadRegistry(path string) ([]TargetConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read egress registry %q: %w", path, err)
	}

	var entries []TargetConfig
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("parse egress registry: %w", err)
	}

	if len(entries) == 0 {
		return nil, fmt.Errorf("egress registry %q is empty", path)
	}

	seen := make(map[string]bool)
	for _, entry := range entries {
		if !ifaceRegex.MatchString(entry.Interface) {
			return nil, fmt.Errorf("invalid egress interface %q (must match awg[1-9][0-9]*)", entry.Interface)
		}
		if seen[entry.Interface] {
			return nil, fmt.Errorf("duplicate egress interface %q", entry.Interface)
		}
		seen[entry.Interface] = true

		ip := net.ParseIP(entry.Endpoint)
		if ip == nil || ip.To4() == nil {
			return nil, fmt.Errorf("invalid IPv4 endpoint %q for interface %s", entry.Endpoint, entry.Interface)
		}
	}

	return entries, nil
}

// AtomicWrite atomically writes content to destination file with 0600 permissions.
func AtomicWrite(path string, content []byte) error {
	tmp := path + ".new"
	if err := os.WriteFile(tmp, content, 0600); err != nil {
		return fmt.Errorf("write tmp file %q: %w", tmp, err)
	}

	f, err := os.Open(tmp)
	if err == nil {
		_ = f.Sync()
		_ = f.Close()
	}

	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("rename %q to %q: %w", tmp, path, err)
	}

	dir, err := os.Open(filepath.Dir(path))
	if err == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}

	return nil
}
