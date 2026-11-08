package server

import (
	"context"
	"crypto/subtle"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"runtime/debug"
	"strings"
)

func (s *Server) securityHeaders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
	if s.cfg.SecureCookie {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	}
	if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/uploads/") {
		w.Header().Set("Cache-Control", "no-store")
	}
}

// recoverPanic must be deferred directly so recover sees the handler's panic.
func (s *Server) recoverPanic(w http.ResponseWriter, r *http.Request) {
	if v := recover(); v != nil {
		// ErrAbortHandler deliberately aborts the response; net/http handles it silently.
		if v == http.ErrAbortHandler {
			panic(v)
		}
		s.cfg.Logger.Error("request panic", "method", r.Method, "path", r.URL.Path, "panic", fmt.Sprint(v), "stack", string(debug.Stack()))
		fail(w, 500, "internal", "An internal error occurred")
	}
}
func (s *Server) trusted(addr string) bool {
	ip, e := netip.ParseAddr(addr)
	if e != nil {
		return false
	}
	ip = ip.Unmap()
	for _, p := range s.cfg.TrustedProxies {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}
func remoteIP(r *http.Request) string {
	h, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		return r.RemoteAddr
	}
	return h
}
func (s *Server) clientIP(r *http.Request) string {
	peer := remoteIP(r)
	if !s.trusted(peer) {
		return peer
	}
	parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		v := strings.TrimSpace(parts[i])
		if _, e := netip.ParseAddr(v); e != nil {
			return peer
		}
		peer = v
		if !s.trusted(peer) {
			return peer
		}
	}
	return peer
}
func (s *Server) sameOrigin(r *http.Request) bool {
	switch r.Header.Get("Sec-Fetch-Site") {
	case "", "same-origin", "none":
	default:
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, e := url.Parse(origin)
	if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || origin != u.Scheme+"://"+u.Host {
		return false
	}
	// TLS can terminate at a reverse proxy, so compare the public authority
	// preserved in Host rather than the backend transport or forwarded headers.
	return strings.EqualFold(u.Host, r.Host)
}
func validCSRF(a, b string) bool {
	return len(a) == 64 && len(b) == 64 && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
func mutation(r *http.Request) bool {
	return r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
}
func (s *Server) protected(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, ok := s.lookup(r)
		if !ok {
			fail(w, 401, "unauthorized", "Sign in to continue")
			return
		}
		if mutation(r) && !s.sameOrigin(r) {
			fail(w, 403, "origin", "This address is not allowed. Check HomeGrid's reverse proxy configuration.")
			return
		}
		if mutation(r) && !validCSRF(v.CSRF, r.Header.Get("X-CSRF-Token")) {
			fail(w, 403, "csrf", "Refresh the page and try again")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), identityKey{}, v)))
	}
}
func (s *Server) preAuth(next http.HandlerFunc) http.HandlerFunc {
	limited := s.passwordWork(next)
	return func(w http.ResponseWriter, r *http.Request) {
		expected := ""
		if v, ok := s.lookup(r); ok {
			expected = v.CSRF
		} else if c, e := r.Cookie(preauthCookie); e == nil {
			expected = c.Value
		}
		if !s.sameOrigin(r) {
			fail(w, 403, "origin", "This address is not allowed. Check HomeGrid's reverse proxy configuration.")
			return
		}
		if !validCSRF(expected, r.Header.Get("X-CSRF-Token")) {
			fail(w, 403, "csrf", "Refresh the page and try again")
			return
		}
		limited(w, r)
	}
}
