package logger

import (
	"context"
	"io"
	"log"
	"log/slog"
	"os"
	"strings"
)

// Init initializes the global slog default logger and bridges the standard log package.
func Init(service string) *slog.Logger {
	level := parseLevel(os.Getenv("LOG_LEVEL"))

	opts := &slog.HandlerOptions{
		Level: level,
	}

	format := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_FORMAT")))
	var handler slog.Handler
	if format == "json" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	logger := slog.New(handler).With(slog.String("service", service))
	slog.SetDefault(logger)

	// Bridge legacy standard log package to slog
	log.SetFlags(0)
	log.SetOutput(&slogWriter{logger: logger})

	return logger
}

func parseLevel(lvlStr string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(lvlStr)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// slogWriter bridges standard library log.Print calls to slog.Info.
type slogWriter struct {
	logger *slog.Logger
}

func (w *slogWriter) Write(p []byte) (n int, err error) {
	msg := strings.TrimRight(string(p), "\r\n")
	if msg != "" {
		w.logger.Log(context.Background(), slog.LevelInfo, msg)
	}
	return len(p), nil
}

// DiscardLogger creates a no-op logger for tests.
func DiscardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
