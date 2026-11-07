package runner

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildClientMappings(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "awg-mappings-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	scriptPath := filepath.Join(tmpDir, "manage_amneziawg.sh")
	_ = os.WriteFile(scriptPath, []byte("#!/bin/bash\nexit 0\n"), 0755)

	clientsDir := filepath.Join(tmpDir, "clients")
	_ = os.MkdirAll(clientsDir, 0755)

	// Create a dummy server config awg0.conf
	serverConf := `[Interface]
Address = 10.7.0.1/24
PrivateKey = ServerPrivKey=
ListenPort = 51820

### Client u1_phone
[Peer]
PublicKey = Client1PubKey12345=
PresharedKey = PresharedKey1=
AllowedIPs = 10.7.0.2/32

# Client u2_laptop
[Peer]
PublicKey = Client2PubKey67890=
AllowedIPs = 10.7.0.3/32, 10.7.0.4/32
`
	_ = os.WriteFile(filepath.Join(tmpDir, "awg0.conf"), []byte(serverConf), 0644)

	// Create a dummy client config u3_tablet.conf with valid 32-byte base64 PrivateKey
	// privKey: "WHSK...=" (32 bytes) -> derived pubKey will map to u3_tablet
	clientConf := `[Interface]
Address = 10.7.0.5/32
PrivateKey = 4C8A79Qp9iB+YF8p8Xq4rK7j+Fh9V5y9H2eF5nB1Q4A=
[Peer]
PublicKey = ServerPubKey=
`
	_ = os.WriteFile(filepath.Join(clientsDir, "u3_tablet.conf"), []byte(clientConf), 0644)

	runner := NewRealRunner(scriptPath, clientsDir)
	pubkeys, ips, known := runner.buildClientMappings()

	// Verify derived pubkey exists for u3_tablet
	derivedPub, err := derivePubKeyFromPrivateKey("4C8A79Qp9iB+YF8p8Xq4rK7j+Fh9V5y9H2eF5nB1Q4A=")
	if err != nil || derivedPub == "" || pubkeys[derivedPub] != "u3_tablet" {
		t.Errorf("expected derived pubkey mapping for u3_tablet, got '%s' (pubkey: %s)", pubkeys[derivedPub], derivedPub)
	}

	if pubkeys["Client1PubKey12345="] != "u1_phone" {
		t.Errorf("expected pubkey mapping for u1_phone, got '%s'", pubkeys["Client1PubKey12345="])
	}
	if pubkeys["Client2PubKey67890="] != "u2_laptop" {
		t.Errorf("expected pubkey mapping for u2_laptop, got '%s'", pubkeys["Client2PubKey67890="])
	}
	if ips["10.7.0.2"] != "u1_phone" {
		t.Errorf("expected ip mapping for 10.7.0.2 -> u1_phone, got '%s'", ips["10.7.0.2"])
	}
	if ips["10.7.0.3"] != "u2_laptop" {
		t.Errorf("expected ip mapping for 10.7.0.3 -> u2_laptop, got '%s'", ips["10.7.0.3"])
	}
	if ips["10.7.0.5"] != "u3_tablet" {
		t.Errorf("expected ip mapping for 10.7.0.5 -> u3_tablet, got '%s'", ips["10.7.0.5"])
	}
	if !known["u1_phone"] || !known["u2_laptop"] || !known["u3_tablet"] {
		t.Errorf("expected all 3 clients in knownClients map: %+v", known)
	}

	// Test GetStats with no live kernel interface (falls back to known clients with zero values)
	stats, err := runner.GetStats(context.Background())
	if err != nil {
		t.Fatalf("GetStats returned unexpected error: %v", err)
	}
	if stats == nil || len(stats.Peers) != 3 {
		t.Fatalf("expected 3 peers in stats (from known clients), got %+v", stats)
	}
	if stats.Peers["u1_phone"].LastHandshake != "Никогда" || stats.Peers["u1_phone"].IsOnline {
		t.Errorf("expected offline status with 'Никогда', got %+v", stats.Peers["u1_phone"])
	}
}

func TestPremiumTelemetryUsesOnlyConfiguredInterface(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\n[ \"$1 $2 $3\" = 'show awgp dump' ] || exit 1\nprintf 'private\\tpublic\\t51826\\toff\\npeer\\tpsk\\tendpoint\\t10.56.0.2/32\\t123\\t10\\t20\\t25\\n'\n"
	if err := os.WriteFile(filepath.Join(dir, "awg"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("AWG_INTERFACE", "awgp")
	r := NewRealRunner("unused", dir)
	lines := r.fetchAWGDump(context.Background())
	if len(lines) != 1 || lines[0] != "awgp\tpeer\tpsk\tendpoint\t10.56.0.2/32\t123\t10\t20\t25" {
		t.Fatalf("unexpected premium dump: %q", lines)
	}
}

func TestRestartUsesConfiguredManager(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "premium-manager.sh")
	marker := filepath.Join(dir, "restarted")
	if err := os.WriteFile(script, []byte("#!/bin/bash\n[ \"$1\" = restart ] || exit 1\ntouch '"+marker+"'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := NewRealRunner(script, dir).RestartAWG(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatal("configured manager was not invoked", err)
	}
}

func TestPremiumMappingsExcludeOtherServerInterfaces(t *testing.T) {
	dir := t.TempDir()
	for name, client := range map[string]string{"awgp": "premium_user", "awg0": "standard_user"} {
		conf := "[Interface]\n\n### Client " + client + "\n[Peer]\nPublicKey = " + client + "\nAllowedIPs = 10.56.0.2/32\n"
		if err := os.WriteFile(filepath.Join(dir, name+".conf"), []byte(conf), 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("AWG_INTERFACE", "awgp")
	_, _, clients := NewRealRunner(filepath.Join(dir, "manage.sh"), dir).buildClientMappings()
	if !clients["premium_user"] || clients["standard_user"] {
		t.Fatalf("cross-interface client mappings: %+v", clients)
	}
}
