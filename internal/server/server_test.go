package server

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"github.com/bifrost0x/homegrid/internal/store"
	"hash/crc32"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"
)

type client struct {
	t       *testing.T
	h       http.Handler
	cookies []*http.Cookie
	csrf    string
}

func newClient(t *testing.T) (*client, *store.Store) {
	t.Helper()
	db, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	s, e := New(Config{Store: db, DataDir: db.DataDir})
	if e != nil {
		t.Fatal(e)
	}
	return &client{t: t, h: s}, db
}
func (c *client) req(method, path string, data any, want int) []byte {
	c.t.Helper()
	var b bytes.Buffer
	if data != nil {
		if err := json.NewEncoder(&b).Encode(data); err != nil {
			c.t.Fatal(err)
		}
	}
	r := httptest.NewRequest(method, path, &b)
	r.Header.Set("Content-Type", "application/json")
	for _, v := range c.cookies {
		r.AddCookie(v)
	}
	r.Header.Set("X-CSRF-Token", c.csrf)
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	if w.Code != want {
		c.t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, want, w.Body.String())
	}
	for _, v := range w.Result().Cookies() {
		found := false
		for i, x := range c.cookies {
			if x.Name == v.Name {
				c.cookies[i] = v
				found = true
			}
		}
		if !found {
			c.cookies = append(c.cookies, v)
		}
	}
	return w.Body.Bytes()
}
func (c *client) setup() {
	c.t.Helper()
	var s struct {
		CSRF string `json:"csrf_token"`
	}
	json.Unmarshal(c.req("GET", "/api/auth/session", nil, 200), &s)
	c.csrf = s.CSRF
	json.Unmarshal(c.req("POST", "/api/auth/setup", map[string]string{"username": "admin", "password": "a-secure-test-password"}, 201), &s)
	c.csrf = s.CSRF
}
func TestAuthAndCSRF(t *testing.T) {
	c, db := newClient(t)
	c.req("GET", "/api/apps", nil, 401)
	c.req("POST", "/api/auth/setup", map[string]string{"username": "admin", "password": "a-secure-test-password"}, 403)
	c.setup()
	c.req("GET", "/api/apps", nil, 200)
	old := c.csrf
	c.csrf = "bad"
	c.req("POST", "/api/categories", map[string]any{"name": "No"}, 403)
	c.csrf = old
	c.req("POST", "/api/auth/setup", map[string]string{"username": "admin", "password": "a-secure-test-password"}, 409)
	c.req("POST", "/api/auth/logout", nil, 204)
	c.req("GET", "/api/apps", nil, 401)
	var sess struct {
		CSRF string `json:"csrf_token"`
	}
	json.Unmarshal(c.req("GET", "/api/auth/session", nil, 200), &sess)
	c.csrf = sess.CSRF
	c.req("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "wrong"}, 401)
	json.Unmarshal(c.req("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "a-secure-test-password"}, 200), &sess)
	c.csrf = sess.CSRF
	if _, e := db.DB.Exec("UPDATE sessions SET expires_at=?", time.Now().Add(-time.Hour).Unix()); e != nil {
		t.Fatal(e)
	}
	c.req("GET", "/api/apps", nil, 401)
}
func TestCRUDReorderingAndSettings(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	var cat struct {
		ID int `json:"id"`
	}
	json.Unmarshal(c.req("POST", "/api/categories", map[string]any{"name": "Media"}, 201), &cat)
	c.req("PATCH", "/api/categories/2", map[string]any{"name": "Movies", "collapsed": true}, 200)
	a := map[string]any{"name": "Jellyfin", "url": "https://media.example", "category_id": cat.ID, "icon": "builtin:film", "open_in_new_tab": true}
	c.req("POST", "/api/apps", a, 201)
	a["name"] = "Plex"
	a["url"] = "http://plex.local:32400"
	c.req("POST", "/api/apps", a, 201)
	c.req("PUT", "/api/apps/reorder", map[string]any{"ids": []int{2, 1}}, 200)
	c.req("PUT", "/api/apps/reorder", map[string]any{"ids": []int{1, 1}}, 400)
	var apps []struct {
		ID, CategoryID, SortOrder int
		Name                      string
	}
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if len(apps) != 2 || apps[0].ID != 2 {
		t.Fatalf("bad ordering: %+v", apps)
	}
	a["name"] = "Edited"
	c.req("PATCH", "/api/apps/1", a, 200)
	c.req("DELETE", "/api/categories/1", nil, 400)
	c.req("DELETE", "/api/categories/2", nil, 204)
	var raw []map[string]any
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &raw)
	if raw[0]["category_id"] != float64(1) {
		t.Fatal("category deletion did not move apps")
	}
	c.req("DELETE", "/api/apps/1", nil, 204)
	c.req("DELETE", "/api/apps/1", nil, 404)
	c.req("PATCH", "/api/settings", map[string]any{"title": "My Lab", "theme": "dark", "accent": "sage", "density": "compact", "radius": "rounded", "background": "", "blur": true, "show_descriptions": false}, 200)
	var settings map[string]any
	json.Unmarshal(c.req("GET", "/api/settings", nil, 200), &settings)
	if settings["title"] != "My Lab" {
		t.Fatal(settings)
	}
}
func TestValidation(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	for _, url := range []string{"javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com", "/relative"} {
		c.req("POST", "/api/apps", map[string]any{"name": "Bad", "url": url, "category_id": 1}, 400)
	}
	c.req("POST", "/api/apps", map[string]any{"name": "Good", "url": "https://example.com", "category_id": 999}, 400)
	c.req("POST", "/api/apps", map[string]any{"name": "Good", "url": "https://example.com", "category_id": 1, "icon": "https://evil.com/x.svg"}, 400)
	c.req("PATCH", "/api/settings", map[string]any{"theme": "evil"}, 400)
	r := httptest.NewRequest("POST", "/api/categories", bytes.NewBufferString(`{"name":"x","unexpected":true}`))
	for _, v := range c.cookies {
		r.AddCookie(v)
	}
	r.Header.Set("X-CSRF-Token", c.csrf)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	r = httptest.NewRequest("POST", "/api/categories", bytes.NewBufferString(`{"name":"x"}`))
	for _, v := range c.cookies {
		r.AddCookie(v)
	}
	r.Header.Set("X-CSRF-Token", c.csrf)
	r.Header.Set("Origin", "https://evil.example")
	w = httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
}
func TestImportExportAtomicity(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	data := map[string]any{"apps": []any{map[string]any{"name": "NAS", "url": "https://nas.local", "category": "Infrastructure", "icon": ""}}}
	c.req("POST", "/api/import/preview", data, 200)
	c.req("POST", "/api/import/apply", map[string]any{"data": data, "mode": "merge", "confirm": false}, 400)
	c.req("POST", "/api/import/apply", map[string]any{"data": data, "mode": "merge", "confirm": true}, 200)
	var preview map[string]int
	json.Unmarshal(c.req("POST", "/api/import/preview", data, 200), &preview)
	if preview["duplicates"] != 1 {
		t.Fatal(preview)
	}
	backup := c.req("GET", "/api/export", nil, 200)
	if bytes.Contains(backup, []byte("password")) || bytes.Contains(backup, []byte("csrf")) {
		t.Fatal("export contains secrets")
	}
	var exported map[string]any
	json.Unmarshal(backup, &exported)
	c.req("POST", "/api/import/apply", map[string]any{"data": exported, "mode": "replace", "confirm": true}, 200)
	bad := map[string]any{"apps": []any{map[string]any{"name": "Bad", "url": "javascript:x"}}}
	c.req("POST", "/api/import/apply", map[string]any{"data": bad, "mode": "replace", "confirm": true}, 400)
	var apps []any
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if len(apps) != 1 {
		t.Fatal("invalid import changed database")
	}
}
func TestUploads(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	upload := func(data []byte, want int) []byte {
		var b bytes.Buffer
		mw := multipart.NewWriter(&b)
		f, _ := mw.CreateFormFile("file", "icon.png")
		f.Write(data)
		mw.Close()
		r := httptest.NewRequest("POST", "/api/uploads", &b)
		r.Header.Set("Content-Type", mw.FormDataContentType())
		r.Header.Set("X-CSRF-Token", c.csrf)
		for _, v := range c.cookies {
			r.AddCookie(v)
		}
		w := httptest.NewRecorder()
		c.h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("upload: %d %s", w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	upload([]byte("<svg onload='alert(1)'></svg>"), 400)
	var b bytes.Buffer
	png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	var result map[string]string
	json.Unmarshal(upload(b.Bytes(), 201), &result)
	c.req("GET", result["url"], nil, 200)
	anon := &client{t: t, h: c.h}
	anon.req("GET", result["url"], nil, 401)
}
func TestMigrationsAndPersistence(t *testing.T) {
	dir := t.TempDir()
	db, e := store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	db.DB.Exec("INSERT INTO categories(name,sort_order,collapsed) VALUES('Persistent',1,0)")
	db.Close()
	db, e = store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	var n int
	db.DB.QueryRow("SELECT count(*) FROM categories").Scan(&n)
	if n != 2 {
		t.Fatal(n)
	}
	db.DB.QueryRow("PRAGMA foreign_keys").Scan(&n)
	if n != 1 {
		t.Fatal("foreign keys disabled")
	}
	db.DB.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&n)
	if n != 4 {
		t.Fatal("migration rerun")
	}
}

func TestReplaceRestoresCategoryOrder(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	c.req("POST", "/api/categories", map[string]any{"name": "First"}, 201)
	c.req("POST", "/api/categories", map[string]any{"name": "Second"}, 201)
	c.req("PUT", "/api/categories/reorder", map[string]any{"ids": []int{3, 1, 2}}, 200)
	var backup map[string]any
	json.Unmarshal(c.req("GET", "/api/export", nil, 200), &backup)
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "replace", "confirm": true}, 200)
	var cats []struct {
		Name string `json:"name"`
	}
	json.Unmarshal(c.req("GET", "/api/categories", nil, 200), &cats)
	if len(cats) != 3 || cats[0].Name != "Second" || cats[1].Name != "General" || cats[2].Name != "First" {
		t.Fatalf("category order changed on restore: %+v", cats)
	}
}

func TestRejectsBrowserInvalidURLs(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	for _, u := range []string{"https://host:65536", "https://[xyz]", "https://999.999.999.999", "https://[fe80::1%25eth0]", "https://example.com:0", "https://example.com:"} {
		t.Run(u, func(t *testing.T) {
			c.req("POST", "/api/apps", map[string]any{"name": "Bad", "url": u, "category_id": 1}, 400)
			data := map[string]any{"apps": []any{map[string]any{"name": "Bad", "url": u}}}
			c.req("POST", "/api/import/preview", data, 400)
		})
	}
}
func TestReplaceKeepsDistinctCategoriesWithSameName(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	c.req("POST", "/api/categories", map[string]any{"name": "Media"}, 201)
	c.req("POST", "/api/categories", map[string]any{"name": "Media"}, 201)
	var backup map[string]any
	json.Unmarshal(c.req("GET", "/api/export", nil, 200), &backup)
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "replace", "confirm": true}, 200)
	var cats []any
	json.Unmarshal(c.req("GET", "/api/categories", nil, 200), &cats)
	if len(cats) != 3 {
		t.Fatal("distinct categories collapsed on replace", cats)
	}
}

