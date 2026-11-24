package vless

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestRestartFailureRollsBackRevocation(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	store := New("direct.example.org")
	store.File = filepath.Join(t.TempDir(), "config.json")
	var ib inbound
	ib.Protocol = "vless"
	ib.Port = listener.Addr().(*net.TCPAddr).Port
	ib.Stream.Security = "reality"
	ib.Stream.Reality.PrivateKey = base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	ib.Stream.Reality.Names = []string{"example.org"}
	ib.Stream.Reality.IDs = []string{"ab"}
	cfg := configuration{Inbounds: []inbound{ib}}
	raw, _ := json.Marshal(cfg)
	if err := os.WriteFile(store.File, raw, 0600); err != nil {
		t.Fatal(err)
	}
	fail := false
	store.run = func(ctx context.Context, command string, args ...string) error {
		if fail && args[0] == "restart" {
			fail = false
			return errors.New("restart failed")
		}
		return nil
	}
	ctx := context.Background()
	created, err := store.Manage(ctx, "POST", "first")
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(store.File)
	if err != nil {
		t.Fatal(err)
	}
	fail = true
	if _, err = store.Manage(ctx, "DELETE", "first"); err == nil {
		t.Fatal("expected restart error")
	}
	after, err := os.ReadFile(store.File)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("rollback lost prior config")
	}
	reopened := New(store.Host)
	reopened.File = store.File
	existing, err := reopened.Manage(ctx, "GET", "first")
	if err != nil || existing.VPNURI != created.VPNURI {
		t.Fatal("credential did not survive restart")
	}
	if _, err = store.Manage(ctx, "DELETE", "first"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Manage(ctx, "GET", "first"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("revoked credential present")
	}
}
