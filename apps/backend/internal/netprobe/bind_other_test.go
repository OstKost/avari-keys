//go:build !linux

package netprobe

import "testing"

func TestConfiguredInterfaceFailsOnUnsupportedPlatform(t *testing.T) {
	if d, err := interfaceDialer("physical-test"); err == nil || d != nil {
		t.Fatal("unsupported platform must reject explicit binding, never fall back")
	}
}