func TestSecurityHeadersCookiesAndTokenStorage(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	r := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Content-Security-Policy") == "" {
		t.Fatal(w.Code, w.Header())
	}
	var token string
	for _, cookie := range c.cookies {
		if cookie.Name == sessionCookie {
			if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
				t.Fatal("weak session cookie", cookie)
			}
			token = cookie.Value
		}
	}
	var hash string
	if e := db.DB.QueryRow("SELECT token_hash FROM sessions").Scan(&hash); e != nil {
		t.Fatal(e)
	}
	if hash == token || len(hash) != 64 {
		t.Fatal("session token not hashed")
	}
	var passwordHash string
	db.DB.QueryRow("SELECT password_hash FROM users").Scan(&passwordHash)
	if !bytes.HasPrefix([]byte(passwordHash), []byte("$argon2id$")) {
		t.Fatal("password not argon2id")
	}
}
func TestStrictJSONAndSizeLimits(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	for _, tc := range []struct {
		body string
		want int
	}{{`{"name":"x"} {"name":"y"}`, 400}, {`{"name":`, 400}, {`{"name":"` + string(bytes.Repeat([]byte("x"), 1<<20)) + `"}`, 413}} {
		r := httptest.NewRequest("POST", "/api/categories", bytes.NewBufferString(tc.body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", c.csrf)
		for _, v := range c.cookies {
			r.AddCookie(v)
		}
		w := httptest.NewRecorder()
		c.h.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("got %d want %d: %s", w.Code, tc.want, w.Body.String())
		}
	}
}
func TestAtomicReorderRejectsUnknownAndIncompleteIDs(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	for _, name := range []string{"One", "Two"} {
		c.req("POST", "/api/categories", map[string]any{"name": name}, 201)
	}
	before := c.req("GET", "/api/categories", nil, 200)
	for _, ids := range [][]int{{3, 2}, {3, 2, 999}, {3, 2, 2}} {
		c.req("PUT", "/api/categories/reorder", map[string]any{"ids": ids}, 400)
		after := c.req("GET", "/api/categories", nil, 200)
		if !bytes.Equal(before, after) {
			t.Fatal("rejected reorder partially committed")
		}
	}
}
func TestImportMergeDeduplicatesNormalizedURLs(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	data := map[string]any{"apps": []any{map[string]any{"name": "One", "url": "https://EXAMPLE.com:443/"}, map[string]any{"name": "Duplicate", "url": "https://example.com#fragment"}}}
	var res map[string]int
	json.Unmarshal(c.req("POST", "/api/import/apply", map[string]any{"data": data, "mode": "merge", "confirm": true}, 200), &res)
	if res["imported"] != 1 {
		t.Fatal(res)
	}
	json.Unmarshal(c.req("POST", "/api/import/apply", map[string]any{"data": data, "mode": "merge", "confirm": true}, 200), &res)
	if res["imported"] != 0 {
		t.Fatal(res)
	}
}
func TestRateLimitBoundsAndProxyTrust(t *testing.T) {
	c, _ := newClient(t)
	s := c.h.(*Server)
	r := httptest.NewRequest("GET", "/api/health", nil)
	r.RemoteAddr = "192.0.2.1:9999"
	r.Header.Set("X-Forwarded-For", "198.51.100.7")
	if s.clientIP(r) != "192.0.2.1" {
		t.Fatal("untrusted forwarding header honored")
	}
	s.cfg.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("192.0.2.0/24")}
	if s.clientIP(r) != "198.51.100.7" {
		t.Fatal("trusted proxy ignored")
	}
	now := time.Now()
	l := &rateLimiter{entries: map[string]attempts{}}
	for i := 0; i < 10; i++ {
		if !l.allow("a", now) {
			t.Fatal("early limit")
		}
	}
	if l.allow("a", now) {
		t.Fatal("login limit bypassed")
	}
	if !l.allow("a", now.Add(6*time.Minute)) {
		t.Fatal("limit never expires")
	}
	for i := 0; i < 5000; i++ {
		l.allow(strconv.Itoa(i), now)
	}
	if len(l.entries) > 4096 {
		t.Fatal("unbounded rate limiter")
	}
}
func TestPersistenceOfAuthenticatedDashboard(t *testing.T) {
	dir := t.TempDir()
	db, e := store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	s, e := New(Config{Store: db})
	if e != nil {
		t.Fatal(e)
	}
	c := &client{t: t, h: s}
	c.setup()
	c.req("POST", "/api/apps", map[string]any{"name": "Persistent", "url": "http://nas.local", "category_id": 1}, 201)
	db.Close()
	db, e = store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	s, e = New(Config{Store: db})
	if e != nil {
		t.Fatal(e)
	}
	c.h = s
	var apps []map[string]any
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if len(apps) != 1 || apps[0]["name"] != "Persistent" {
		t.Fatal(apps)
	}
	var session map[string]any
	json.Unmarshal(c.req("GET", "/api/auth/session", nil, 200), &session)
	if session["authenticated"] != true || session["setup_required"] != false {
		t.Fatal(session)
	}
}

