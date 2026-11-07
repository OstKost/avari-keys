//go:build linux

package netprobe

import (
	"context"
	"errors"
	"net"
	"syscall"
	"testing"
	"time"
)

func TestLinuxDialerBindsToConfiguredDevice(t *testing.T) {
	ifaces, err := net.Interfaces()
	if err != nil {
		t.Fatal(err)
	}
	var loopback string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 {
			loopback = iface.Name
			break
		}
	}
	if loopback == "" {
		t.Skip("loopback device not available")
	}
	d, err := interfaceDialer(loopback)
	if err != nil || d.Control == nil {
		t.Fatalf("expected device-binding Control hook: %v", err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	conn, err := d.DialContext(ctx, "tcp", listener.Addr().String())
	if errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EACCES) {
		t.Skip("SO_BINDTODEVICE unavailable to this test user")
	}
	if err != nil {
		t.Fatalf("bound loopback connection failed: %v", err)
	}
	conn.Close()
}
