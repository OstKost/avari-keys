package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/egress"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/firewall"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/logger"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/runner"
	"github.com/OstKost/avari-keys-mvp/apps/backend/internal/slave"
)

func main() {
	if len(os.Args) > 1 {
		args := os.Args[1:]
		if args[0] == "egress" && len(args) > 1 {
			args = args[1:]
		}

		switch args[0] {
		case "status":
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			mgr := egress.NewManager()
			status, err := mgr.GetStatus(ctx)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error getting egress status: %v\n", err)
				os.Exit(1)
			}
			data, err := json.Marshal(status)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error marshaling egress status: %v\n", err)
				os.Exit(1)
			}
			fmt.Println(string(data))
			os.Exit(0)

		case "switch":
			if len(args) < 2 {
				fmt.Fprintln(os.Stderr, "Usage: avari-slave switch INTERFACE (e.g. awg1, awg3)")
				os.Exit(1)
			}
			iface := args[1]
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			mgr := egress.NewManager()
			if err := mgr.Switch(ctx, iface); err != nil {
				fmt.Fprintf(os.Stderr, "Egress switch to %s failed: %v\n", iface, err)
				os.Exit(1)
			}
			fmt.Printf("Egress switch to %s successful\n", iface)
			os.Exit(0)

		case "recover":
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			mgr := egress.NewManager()
			if err := mgr.Recover(ctx); err != nil {
				fmt.Fprintf(os.Stderr, "Egress recovery failed: %v\n", err)
				os.Exit(1)
			}
			os.Exit(0)

		case "-h", "--help", "help":
			fmt.Println("Avari Keys Slave API & Cascade Egress Manager")
			fmt.Println("Usage:")
			fmt.Println("  avari-slave               Run HTTP Slave API daemon")
			fmt.Println("  avari-slave status        Check cascade egress status and targets")
			fmt.Println("  avari-slave switch IFACE  Switch active cascade egress interface")
			fmt.Println("  avari-slave recover       Recover pending egress switch transaction")
			os.Exit(0)
		}
	}

	logger.Init("avari-slave")

	port := os.Getenv("SLAVE_PORT")
	if port == "" {
		port = "8081"
	}

	apiKey := os.Getenv("SLAVE_API_KEY")
	useMock := os.Getenv("AWG_USE_MOCK") == "true" || os.Getenv("AWG_USE_MOCK") == "1"

	var awgRunner runner.AWGRunner
	if useMock {
		slog.Info("Running in MOCK mode (simulating manage_amneziawg.sh)")
		awgRunner = runner.NewMockRunner(true)
	} else {
		scriptPath := os.Getenv("AWG_SCRIPT_PATH")
		if scriptPath == "" {
			scriptPath = "/root/awg/manage_amneziawg.sh"
		}
		configsDir := os.Getenv("AWG_CONFIGS_DIR")
		if configsDir == "" {
			configsDir = "/root/awg/clients"
		}
		awgRunner = runner.NewRealRunner(scriptPath, configsDir)
	}

	firewallManager := firewall.NewManager(&egress.OSCommandExecutor{})

	statePath := os.Getenv("FIREWALL_STATE_PATH")
	if statePath == "" {
		statePath = "/etc/avari-keys/firewall-state.json"
	}
	firewallManager.SetStatePath(statePath)
	if restored, err := firewallManager.RestoreState(context.Background()); err != nil {
		slog.Warn("failed to restore torrent firewall state", "error", err)
	} else if restored {
		slog.Info("restored torrent firewall state", "path", statePath)
	}

	// Periodic re-resolve of blocklist domains.
	go firewallManager.StartResolver(context.Background(), 15*time.Minute)

	cfg := slave.Config{
		APIKey:   apiKey,
		Port:     port,
		Firewall: firewallManager,
	}

	srv := slave.NewServer(cfg, awgRunner)

	addr := fmt.Sprintf(":%s", port)
	slog.Info("Slave server listening", "port", port, "url", fmt.Sprintf("http://0.0.0.0:%s", port))
	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		slog.Error("Slave server startup failed", "error", err)
		os.Exit(1)
	}
}