func TestUploadRejectsOversizeAndPixelBombsAndStripsTrailingBytes(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	upload := func(raw []byte, status int) []byte {
		t.Helper()
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		part, _ := mw.CreateFormFile("file", "image.png")
		part.Write(raw)
		mw.Close()
		r := httptest.NewRequest("POST", "/api/uploads", &body)
		r.Header.Set("Content-Type", mw.FormDataContentType())
		r.Header.Set("X-CSRF-Token", c.csrf)
		for _, cookie := range c.cookies {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		c.h.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("upload got %d want %d: %s", w.Code, status, w.Body.String())
		}
		return w.Body.Bytes()
	}
	upload(bytes.Repeat([]byte("x"), (5<<20)+1), 413)
	var encoded bytes.Buffer
	png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	pixelBomb := append([]byte{}, encoded.Bytes()...)
	binary.BigEndian.PutUint32(pixelBomb[16:20], 5000)
	binary.BigEndian.PutUint32(pixelBomb[20:24], 5000)
	binary.BigEndian.PutUint32(pixelBomb[29:33], crc32.ChecksumIEEE(pixelBomb[12:29]))
	upload(pixelBomb, 400)
	clean := encoded.Bytes()
	raw := append(append([]byte{}, clean...), []byte("<script>alert(1)</script>")...)
	var result map[string]string
	json.Unmarshal(upload(raw, 201), &result)
	actual := c.req("GET", result["url"], nil, 200)
	if bytes.Contains(actual, []byte("script")) {
		t.Fatal("untrusted trailing bytes persisted")
	}
	decoded, format, e := image.Decode(bytes.NewReader(actual))
	if e != nil || format != "png" || decoded.Bounds().Dx() != 4 {
		t.Fatal("stored image corrupted", e)
	}
}
func TestSecureCookieAndLoginRateLimit(t *testing.T) {
	c, _ := newClient(t)
	c.h.(*Server).cfg.SecureCookie = true
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, httptest.NewRequest("GET", "/api/auth/session", nil))
	if len(w.Result().Cookies()) != 1 || !w.Result().Cookies()[0].Secure {
		t.Fatal("HTTPS cookie lacks Secure")
	}
	var state struct {
		CSRF string `json:"csrf_token"`
	}
	json.Unmarshal(w.Body.Bytes(), &state)
	c.cookies = w.Result().Cookies()
	c.csrf = state.CSRF
	for i := 0; i < 10; i++ {
		c.req("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "wrong"}, 401)
	}
	c.req("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "wrong"}, 429)
}

func TestPrivateDataPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix permission bits are not enforced by Windows")
	}
	dir := filepath.Join(t.TempDir(), "data")
	db, e := store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	for _, tc := range []struct {
		path string
		mode os.FileMode
	}{{dir, 0700}, {filepath.Join(dir, "homegrid.db"), 0600}} {
		info, e := os.Stat(tc.path)
		if e != nil {
			t.Fatal(e)
		}
		if info.Mode().Perm() != tc.mode {
			t.Fatalf("%s mode %o want %o", tc.path, info.Mode().Perm(), tc.mode)
		}
	}
	db.DB.Exec("INSERT INTO categories(name) VALUES('WAL')")
	for _, suffix := range []string{"-wal", "-shm"} {
		info, e := os.Stat(filepath.Join(dir, "homegrid.db") + suffix)
		if e == nil && info.Mode().Perm()&0077 != 0 {
			t.Fatalf("sqlite %s is readable by other users: %o", suffix, info.Mode().Perm())
		}
	}
}

