package server

import (
	"bytes"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

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
	if path.Ext(p) == ".html" || path.Ext(p) == "" {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	http.ServeContent(w, r, p, time.Time{}, bytes.NewReader(b))
}
