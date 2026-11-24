package master

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type clientRecord struct {
	timestamps []time.Time
}

// IPRateLimiter tracks request timestamps per IP and enforces sliding-window rate limits.
type IPRateLimiter struct {
	mu       sync.Mutex
	records  map[string]*clientRecord
	limit    int
	window   time.Duration
	stopChan chan struct{}
}

// NewIPRateLimiter creates a new sliding-window rate limiter per IP address.
func NewIPRateLimiter(limit int, window time.Duration) *IPRateLimiter {
	limiter := &IPRateLimiter{
		records:  make(map[string]*clientRecord),
		limit:    limit,
		window:   window,
		stopChan: make(chan struct{}),
	}
	go limiter.cleanupLoop(window * 2)
	return limiter
}

// Stop shuts down the background cleanup worker.
func (l *IPRateLimiter) Stop() {
	select {
	case <-l.stopChan:
	default:
		close(l.stopChan)
	}
}

// Allow checks if the given IP is permitted to make a request, returning retry duration if rejected.
func (l *IPRateLimiter) Allow(ip string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-l.window)

	rec, exists := l.records[ip]
	if !exists {
		l.records[ip] = &clientRecord{timestamps: []time.Time{now}}
		return true, 0
	}

	valid := rec.timestamps[:0]
	for _, t := range rec.timestamps {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	rec.timestamps = valid

	if len(rec.timestamps) >= l.limit {
		oldest := rec.timestamps[0]
		retryAfter := l.window - now.Sub(oldest)
		if retryAfter < time.Second {
			retryAfter = time.Second
		}
		return false, retryAfter
	}

	rec.timestamps = append(rec.timestamps, now)
	return true, 0
}

func (l *IPRateLimiter) cleanupLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			l.cleanup()
		case <-l.stopChan:
			return
		}
	}
}

func (l *IPRateLimiter) cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()

	cutoff := time.Now().Add(-l.window)
	for ip, rec := range l.records {
		valid := false
		for _, t := range rec.timestamps {
			if t.After(cutoff) {
				valid = true
				break
			}
		}
		if !valid {
			delete(l.records, ip)
		}
	}
}

// GetClientIP extracts real client IP from X-Forwarded-For, X-Real-IP, or RemoteAddr.
func GetClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		ip := strings.TrimSpace(parts[0])
		if ip != "" {
			return ip
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		ip := strings.TrimSpace(xri)
		if ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}