func TestReplacePreservesAppsWithSharedURL(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	for _, name := range []string{"Admin", "Media"} {
		c.req("POST", "/api/apps", map[string]any{"name": name, "url": "https://same.local", "category_id": 1}, 201)
	}
	var backup map[string]any
	json.Unmarshal(c.req("GET", "/api/export", nil, 200), &backup)
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "replace", "confirm": true}, 200)
	var apps []map[string]any
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if len(apps) != 2 || apps[0]["name"] != "Admin" || apps[1]["name"] != "Media" {
		t.Fatal("replace lost apps", apps)
	}
}
func TestNumericHostOverflowRejected(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	c.req("POST", "/api/apps", map[string]any{"name": "Bad", "url": "https://9999999999999", "category_id": 1}, 400)
}

func TestAPIMethodAndUnknownEndpointStatus(t *testing.T) {
	c, _ := newClient(t)
	c.req("PUT", "/api/health", nil, 405)
	c.req("GET", "/api/does-not-exist", nil, 404)
}

func TestSessionSlidesOnUseAndRenewsCookie(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	now := time.Now().Unix()
	if _, e := db.DB.Exec("UPDATE sessions SET expires_at=?,created_at=?", now+120, now-7200); e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest("GET", "/api/apps", nil)
	for _, cookie := range c.cookies {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	renewed := false
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == sessionCookie && cookie.Value != "" && cookie.MaxAge > int(store.SessionIdleTimeout)-60 && cookie.HttpOnly && cookie.SameSite == http.SameSiteStrictMode {
			renewed = true
		}
	}
	if !renewed {
		t.Fatal("session cookie was not renewed", w.Result().Cookies())
	}
	var expires int64
	db.DB.QueryRow("SELECT expires_at FROM sessions").Scan(&expires)
	if expires < now+store.SessionIdleTimeout-60 {
		t.Fatal("session expiry did not slide", expires)
	}
	// Logout must clear the cookie rather than renew it.
	if _, e := db.DB.Exec("UPDATE sessions SET expires_at=?", now+120); e != nil {
		t.Fatal(e)
	}
	req = httptest.NewRequest("POST", "/api/auth/logout", nil)
	for _, cookie := range c.cookies {
		req.AddCookie(cookie)
	}
	req.Header.Set("X-CSRF-Token", c.csrf)
	w = httptest.NewRecorder()
	c.h.ServeHTTP(w, req)
	if w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == sessionCookie && cookie.MaxAge >= 0 {
			t.Fatal("logout renewed the session cookie", cookie)
		}
	}
}
