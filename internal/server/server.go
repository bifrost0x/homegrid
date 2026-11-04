package server

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/bifrost0x/homegrid/internal/auth"
	"github.com/bifrost0x/homegrid/internal/store"
	"github.com/bifrost0x/homegrid/web"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

const sessionCookie = "homegrid_session"
const preauthCookie = "homegrid_csrf"

type Config struct {
	Store           *store.Store
	DataDir         string
	SecureCookie    bool
	TrustedProxies  []netip.Prefix
	Version, Commit string
	Logger          *slog.Logger
	Assets          fs.FS
}
type Server struct {
	cfg           Config
	mux           *http.ServeMux
	limiter       *rateLimiter
	passwordSlots chan struct{}
	imageSlots    chan struct{}
	assets        fs.FS
	static        map[string]staticAsset
}
type identity struct{ Username, CSRF, Hash string }
type identityKey struct{}

func New(cfg Config) (*Server, error) {
	if cfg.Store == nil {
		return nil, errors.New("store is required")
	}
	if cfg.DataDir == "" {
		cfg.DataDir = cfg.Store.DataDir
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	assets := cfg.Assets
	if assets == nil {
		assets = web.Assets()
	}
	s := &Server{cfg: cfg, mux: http.NewServeMux(), limiter: &rateLimiter{entries: map[string]attempts{}}, passwordSlots: make(chan struct{}, 2), imageSlots: make(chan struct{}, 2), assets: assets}
	if err := s.cacheStatic(); err != nil {
		return nil, err
	}
	s.routes()
	return s, nil
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
	defer func() {
		if v := recover(); v != nil {
			s.cfg.Logger.Error("request panic", "method", r.Method, "path", r.URL.Path)
			fail(w, 500, "internal", "An internal error occurred")
		}
	}()
	s.mux.ServeHTTP(w, r)
}
func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		write(w, 200, map[string]string{"status": "ok", "version": s.cfg.Version, "commit": s.cfg.Commit})
	})
	s.mux.HandleFunc("GET /api/auth/session", s.session)
	s.mux.HandleFunc("POST /api/auth/setup", s.preAuth(s.setup))
	s.mux.HandleFunc("POST /api/auth/login", s.preAuth(s.login))
	s.mux.HandleFunc("POST /api/auth/logout", s.protected(s.logout))
	s.mux.HandleFunc("POST /api/auth/password", s.protected(s.passwordWork(s.changePassword)))
	s.mux.HandleFunc("GET /api/apps", s.protected(s.listApps))
	s.mux.HandleFunc("POST /api/apps", s.protected(s.saveApp))
	s.mux.HandleFunc("PATCH /api/apps/{id}", s.protected(s.saveApp))
	s.mux.HandleFunc("DELETE /api/apps/{id}", s.protected(s.deleteResource))
	s.mux.HandleFunc("PUT /api/apps/reorder", s.protected(s.reorder))
	s.mux.HandleFunc("GET /api/categories", s.protected(s.listCategories))
	s.mux.HandleFunc("POST /api/categories", s.protected(s.saveCategory))
	s.mux.HandleFunc("PATCH /api/categories/{id}", s.protected(s.saveCategory))
	s.mux.HandleFunc("DELETE /api/categories/{id}", s.protected(s.deleteResource))
	s.mux.HandleFunc("PUT /api/categories/reorder", s.protected(s.reorder))
	s.mux.HandleFunc("GET /api/undo", s.protected(s.pendingUndo))
	s.mux.HandleFunc("POST /api/undo", s.protected(s.undo))
	s.mux.HandleFunc("POST /api/examples", s.protected(s.examples))
	s.mux.HandleFunc("GET /api/settings", s.protected(s.settings))
	s.mux.HandleFunc("PATCH /api/settings", s.protected(s.settings))
	s.mux.HandleFunc("POST /api/uploads", s.protected(s.upload))
	s.mux.HandleFunc("GET /uploads/{name}", s.protected(s.serveUpload))
	s.mux.HandleFunc("GET /api/export", s.protected(s.export))
	s.mux.HandleFunc("POST /api/import/preview", s.protected(s.preview))
	s.mux.HandleFunc("POST /api/import/apply", s.protected(s.applyImport))
	s.mux.HandleFunc("/api/", s.apiFallback)
	s.mux.HandleFunc("/", s.frontend)
}

