package server

import (
	"errors"
	"github.com/bifrost0x/homegrid/internal/auth"
	"github.com/bifrost0x/homegrid/internal/store"
	"net/http"
	"time"
)

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
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !decode(w, r, &body, 16<<10) {
		return
	}
	if len(body.CurrentPassword) < 1 || len(body.CurrentPassword) > 1024 {
		fail(w, 400, "validation", "Enter your current password (at most 1024 bytes)")
		return
	}
	if len(body.NewPassword) < 12 || len(body.NewPassword) > 1024 {
		fail(w, 400, "validation", "Use a new password with 12–1024 bytes")
		return
	}
	var currentHash string
	if e := s.cfg.Store.DB.QueryRowContext(r.Context(), "SELECT password_hash FROM users WHERE id=1").Scan(&currentHash); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if !auth.Verify(currentHash, body.CurrentPassword) {
		fail(w, 400, "validation", "Current password is incorrect")
		return
	}
	newHash, e := auth.Hash(body.NewPassword)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	session := r.Context().Value(identityKey{}).(identity)
	token, csrf := auth.Token(), auth.Token()
	e = s.cfg.Store.RotatePassword(r.Context(), currentHash, newHash, session.Hash, auth.TokenHash(token), csrf, time.Now().Unix())
	if errors.Is(e, store.ErrInvalidPasswordChange) {
		fail(w, 400, "validation", "Your password or session changed. Refresh the page and try again.")
		return
	}
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	s.cookie(w, sessionCookie, token, 86400)
	s.cookie(w, preauthCookie, "", -1)
	write(w, 200, map[string]any{"setup_required": false, "authenticated": true, "username": session.Username, "csrf_token": csrf})
}
