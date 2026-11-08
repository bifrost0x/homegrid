package server

import (
	"net/http"
	"sync"
	"time"
)

type attempts struct {
	count int
	until time.Time
}
type rateLimiter struct {
	mu      sync.Mutex
	entries map[string]attempts
}

func (l *rateLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	v, ok := l.entries[key]
	if !ok || !now.Before(v.until) {
		if len(l.entries) >= 4096 {
			for k, a := range l.entries {
				if !now.Before(a.until) {
					delete(l.entries, k)
				}
			}
			if len(l.entries) >= 4096 {
				return false
			}
		}
		v = attempts{until: now.Add(5 * time.Minute)}
	}
	if v.count >= 10 {
		return false
	}
	v.count++
	l.entries[key] = v
	return true
}
func (s *Server) passwordWork(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.limiter.allow(s.clientIP(r), time.Now()) {
			w.Header().Set("Retry-After", "300")
			fail(w, 429, "rate_limit", "Too many password attempts. Try again later.")
			return
		}
		select {
		case s.passwordSlots <- struct{}{}:
			defer func() { <-s.passwordSlots }()
		default:
			w.Header().Set("Retry-After", "2")
			fail(w, 429, "rate_limit", "Please try again shortly")
			return
		}
		next(w, r)
	}
}
