package logger

import (
	"bytes"
	"log/slog"
	"os"
	"strings"
	"testing"
)

func TestParseLevel(t *testing.T) {
	tests := []struct {
		input string
		want  slog.Level
	}{
		{"debug", slog.LevelDebug},
		{"DEBUG", slog.LevelDebug},
		{"warn", slog.LevelWarn},
		{"warning", slog.LevelWarn},
		{"error", slog.LevelError},
		{"info", slog.LevelInfo},
		{"unknown", slog.LevelInfo},
		{"", slog.LevelInfo},
	}

	for _, tt := range tests {
		got := parseLevel(tt.input)
		if got != tt.want {
			t.Errorf("parseLevel(%q) = %v; want %v", tt.input, got, tt.want)
		}
	}
}

func TestInitLoggerTextAndJSON(t *testing.T) {
	origFormat := os.Getenv("LOG_FORMAT")
	origLevel := os.Getenv("LOG_LEVEL")
	defer func() {
		os.Setenv("LOG_FORMAT", origFormat)
		os.Setenv("LOG_LEVEL", origLevel)
	}()

	os.Setenv("LOG_FORMAT", "text")
	os.Setenv("LOG_LEVEL", "debug")
	l1 := Init("test-service")
	if l1 == nil {
		t.Fatal("expected non-nil logger")
	}

	os.Setenv("LOG_FORMAT", "json")
	os.Setenv("LOG_LEVEL", "warn")
	l2 := Init("test-json-service")
	if l2 == nil {
		t.Fatal("expected non-nil logger")
	}
}

func TestSlogWriter(t *testing.T) {
	buf := &bytes.Buffer{}
	h := slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	l := slog.New(h)

	w := &slogWriter{logger: l}
	_, err := w.Write([]byte("legacy log line\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	out := buf.String()
	if !strings.Contains(out, "legacy log line") {
		t.Errorf("expected buffer to contain 'legacy log line', got %q", out)
	}
}
