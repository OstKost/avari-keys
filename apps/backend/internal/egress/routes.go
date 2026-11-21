package egress

import (
	"context"
	"fmt"
	"strings"
)

// TelegramNetworks defines the IP subnets belonging to Telegram routed through the cascade egress.
var TelegramNetworks = []string{
	"91.108.4.0/22",
	"91.108.8.0/22",
	"91.108.12.0/22",
	"91.108.16.0/22",
	"91.108.56.0/22",
	"149.154.160.0/20",
}

// Active returns the currently active egress interface in table 100.
// If not found or ambiguous, returns an empty string.
func Active(ctx context.Context, exec CommandExecutor) (string, error) {
	out, err := exec.Run(ctx, "ip", "-4", "route", "show", "table", "100")
	if err != nil {
		return "", fmt.Errorf("ip route show table 100 failed: %w", err)
	}

	lines := strings.Split(out, "\n")
	var defaultDevs []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "default ") {
			fields := strings.Fields(trimmed)
			for i, f := range fields {
				if f == "dev" && i+1 < len(fields) {
					defaultDevs = append(defaultDevs, fields[i+1])
					break
				}
			}
		}
	}

	if len(defaultDevs) != 1 {
		return "", nil
	}
	return defaultDevs[0], nil
}

// ReadCurrentRoutes captures table 100 default route and all Telegram prefixes routes.
func ReadCurrentRoutes(ctx context.Context, exec CommandExecutor) (map[string][]string, error) {
	routes := make(map[string][]string)

	defOut, err := exec.Run(ctx, "ip", "-4", "route", "show", "table", "100", "default")
	if err == nil && strings.TrimSpace(defOut) != "" {
		routes["default"] = splitNonEmpty(defOut)
	} else {
		routes["default"] = []string{}
	}

	for _, prefix := range TelegramNetworks {
		pOut, err := exec.Run(ctx, "ip", "-4", "route", "show", "exact", prefix)
		if err == nil && strings.TrimSpace(pOut) != "" {
			routes[prefix] = splitNonEmpty(pOut)
		} else {
			routes[prefix] = []string{}
		}
	}

	return routes, nil
}

// CheckNatRule checks if iptables MASQUERADE rule exists for subnet and interface.
func CheckNatRule(ctx context.Context, exec CommandExecutor, subnet, iface string) bool {
	code, err := exec.Raw(ctx, "iptables", "-t", "nat", "-C", "POSTROUTING", "-s", subnet, "-o", iface, "-j", "MASQUERADE")
	return err == nil && code == 0
}

// AddNatRule adds iptables MASQUERADE rule for subnet and interface.
func AddNatRule(ctx context.Context, exec CommandExecutor, subnet, iface string) error {
	_, err := exec.Run(ctx, "iptables", "-t", "nat", "-A", "POSTROUTING", "-s", subnet, "-o", iface, "-j", "MASQUERADE")
	return err
}

// DeleteNatRule deletes iptables MASQUERADE rule for subnet and interface.
func DeleteNatRule(ctx context.Context, exec CommandExecutor, subnet, iface string) error {
	_, err := exec.Run(ctx, "iptables", "-t", "nat", "-D", "POSTROUTING", "-s", subnet, "-o", iface, "-j", "MASQUERADE")
	return err
}

// ApplyRoutes updates table 100 default route and Telegram subnets to target interface.
func ApplyRoutes(ctx context.Context, exec CommandExecutor, iface string) error {
	if _, err := exec.Run(ctx, "ip", "-4", "route", "replace", "default", "dev", iface, "table", "100"); err != nil {
		return fmt.Errorf("set default route table 100 dev %s: %w", iface, err)
	}

	for _, prefix := range TelegramNetworks {
		if _, err := exec.Run(ctx, "ip", "-4", "route", "replace", prefix, "dev", iface); err != nil {
			return fmt.Errorf("set route %s dev %s: %w", prefix, iface, err)
		}
	}

	return nil
}

// RollbackRoutes restores routes from snapshot.
func RollbackRoutes(ctx context.Context, exec CommandExecutor, routes map[string][]string) {
	for prefix, routeList := range routes {
		delArgs := []string{"-4", "route", "del", prefix}
		if prefix == "default" {
			delArgs = append(delArgs, "table", "100")
		}
		_, _ = exec.Raw(ctx, "ip", delArgs...)

		for _, r := range routeList {
			parts := strings.Fields(r)
			if len(parts) == 0 {
				continue
			}
			repArgs := append([]string{"-4", "route", "replace"}, parts...)
			if prefix == "default" {
				repArgs = append(repArgs, "table", "100")
			}
			_, _ = exec.Run(ctx, "ip", repArgs...)
		}
	}
}

func splitNonEmpty(s string) []string {
	var res []string
	for _, line := range strings.Split(s, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			res = append(res, trimmed)
		}
	}
	return res
}
