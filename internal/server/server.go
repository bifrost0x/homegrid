package server

import (
	"errors"
	"github.com/bifrost0x/homegrid/internal/icondiscovery"
	"github.com/bifrost0x/homegrid/internal/status"
	"github.com/bifrost0x/homegrid/internal/store"
	"github.com/bifrost0x/homegrid/web"
	"io/fs"
	"log/slog"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

type Config struct {
	Store           *store.Store
	DataDir         string
	SecureCookie    bool
	TrustedProxies  []netip.Prefix
	Version, Commit string
	Logger          *slog.Logger
	Assets          fs.FS
	// IconPolicy limits which addresses icon discovery may contact; nil uses
	// icondiscovery.DefaultPolicy. Tests use it to reach local test servers.
	IconPolicy icondiscovery.AddressPolicy
	// StatusPolicy does the same for status checks; nil uses
	// icondiscovery.DefaultPolicy.
	StatusPolicy status.AddressPolicy
}
type Server struct {
	cfg           Config
	mux           *http.ServeMux
	limiter       *rateLimiter
	passwordSlots chan struct{}
	imageSlots    chan struct{}
	assets        fs.FS
	static        map[string]staticAsset
	icons         *icondiscovery.Fetcher
	status        *status.Checker
	// uploadsMu serializes upload cleanups.
	uploadsMu sync.Mutex
	// proxyWarning logs an untrusted forwarding proxy once per process.
	proxyWarning sync.Once
}

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
	policy := cfg.IconPolicy
	if policy == nil {
		policy = icondiscovery.DefaultPolicy
	}
	s.icons = icondiscovery.New(policy)
	statusPolicy := cfg.StatusPolicy
	if statusPolicy == nil {
		statusPolicy = status.AddressPolicy(icondiscovery.DefaultPolicy)
	}
	s.status = status.New(statusPolicy)
	s.routes()
	s.removeStaleUploadTemps(time.Now().Add(-time.Hour))
	return s, nil
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.securityHeaders(w, r)
	defer s.recoverPanic(w, r)
	if forwarded(r) && !s.trusted(remoteIP(r)) {
		s.proxyWarning.Do(func() {
			s.cfg.Logger.Warn("request forwarded by an untrusted proxy; rate limits apply to the proxy address. Add it to HOMEGRID_TRUSTED_PROXIES if you control it.", "proxy", remoteIP(r))
		})
	}
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
	s.mux.HandleFunc("GET /api/status", s.protected(s.serviceStatus))
	s.mux.HandleFunc("GET /api/settings", s.protected(s.settings))
	s.mux.HandleFunc("PATCH /api/settings", s.protected(s.settings))
	s.mux.HandleFunc("POST /api/uploads", s.protected(s.upload))
	s.mux.HandleFunc("GET /api/uploads/unused", s.protected(s.listUnusedUploads))
	s.mux.HandleFunc("POST /api/uploads/cleanup", s.protected(s.cleanUploads))
	s.mux.HandleFunc("GET /api/diagnostics", s.protected(s.diagnostics))
	s.mux.HandleFunc("POST /api/icons/discover", s.protected(s.discoverIcon))
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
