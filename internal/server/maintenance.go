package server

import (
	"errors"
	"fmt"
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

// unusedUploads lists stored images that are not in refs and that are older
// than uploadGrace.
func (s *Server) unusedUploads(refs map[string]bool) ([]unusedUpload, error) {
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
	refs, e := s.cfg.Store.ReferencedUploads(r.Context())
	if e != nil {
		s.result(w, 0, nil, e)
		return
	}
	files, e := s.unusedUploads(refs)
	s.result(w, 200, map[string]any{"files": files}, e)
}

// cleanUploads deletes the reviewed files that are still unused. References
// are read and files deleted inside one store transaction, so no save,
// import or undo can start using a file while it is being removed.
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
	// The request only selects files; every path comes from the server's own
	// listing of unused uploads, never from the request.
	selected := make(map[string]bool, len(body.Names))
	for _, name := range body.Names {
		selected[name] = true
	}
	s.uploadsMu.Lock()
	defer s.uploadsMu.Unlock()
	dir := filepath.Join(s.cfg.DataDir, "uploads")
	deleted := 0
	e := s.cfg.Store.WithUploadReferences(r.Context(), func(refs map[string]bool) error {
		unused, e := s.unusedUploads(refs)
		if e != nil {
			return e
		}
		for _, f := range unused {
			if !selected[f.Name] {
				continue
			}
			path := filepath.Join(dir, f.Name)
			if e := os.Remove(path); e != nil && !errors.Is(e, fs.ErrNotExist) {
				return fmt.Errorf("delete unused upload %s: %w", f.Name, e)
			}
			deleted++
		}
		return nil
	})
	if e != nil {
		s.cfg.Logger.Error("unable to clean up unused uploads", "error", e)
		fail(w, 500, "internal", "Some images could not be deleted")
		return
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
