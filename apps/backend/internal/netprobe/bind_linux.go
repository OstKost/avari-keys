//go:build linux

package netprobe

import (
	"fmt"
	"net"
	"syscall"
)

// interfaceDialer pins sockets to the configured physical device. Failure is
// returned to the caller; probes must never silently fall back to an overlay.
func interfaceDialer(iface string) (*net.Dialer, error) {
	d := &net.Dialer{}
	if iface == "" {
		return d, nil
	}
	if _, err := net.InterfaceByName(iface); err != nil {
		return nil, fmt.Errorf("probe interface %q: %w", iface, err)
	}
	d.Control = func(network, address string, raw syscall.RawConn) error {
		var bindErr error
		if err := raw.Control(func(fd uintptr) {
			bindErr = syscall.SetsockoptString(int(fd), syscall.SOL_SOCKET, syscall.SO_BINDTODEVICE, iface)
		}); err != nil {
			return err
		}
		return bindErr
	}
	return d, nil
}
