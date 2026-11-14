package server

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/bifrost0x/homegrid/internal/store"
)

// uploadGrace keeps recent uploads out of cleanup: an icon or background is
// uploaded before the application or settings that refer to it are saved, and
// an edit form may stay open for a while in between.
const uploadGrace = 24 * time.Hour

type unusedUpload struct {
	Name     string    `json:"name"`
	URL      string    `json:"url"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

// unusedUploads lists stored images that nothing refers to and that are
// older than uploadGrace.
func (s *Server) unusedUploads(r *http.Request) ([]unusedUpload, error) {
	refs, e := s.cfg.Store.ReferencedUploads(r.Context())
	if e != nil {
		return nil, e
	}
	entries, e := os.ReadDir(filepath.Join(s.cfg.DataDir, "uploads"))
	if errors.Is(e, fs.ErrNotExist) {
		return []unusedUpload{}, nil
	}
	if e != nil {
		return nil, e
	}
	cutoff := time.Now().Add(-uploadGrace)
	out := []unusedUpload{}
	for _, entry := range entries {
		name := entry.Name()
		if !entry.Type().IsRegular() || !store.ValidUpload("/uploads/"+name) || refs[name] {
			continue
		}
		info, e := entry.Info()
		if e != nil || info.ModTime().After(cutoff) {
			continue
		}
		out = append(out, unusedUpload{Name: name, URL: "/uploads/" + name, Size: info.Size(), Modified: info.ModTime().UTC()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified.Before(out[j].Modified) })
	return out, nil
}

func (s *Server) listUnusedUploads(w http.ResponseWriter, r *http.Request) {
	files, e := s.unusedUploads(r)
	s.result(w, 200, map[string]any{"files": files}, e)
}

// cleanUploads deletes the reviewed files that are still unused. Each name is
// checked again so a file that became referenced since the review is kept.
func (s *Server) cleanUploads(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Names   []string `json:"names"`
		Confirm bool     `json:"confirm"`
	}
	if !decode(w, r, &body, 1<<20) {
		return
	}
	if !body.Confirm || len(body.Names) == 0 || len(body.Names) > 10000 {
		fail(w, 400, "validation", "Review the unused images and confirm their deletion")
		return
	}
	s.uploadsMu.Lock()
	defer s.uploadsMu.Unlock()
	unused, e := s.unusedUploads(r)
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	// The request only selects files; every path comes from the server's own
	// listing of unused uploads, never from the request.
	selected := make(map[string]bool, len(body.Names))
	for _, name := range body.Names {
		selected[name] = true
	}
	dir := filepath.Join(s.cfg.DataDir, "uploads")
	deleted := 0
	for _, f := range unused {
		if !selected[f.Name] {
			continue
		}
		name := f.Name
		path := filepath.Join(dir, name)
		// Writes hold uploadsMu too, but check the file once more right
		// before removing it.
		if info, e := os.Lstat(path); e != nil || !info.Mode().IsRegular() || time.Since(info.ModTime()) < uploadGrace {
			continue
		}
		if e := os.Remove(path); e != nil && !errors.Is(e, fs.ErrNotExist) {
			s.cfg.Logger.Error("unable to delete unused upload", "name", name, "error", e)
			fail(w, 500, "internal", "Some images could not be deleted")
			return
		}
		deleted++
	}
	write(w, 200, map[string]int{"deleted": deleted})
}

// diagnostics reports deployment problems the administrator can fix. A request
// that carries forwarding headers from a peer outside HOMEGRID_TRUSTED_PROXIES
// means rate limits apply to the proxy address instead of the browser.
func (s *Server) diagnostics(w http.ResponseWriter, r *http.Request) {
	untrusted := ""
	if forwarded(r) && !s.trusted(remoteIP(r)) {
		untrusted = remoteIP(r)
	}
	write(w, 200, map[string]any{"untrusted_proxy": untrusted})
}

func forwarded(r *http.Request) bool {
	for _, h := range []string{"X-Forwarded-For", "X-Real-Ip", "Forwarded"} {
		if strings.TrimSpace(r.Header.Get(h)) != "" {
			return true
		}
	}
	return false
}
