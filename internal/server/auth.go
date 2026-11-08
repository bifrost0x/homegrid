package server

import (
	"database/sql"
	"errors"
	"github.com/bifrost0x/homegrid/internal/auth"
	"github.com/bifrost0x/homegrid/internal/store"
	"net/http"
	"strings"
	"time"
)

const sessionCookie = "homegrid_session"
const preauthCookie = "homegrid_csrf"

// dummyHash keeps failed logins before setup as slow as a real verification.
const dummyHash = "$argon2id$v=19$m=65536,t=2,p=2$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

type identity struct{ Username, CSRF, Hash string }
type identityKey struct{}

func (s *Server) lookup(r *http.Request) (identity, bool) {
	c, e := r.Cookie(sessionCookie)
	if e != nil || len(c.Value) != 64 {
		return identity{}, false
	}
	var v identity
	v.Hash = auth.TokenHash(c.Value)
	v.Username, v.CSRF, e = s.cfg.Store.SessionByTokenHash(r.Context(), v.Hash, time.Now().Unix())
	return v, e == nil
}
func (s *Server) cookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookie, SameSite: http.SameSiteStrictMode, MaxAge: maxAge})
}
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	required, e := s.cfg.Store.SetupRequired(r.Context())
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if v, ok := s.lookup(r); ok {
		write(w, 200, map[string]any{"setup_required": required, "authenticated": true, "username": v.Username, "csrf_token": v.CSRF})
		return
	}
	token := ""
	if c, e := r.Cookie(preauthCookie); e == nil && len(c.Value) == 64 {
		token = c.Value
	}
	if token == "" {
		token = auth.Token()
		s.cookie(w, preauthCookie, token, 3600)
	}
	write(w, 200, map[string]any{"setup_required": required, "authenticated": false, "username": "", "csrf_token": token})
}
func credentials(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	var c struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &c, 8192) {
		return "", "", false
	}
	c.Username = strings.TrimSpace(c.Username)
	if len(c.Username) < 1 || len(c.Username) > 64 || strings.ContainsAny(c.Username, "\r\n\x00") || len(c.Password) > 1024 {
		fail(w, 400, "validation", "Enter a username (1–64 characters) and a password of at most 1024 bytes")
		return "", "", false
	}
	return c.Username, c.Password, true
}
func (s *Server) setup(w http.ResponseWriter, r *http.Request) {
	required, e := s.cfg.Store.SetupRequired(r.Context())
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if !required {
		fail(w, 409, "setup_complete", "Administrator is already configured")
		return
	}
	username, password, ok := credentials(w, r)
	if !ok {
		return
	}
	if len(password) < 12 {
		fail(w, 400, "validation", "Use a password with at least 12 characters")
		return
	}
	hash, e := auth.Hash(password)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	e = s.cfg.Store.CreateAdministrator(r.Context(), username, hash)
	if errors.Is(e, store.ErrSetupComplete) {
		fail(w, 409, "setup_complete", "Administrator is already configured")
		return
	}
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	s.newSession(w, r, username, 201, hash)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	username, password, ok := credentials(w, r)
	if !ok {
		return
	}
	stored, hash, e := s.cfg.Store.Credentials(r.Context())
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		s.result(w, 0, nil, e)
		return
	}
	if hash == "" {
		hash = dummyHash
	}
	valid := auth.Verify(hash, password)
	if !valid || username != stored {
		fail(w, 401, "credentials", "Invalid username or password")
		return
	}
	s.newSession(w, r, stored, 200, hash)
}
func (s *Server) newSession(w http.ResponseWriter, r *http.Request, username string, status int, expectedPasswordHash string) {
	token, csrf := auth.Token(), auth.Token()
	replaced := ""
	if old, e := r.Cookie(sessionCookie); e == nil {
		replaced = auth.TokenHash(old.Value)
	}
	e := s.cfg.Store.CreateSession(r.Context(), expectedPasswordHash, replaced, auth.TokenHash(token), csrf, time.Now().Unix())
	if errors.Is(e, store.ErrPasswordChanged) {
		fail(w, 401, "credentials", "Password changed. Sign in again.")
		return
	}
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	s.cookie(w, sessionCookie, token, 86400)
	s.cookie(w, preauthCookie, "", -1)
	write(w, status, map[string]any{"setup_required": false, "authenticated": true, "username": username, "csrf_token": csrf})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	v := r.Context().Value(identityKey{}).(identity)
	if e := s.cfg.Store.DeleteSession(r.Context(), v.Hash); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	s.cookie(w, sessionCookie, "", -1)
	w.WriteHeader(204)
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
	currentHash, e := s.cfg.Store.PasswordHash(r.Context())
	if e != nil {
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
