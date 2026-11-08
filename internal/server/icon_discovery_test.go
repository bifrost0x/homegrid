package server

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bifrost0x/homegrid/internal/store"
)

func newIconClient(t *testing.T) (*client, *store.Store) {
	t.Helper()
	db, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	// Test services listen on loopback, which the default policy refuses.
	s, e := New(Config{Store: db, DataDir: db.DataDir, IconPolicy: func(netip.Addr) bool { return true }})
	if e != nil {
		t.Fatal(e)
	}
	return &client{t: t, h: s}, db
}

func TestIconDiscoveryStoresReencodedIcon(t *testing.T) {
	var icon bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	img.Set(1, 1, color.NRGBA{R: 200, A: 255})
	png.Encode(&icon, img)
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(`<link rel="icon" href="/icon.png">`))
		case "/icon.png":
			// Trailing bytes must not survive re-encoding.
			w.Write(append(icon.Bytes(), []byte("<script>alert(1)</script>")...))
		default:
			http.NotFound(w, r)
		}
	}))
	defer service.Close()
	c, db := newIconClient(t)
	anon := &client{t: t, h: c.h}
	anon.req("POST", "/api/icons/discover", map[string]string{"url": service.URL}, 401)
	c.setup()
	csrf := c.csrf
	c.csrf = strings.Repeat("0", 64)
	c.req("POST", "/api/icons/discover", map[string]string{"url": service.URL}, 403)
	c.csrf = csrf
	var result map[string]string
	json.Unmarshal(c.req("POST", "/api/icons/discover", map[string]string{"url": service.URL}, 201), &result)
	if !store.ValidUpload(result["url"]) || !strings.HasSuffix(result["url"], ".png") {
		t.Fatalf("unexpected upload path %q", result["url"])
	}
	stored, e := os.ReadFile(filepath.Join(db.DataDir, "uploads", strings.TrimPrefix(result["url"], "/uploads/")))
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(stored, []byte("script")) {
		t.Fatal("untrusted bytes were stored")
	}
	if _, format, e := image.Decode(bytes.NewReader(stored)); e != nil || format != "png" {
		t.Fatalf("stored icon is not a PNG: %v", e)
	}
	// The stored icon can be assigned to an application like any upload.
	c.req("POST", "/api/apps", map[string]any{"name": "Service", "url": service.URL, "icon": result["url"]}, 201)
}

func TestIconDiscoveryErrors(t *testing.T) {
	empty := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer empty.Close()
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	closed := "http://" + listener.Addr().String()
	listener.Close()
	c, _ := newIconClient(t)
	c.setup()
	for _, url := range []string{"ftp://example.com", "https://user:secret@example.com", "not a url"} {
		c.req("POST", "/api/icons/discover", map[string]string{"url": url}, 400)
	}
	c.req("POST", "/api/icons/discover", map[string]string{"url": empty.URL}, 404)
	body := c.req("POST", "/api/icons/discover", map[string]string{"url": closed}, 502)
	if strings.Contains(string(body), "127.0.0.1") || strings.Contains(string(body), "refused") {
		t.Fatalf("error leaks network details: %s", body)
	}
}

func TestIconDiscoveryRefusesLoopbackByDefault(t *testing.T) {
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("the default policy must not contact loopback services")
	}))
	defer service.Close()
	c, _ := newClient(t)
	c.setup()
	c.req("POST", "/api/icons/discover", map[string]string{"url": service.URL}, 502)
}
