package server

import (
	"encoding/json"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bifrost0x/homegrid/internal/store"
)

func TestUnusedUploadCleanup(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	dir := filepath.Join(db.DataDir, "uploads")
	if e := os.MkdirAll(dir, 0700); e != nil {
		t.Fatal(e)
	}
	name := func(ch string) string { return strings.Repeat(ch, 64) + ".png" }
	old := time.Now().Add(-48 * time.Hour)
	for _, n := range []string{name("a"), name("b"), name("c"), name("d"), "notes.txt"} {
		path := filepath.Join(dir, n)
		if e := os.WriteFile(path, []byte("x"), 0600); e != nil {
			t.Fatal(e)
		}
		if n != name("d") {
			os.Chtimes(path, old, old)
		}
	}
	// a is used by an application, b by an undo record, c is unused, d is recent.
	c.req("POST", "/api/apps", map[string]any{"name": "NAS", "url": "https://nas.home.arpa", "icon": "/uploads/" + name("a"), "open_in_new_tab": true}, 201)
	if _, e := db.DB.Exec("INSERT INTO undo_records(token,kind,label,payload,expires_at,created_at) VALUES('t','delete-app','x',?,9999999999,1)", `{"icon":"/uploads/`+name("b")+`"}`); e != nil {
		t.Fatal(e)
	}
	var list struct {
		Files []struct {
			Name string `json:"name"`
			URL  string `json:"url"`
			Size int64  `json:"size"`
		} `json:"files"`
	}
	json.Unmarshal(c.req("GET", "/api/uploads/unused", nil, 200), &list)
	if len(list.Files) != 1 || list.Files[0].Name != name("c") || list.Files[0].URL != "/uploads/"+name("c") || list.Files[0].Size != 1 {
		t.Fatal("unexpected unused uploads", list)
	}
	c.req("POST", "/api/uploads/cleanup", map[string]any{"names": []string{name("c")}}, 400)
	var result map[string]int
	json.Unmarshal(c.req("POST", "/api/uploads/cleanup", map[string]any{"names": []string{name("a"), name("b"), name("c"), name("d"), "../store.db", "notes.txt"}, "confirm": true}, 200), &result)
	if result["deleted"] != 1 {
		t.Fatal(result)
	}
	for n, want := range map[string]bool{name("a"): true, name("b"): true, name("c"): false, name("d"): true, "notes.txt": true} {
		if _, e := os.Stat(filepath.Join(dir, n)); (e == nil) != want {
			t.Errorf("%s exists=%v want %v", n, e == nil, want)
		}
	}
	c.req("POST", "/api/uploads/cleanup", map[string]any{"names": []string{}, "confirm": true}, 400)
	tooMany := make([]string, 10001)
	for i := range tooMany {
		tooMany[i] = name("c")
	}
	c.req("POST", "/api/uploads/cleanup", map[string]any{"names": tooMany, "confirm": true}, 400)
	c.csrf = "bad"
	c.req("POST", "/api/uploads/cleanup", map[string]any{"names": []string{name("a")}, "confirm": true}, 403)
}

func TestDiagnosticsReportUntrustedProxy(t *testing.T) {
	db, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	s, e := New(Config{Store: db, TrustedProxies: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}})
	if e != nil {
		t.Fatal(e)
	}
	c := &client{t: t, h: s}
	c.setup()
	check := func(remote string, forwardedFor string) string {
		r := httptest.NewRequest("GET", "/api/diagnostics", nil)
		r.RemoteAddr = remote + ":40000"
		if forwardedFor != "" {
			r.Header.Set("X-Forwarded-For", forwardedFor)
		}
		for _, cookie := range c.cookies {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		var v struct {
			Proxy string `json:"untrusted_proxy"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &v) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		return v.Proxy
	}
	if got := check("172.18.0.1", "192.168.1.20"); got != "172.18.0.1" {
		t.Fatal("untrusted proxy not reported", got)
	}
	if got := check("10.0.0.5", "192.168.1.20"); got != "" {
		t.Fatal("trusted proxy reported", got)
	}
	if got := check("192.168.1.20", ""); got != "" {
		t.Fatal("direct request reported", got)
	}
}