func (s *Server) apiFallback(w http.ResponseWriter, r *http.Request) {
	probe := r.Clone(r.Context())
	allowed := []string{}
	for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} {
		probe.Method = method
		_, pattern := s.mux.Handler(probe)
		if pattern != "/api/" && pattern != "/" && pattern != "" {
			allowed = append(allowed, method)
		}
	}
	if len(allowed) > 0 {
		w.Header().Set("Allow", strings.Join(allowed, ", "))
		fail(w, 405, "method_not_allowed", "Method not allowed")
		return
	}
	fail(w, 404, "not_found", "Endpoint not found")
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
func fail(w http.ResponseWriter, status int, code, message string) {
	write(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func (s *Server) result(w http.ResponseWriter, status int, v any, e error) {
	if e == nil {
		write(w, status, v)
		return
	}
	if errors.Is(e, store.ErrInvalid) {
		fail(w, 400, "validation", strings.TrimPrefix(e.Error(), "invalid resource: "))
		return
	}
	if errors.Is(e, store.ErrConflict) {
		fail(w, 409, "conflict", e.Error())
		return
	}
	if errors.Is(e, store.ErrNotFound) || errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "not_found", "Resource not found")
		return
	}
	s.cfg.Logger.Error("database operation failed", "error", e)
	fail(w, 500, "internal", "Unable to complete the request")
}
func decode(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	ct := strings.Split(r.Header.Get("Content-Type"), ";")[0]
	if ct != "application/json" {
		fail(w, 415, "content_type", "Use application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		var large *http.MaxBytesError
		if errors.As(e, &large) {
			fail(w, 413, "too_large", "Request body is too large")
		} else {
			fail(w, 400, "validation", "Invalid JSON request: "+e.Error())
		}
		return false
	}
	if e := d.Decode(new(any)); e != io.EOF {
		fail(w, 400, "validation", "Send one JSON object")
		return false
	}
	return true
}
func (s *Server) lookup(r *http.Request) (identity, bool) {
	c, e := r.Cookie(sessionCookie)
	if e != nil || len(c.Value) != 64 {
		return identity{}, false
	}
	var v identity
	v.Hash = auth.TokenHash(c.Value)
	e = s.cfg.Store.DB.QueryRowContext(r.Context(), "SELECT users.username,sessions.csrf_token FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?", v.Hash, time.Now().Unix()).Scan(&v.Username, &v.CSRF)
	return v, e == nil
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
func (s *Server) cookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookie, SameSite: http.SameSiteStrictMode, MaxAge: maxAge})
}
func (s *Server) setupRequired(ctx context.Context) (bool, error) {
	var n int
	e := s.cfg.Store.DB.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n)
	return n == 0, e
}
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	required, e := s.setupRequired(r.Context())
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
	required, e := s.setupRequired(r.Context())
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
	tx, e := s.cfg.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	defer tx.Rollback()
	var n int
	if e = tx.QueryRowContext(r.Context(), "SELECT count(*) FROM users").Scan(&n); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if n != 0 {
		fail(w, 409, "setup_complete", "Administrator is already configured")
		return
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO users(id,username,password_hash) VALUES(1,?,?)", username, hash); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if e = tx.Commit(); e != nil {
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
	var stored, hash string
	e := s.cfg.Store.DB.QueryRowContext(r.Context(), "SELECT username,password_hash FROM users WHERE id=1").Scan(&stored, &hash)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		s.result(w, 0, nil, e)
		return
	}
	if hash == "" {
		hash = "$argon2id$v=19$m=65536,t=2,p=2$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
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
	tx, e := s.cfg.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	defer tx.Rollback()
	var currentHash string
	if e = tx.QueryRowContext(r.Context(), "SELECT password_hash FROM users WHERE id=1").Scan(&currentHash); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if currentHash != expectedPasswordHash {
		fail(w, 401, "credentials", "Password changed. Sign in again.")
		return
	}
	now := time.Now().Unix()
	if _, e = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE expires_at<=?", now); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if old, e := r.Cookie(sessionCookie); e == nil {
		if _, e = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=?", auth.TokenHash(old.Value)); e != nil {
			s.result(w, 0, nil, e)
			return
		}
	}
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,1,?,?,?)", auth.TokenHash(token), csrf, now+86400, now); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if _, e = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT -1 OFFSET 100)"); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	if e = tx.Commit(); e != nil {
		s.result(w, 0, nil, e)
		return
	}
	s.cookie(w, sessionCookie, token, 86400)
	s.cookie(w, preauthCookie, "", -1)
	write(w, status, map[string]any{"setup_required": false, "authenticated": true, "username": username, "csrf_token": csrf})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	v := r.Context().Value(identityKey{}).(identity)
	_, e := s.cfg.Store.DB.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=?", v.Hash)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	s.cookie(w, sessionCookie, "", -1)
	w.WriteHeader(204)
}
func (s *Server) listApps(w http.ResponseWriter, r *http.Request) {
	v, e := s.cfg.Store.Apps(r.Context())
	s.result(w, 200, v, e)
}
func (s *Server) listCategories(w http.ResponseWriter, r *http.Request) {
	v, e := s.cfg.Store.Categories(r.Context())
	s.result(w, 200, v, e)
}
func id(w http.ResponseWriter, r *http.Request) (int64, bool) {
	v, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || v < 1 {
		fail(w, 400, "validation", "Invalid resource ID")
		return 0, false
	}
	return v, true
}
func (s *Server) saveApp(w http.ResponseWriter, r *http.Request) {
	v := store.App{CategoryID: 1, OpenInNewTab: true}
	if !decode(w, r, &v, 1<<20) {
		return
	}
	create := r.Method == "POST"
	status := 200
	if create {
		status = 201
		v.ID = 0
	} else {
		n, ok := id(w, r)
		if !ok {
			return
		}
		v.ID = n
	}
	a, e := s.cfg.Store.SaveApp(r.Context(), v, create)
	s.result(w, status, a, e)
}
func (s *Server) saveCategory(w http.ResponseWriter, r *http.Request) {
	var v store.Category
	if !decode(w, r, &v, 1<<20) {
		return
	}
	create := r.Method == "POST"
	status := 200
	if create {
		status = 201
		v.ID = 0
	} else {
		n, ok := id(w, r)
		if !ok {
			return
		}
		v.ID = n
	}
	c, e := s.cfg.Store.SaveCategory(r.Context(), v, create)
	s.result(w, status, c, e)
}
func resourceKind(r *http.Request) string {
	if strings.HasPrefix(r.URL.Path, "/api/categories") {
		return "categories"
	}
	return "applications"
}
func (s *Server) deleteResource(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	var e error
	if resourceKind(r) == "applications" {
		var token string
		token, e = s.cfg.Store.DeleteAppWithUndo(r.Context(), n)
		if e == nil {
			w.Header().Set("X-HomeGrid-Undo", token)
		}
	} else {
		e = s.cfg.Store.Delete(r.Context(), resourceKind(r), n)
	}
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) reorder(w http.ResponseWriter, r *http.Request) {
	var v struct {
		IDs  []int64        `json:"ids"`
		Move *store.AppMove `json:"move"`
	}
	if !decode(w, r, &v, 1<<20) {
		return
	}
	var moves []store.AppMove
	if v.Move != nil {
		moves = append(moves, *v.Move)
	}
	token, e := s.cfg.Store.ReorderWithUndo(r.Context(), resourceKind(r), v.IDs, moves...)
	if e == nil {
		w.Header().Set("X-HomeGrid-Undo", token)
	}
	s.result(w, 200, map[string]bool{"ok": true}, e)
}
func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" || r.Method == "HEAD" {
		v, e := s.cfg.Store.Settings(r.Context())
		s.result(w, 200, v, e)
		return
	}
	var v store.Settings
	if !decode(w, r, &v, 1<<20) {
		return
	}
	v, token, e := s.cfg.Store.SaveSettingsWithUndo(r.Context(), v)
	if e == nil {
		w.Header().Set("X-HomeGrid-Undo", token)
	}
	s.result(w, 200, v, e)
}
func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	v, e := s.cfg.Store.Export(r.Context())
	w.Header().Set("Content-Disposition", `attachment; filename="homegrid-backup.json"`)
	s.result(w, 200, v, e)
}
func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	var raw json.RawMessage
	if !decode(w, r, &raw, 5<<20) {
		return
	}
	v, e := store.ParseImport(raw)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	p, e := s.cfg.Store.Preview(r.Context(), v)
	s.result(w, 200, p, e)
}
func (s *Server) applyImport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Data    json.RawMessage `json:"data"`
		Mode    string          `json:"mode"`
		Confirm bool            `json:"confirm"`
	}
	if !decode(w, r, &body, 5<<20) {
		return
	}
	if !body.Confirm || (body.Mode != "merge" && body.Mode != "replace") {
		fail(w, 400, "validation", "Choose merge or replace and explicitly confirm the import")
		return
	}
	v, e := store.ParseImport(body.Data)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	n, e := s.cfg.Store.Import(r.Context(), v, body.Mode == "replace")
	s.result(w, 200, map[string]int{"imported": n}, e)
}
func (s *Server) frontend(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		w.Header().Set("Allow", "GET, HEAD")
		fail(w, 405, "method_not_allowed", "Method not allowed")
		return
	}
	p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if p == "" {
		p = "index.html"
	}
	if strings.HasPrefix(p, ".") {
		http.NotFound(w, r)
		return
	}
	if asset, ok := s.static[p]; ok {
		s.serveStatic(w, r, p, asset)
		return
	}
	b, e := fs.ReadFile(s.assets, p)
	if e != nil {
		if strings.Contains(path.Base(p), ".") {
			http.NotFound(w, r)
			return
		}
		b, e = fs.ReadFile(s.assets, "index.html")
	}
	if e != nil {
		http.Error(w, "Build the frontend with npm ci and npm run build in frontend/ before starting HomeGrid.", 503)
		return
	}
	if path.Ext(p) == ".html" || e == nil && path.Ext(p) == "" {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	http.ServeContent(w, r, p, time.Time{}, strings.NewReader(string(b)))
}

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
