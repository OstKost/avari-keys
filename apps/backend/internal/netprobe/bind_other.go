//go:build !linux

package netprobe

import (
	"fmt"
	"net"
)

func interfaceDialer(iface string) (*net.Dialer, error) {
	if iface != "" {
		return nil, fmt.Errorf("NETWORK_PROBE_INTERFACE requires Linux; refusing unbound probes")
	}
	return &net.Dialer{}, nil
}
