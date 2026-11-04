package server

import (
	"bytes"
	"compress/gzip"
	"io/fs"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

// staticAsset is created during server construction and never modified afterward.
type staticAsset struct {
	identity, compressed []byte
	contentType          string
}

func (s *Server) cacheStatic() error {
	cached := map[string]staticAsset{}
	err := fs.WalkDir(s.assets, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name != "." && strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		contentType := ""
		switch path.Ext(name) {
		case ".js":
			contentType = "text/javascript; charset=utf-8"
		case ".css":
			contentType = "text/css; charset=utf-8"
		default:
			return nil
		}
		original, err := fs.ReadFile(s.assets, name)
		if err != nil {
			return err
		}
		var compressed bytes.Buffer
		writer, err := gzip.NewWriterLevel(&compressed, gzip.BestCompression)
		if err != nil {
			return err
		}
		if _, err = writer.Write(original); err != nil {
			return err
		}
		if err = writer.Close(); err != nil {
			return err
		}
		cached[name] = staticAsset{identity: original, compressed: compressed.Bytes(), contentType: contentType}
		return nil
	})
	if err != nil {
		return err
	}
	s.static = cached
	return nil
}
func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request, name string, asset staticAsset) {
	w.Header().Add("Vary", "Accept-Encoding")
	compressed, acceptable := negotiateStaticEncoding(strings.Join(r.Header.Values("Accept-Encoding"), ","), r.Header.Get("Range") != "")
	if !acceptable {
		fail(w, http.StatusNotAcceptable, "encoding", "No acceptable static asset encoding")
		return
	}
	body := asset.identity
	if compressed {
		body = asset.compressed
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.Header().Set("Content-Type", asset.contentType)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(body))
}

// Prefer the higher quality representation, with gzip as the server preference
// when qualities are equal. An explicit coding overrides the wildcard.
func negotiateStaticEncoding(header string, identityOnly bool) (compressed, acceptable bool) {
	quality := map[string]int{}
	for _, entry := range strings.Split(header, ",") {
		parts := strings.Split(entry, ";")
		coding := strings.ToLower(strings.TrimSpace(parts[0]))
		if coding != "gzip" && coding != "identity" && coding != "*" {
			continue
		}
		q := 1000
		hasQ := false
		for _, parameter := range parts[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if strings.EqualFold(strings.TrimSpace(key), "q") {
				valueQ := 0
				if ok {
					valueQ = parseEncodingQuality(strings.TrimSpace(value))
				}
				if !hasQ || valueQ < q {
					q = valueQ
				}
				hasQ = true
			}
		}
		if previous, exists := quality[coding]; !exists || q < previous {
			quality[coding] = q
		}
	}
	gzipQ := 0
	if q, ok := quality["*"]; ok {
		gzipQ = q
	}
	if q, ok := quality["gzip"]; ok {
		gzipQ = q
	}
	identityQ := 1000
	if q, exists := quality["*"]; exists && q == 0 {
		identityQ = 0
	}
	if q, ok := quality["identity"]; ok {
		identityQ = q
	}
	if identityOnly {
		return false, identityQ > 0
	}
	if gzipQ > 0 && gzipQ >= identityQ {
		return true, true
	}
	return false, identityQ > 0
}
func parseEncodingQuality(value string) int {
	whole, fraction, hasDecimal := strings.Cut(value, ".")
	if whole != "0" && whole != "1" {
		return 0
	}
	if hasDecimal && len(fraction) > 3 {
		return 0
	}
	for _, c := range fraction {
		if c < '0' || c > '9' || whole == "1" && c != '0' {
			return 0
		}
	}
	q := 0
	if whole == "1" {
		return 1000
	}
	if fraction != "" {
		n, err := strconv.Atoi(fraction)
		if err != nil {
			return 0
		}
		q = n
		for i := len(fraction); i < 3; i++ {
			q *= 10
		}
	}
	return q
}
