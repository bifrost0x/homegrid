package server

import (
	"bytes"
	"compress/gzip"
	"github.com/bifrost0x/homegrid/internal/store"
	"io"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
)

func staticTestServer(t *testing.T) *Server {
	t.Helper()
	db, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	assets := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><h1>HomeGrid</h1>")}, "assets/app.js": {Data: []byte(strings.Repeat("console.log('homegrid');", 100))}, "assets/app.css": {Data: []byte(strings.Repeat(".card {color: red;} ", 100))}, "public.txt": {Data: []byte("public text")}}
	s, e := New(Config{Store: db, Assets: assets})
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func staticResponse(s *Server, method, path, encoding, rangeValue string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	if encoding != "" {
		r.Header.Set("Accept-Encoding", encoding)
	}
	if rangeValue != "" {
		r.Header.Set("Range", rangeValue)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestStaticGzipNegotiationAndHeaders(t *testing.T) {
	s := staticTestServer(t)
	for _, tc := range []struct {
		encoding string
		gzip     bool
		status   int
	}{{"gzip", true, 200}, {"br, gzip", true, 200}, {"gzip;q=0", false, 200}, {"*;q=1", true, 200}, {"gzip;q=0, *;q=1", false, 200}, {"*;q=0, gzip;q=1", true, 200}, {"gzip;q=0.4, identity;q=0.8", false, 200}, {"gzip;q=0.9, identity;q=0.2", true, 200}, {"gzip;q=0, identity;q=0", false, 406}, {"*;q=0", false, 406}, {"", false, 200}, {"br", false, 200}} {
		t.Run(tc.encoding, func(t *testing.T) {
			w := staticResponse(s, "GET", "/assets/app.js", tc.encoding, "")
			if w.Code != tc.status {
				t.Fatalf("status %d want %d", w.Code, tc.status)
			}
			if (w.Header().Get("Content-Encoding") == "gzip") != tc.gzip {
				t.Fatalf("encoding %q: headers %v", tc.encoding, w.Header())
			}
			if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
				t.Fatal("missing Vary", w.Header())
			}
			if tc.status != 200 {
				return
			}
			var body []byte
			var e error
			if tc.gzip {
				reader, err := gzip.NewReader(w.Body)
				if err != nil {
					t.Fatal(err)
				}
				body, e = io.ReadAll(reader)
				reader.Close()
			} else {
				body = w.Body.Bytes()
			}
			if e != nil || !bytes.Contains(body, []byte("console.log")) {
				t.Fatal("invalid response representation", e)
			}
			if w.Header().Get("Content-Type") != "text/javascript; charset=utf-8" || w.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(w.Header().Get("Cache-Control"), "public") {
				t.Fatal(w.Header())
			}
		})
	}
}
func TestStaticGzipHEADRangeAndExclusions(t *testing.T) {
	s := staticTestServer(t)
	get := staticResponse(s, "GET", "/assets/app.css", "gzip", "")
	head := staticResponse(s, "HEAD", "/assets/app.css", "gzip", "")
	if get.Header().Get("Content-Encoding") != "gzip" || head.Header().Get("Content-Encoding") != "gzip" || head.Body.Len() != 0 || head.Header().Get("Content-Length") != get.Header().Get("Content-Length") {
		t.Fatal("HEAD differs from GET", get.Header(), head.Header(), head.Body.Len())
	}
	ranged := staticResponse(s, "GET", "/assets/app.css", "gzip", "bytes=0-5")
	if ranged.Code != 206 || ranged.Header().Get("Content-Encoding") != "" || ranged.Body.String() != ".card " {
		t.Fatal("range is not identity", ranged.Code, ranged.Header(), ranged.Body.String())
	}
	for _, path := range []string{"/", "/settings", "/public.txt", "/api/auth/session", "/api/health", "/api/export", "/uploads/invalid.png"} {
		w := staticResponse(s, "GET", path, "gzip", "")
		if w.Header().Get("Content-Encoding") != "" {
			t.Fatal("sensitive or non-JS/CSS response compressed", path, w.Header())
		}
	}
	w := staticResponse(s, "GET", "/.hidden", "gzip", "")
	if w.Code != 404 {
		t.Fatal("hidden file exposed", w.Code)
	}
}

type countingStaticFS struct {
	fstest.MapFS
	reads atomic.Int64
}

func (f *countingStaticFS) ReadFile(name string) ([]byte, error) {
	f.reads.Add(1)
	return f.MapFS.ReadFile(name)
}
func TestStaticCacheBuiltOnceAndReadConcurrently(t *testing.T) {
	db, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	source := strings.Repeat("console.log('first server');", 80)
	files := &countingStaticFS{MapFS: fstest.MapFS{"assets/app.js": {Data: []byte(source)}, "assets/app.css": {Data: []byte(".card {color:blue}")}}}
	s, e := New(Config{Store: db, Assets: files})
	if e != nil {
		t.Fatal(e)
	}
	if files.reads.Load() != 2 {
		t.Fatal("assets not cached at construction", files.reads.Load())
	}
	var wg sync.WaitGroup
	problems := make(chan string, 64)
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			encoding := "gzip"
			if i%2 != 0 {
				encoding = "identity"
			}
			w := staticResponse(s, "GET", "/assets/app.js", encoding, "")
			body := w.Body.Bytes()
			if encoding == "gzip" {
				reader, e := gzip.NewReader(bytes.NewReader(body))
				if e != nil {
					problems <- e.Error()
					return
				}
				body, e = io.ReadAll(reader)
				reader.Close()
				if e != nil {
					problems <- e.Error()
					return
				}
			}
			if w.Code != 200 || string(body) != source {
				problems <- "cached representation corrupted"
			}
		}(i)
	}
	wg.Wait()
	close(problems)
	for problem := range problems {
		t.Error(problem)
	}
	if files.reads.Load() != 2 {
		t.Fatal("request reread or recompressed source", files.reads.Load())
	}
	files.MapFS["assets/app.js"] = &fstest.MapFile{Data: []byte("second server")}
	second, e := New(Config{Store: db, Assets: files})
	if e != nil {
		t.Fatal(e)
	}
	if w := staticResponse(second, "GET", "/assets/app.js", "identity", ""); w.Body.String() != "second server" {
		t.Fatal("server caches share state")
	}
	if w := staticResponse(s, "GET", "/assets/app.js", "identity", ""); w.Body.String() != source {
		t.Fatal("first server cache changed")
	}
}
func TestEncodingQualityEdges(t *testing.T) {
	for _, tc := range []struct {
		header                         string
		rangeRequest, gzip, acceptable bool
	}{{"GZIP;Q=1", false, true, true}, {"gzip;q=0.000", false, false, true}, {"gzip;q=bogus", false, false, true}, {"gzip;q=1.001", false, false, true}, {"gzip;q=0.1234", false, false, true}, {"gzip;q=0, gzip;q=1", false, false, true}, {"gzip;q=0.001, identity;q=0", false, true, true}, {"gzip;q=1, identity;q=0", true, false, false}, {"*;q=0, identity;q=0.1", false, false, true}} {
		t.Run(tc.header, func(t *testing.T) {
			gzip, acceptable := negotiateStaticEncoding(tc.header, tc.rangeRequest)
			if gzip != tc.gzip || acceptable != tc.acceptable {
				t.Fatal(gzip, acceptable)
			}
		})
	}
}
func TestAuthenticatedContentNeverCompressed(t *testing.T) {
	s := staticTestServer(t)
	c := &client{t: t, h: s}
	c.setup()
	for _, path := range []string{"/api/export", "/api/apps", "/api/settings", "/api/auth/session"} {
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Accept-Encoding", "gzip")
		for _, cookie := range c.cookies {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 200 || w.Header().Get("Content-Encoding") != "" || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private content response changed", path, w.Code, w.Header())
		}
	}
}
func TestWebAppManifestIsPublicWithManifestType(t *testing.T) {
	db, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	assets := fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}, "manifest.webmanifest": {Data: []byte(`{"name":"HomeGrid"}`)}, "icons/icon-192.png": {Data: []byte("\x89PNG\r\n\x1a\n")}, "favicon.ico": {Data: []byte("\x00\x00\x01\x00")}}
	s, e := New(Config{Store: db, Assets: assets})
	if e != nil {
		t.Fatal(e)
	}
	// Browsers fetch manifests and icons without credentials.
	w := staticResponse(s, "GET", "/manifest.webmanifest", "", "")
	if w.Code != 200 || w.Header().Get("Content-Type") != "application/manifest+json" || w.Header().Get("Cache-Control") != "no-cache" || w.Body.String() != `{"name":"HomeGrid"}` {
		t.Fatal(w.Code, w.Header(), w.Body.String())
	}
	if w = staticResponse(s, "GET", "/icons/icon-192.png", "", ""); w.Code != 200 || w.Header().Get("Content-Type") != "image/png" {
		t.Fatal(w.Code, w.Header())
	}
	// Clients that only request /favicon.ico get the icon without signing in.
	if w = staticResponse(s, "GET", "/favicon.ico", "", ""); w.Code != 200 || w.Header().Get("Content-Type") != "image/x-icon" {
		t.Fatal(w.Code, w.Header())
	}
}
