package server

import (
	"net/http"
	"net/netip"
	"sync"
	"time"
)

const (
	limitEntries  = 4096
	limitAttempts = 10
	limitWindow   = 5 * time.Minute
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
		if !ok && len(l.entries) >= limitEntries {
			l.evict(now)
		}
		v = attempts{until: now.Add(limitWindow)}
	}
	if v.count >= limitAttempts {
		return false
	}
	v.count++
	l.entries[key] = v
	return true
}

// evict makes room for a new key. Expired entries go first. Among active
// entries, clients that are not locked out are dropped before locked ones, so
// flooding the table does not hand a locked client its attempts back; the
// entry closest to expiry goes first within each group. Refusing new keys
// instead would let anyone with enough addresses lock out every other client.
func (l *rateLimiter) evict(now time.Time) {
	for k, a := range l.entries {
		if !now.Before(a.until) {
			delete(l.entries, k)
		}
	}
	for len(l.entries) >= limitEntries {
		var victim string
		var chosen attempts
		found := false
		for k, a := range l.entries {
			if !found || evictBefore(a, chosen) {
				victim, chosen, found = k, a, true
			}
		}
		delete(l.entries, victim)
	}
}

func evictBefore(a, b attempts) bool {
	aLocked, bLocked := a.count >= limitAttempts, b.count >= limitAttempts
	if aLocked != bLocked {
		return !aLocked
	}
	return a.until.Before(b.until)
}

// reset forgets the attempts of a client after a successful sign-in, so
// regular use from one address never counts towards the limit.
func (l *rateLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}

// limitKey groups IPv6 clients by their /64 network: a single host usually
// controls a whole /64 and could otherwise rotate through addresses.
func limitKey(ip string) string {
	addr, e := netip.ParseAddr(ip)
	if e != nil {
		return ip
	}
	addr = addr.Unmap()
	if addr.Is6() {
		return netip.PrefixFrom(addr.WithZone(""), 64).Masked().String()
	}
	return addr.String()
}

func (s *Server) passwordWork(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.limiter.allow(limitKey(s.clientIP(r)), time.Now()) {
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
