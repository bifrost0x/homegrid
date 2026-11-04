package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const oldPassword = "a-secure-test-password"
const newPassword = "a-new-secure-password"

func (c *client) loginAs(password string, status int) {
	c.t.Helper()
	var session struct {
		CSRF string `json:"csrf_token"`
	}
	json.Unmarshal(c.req("GET", "/api/auth/session", nil, 200), &session)
	c.csrf = session.CSRF
	json.Unmarshal(c.req("POST", "/api/auth/login", map[string]string{"username": "admin", "password": password}, status), &session)
	if status == 200 {
		c.csrf = session.CSRF
	}
}
func cloneClient(c *client) *client {
	return &client{t: c.t, h: c.h, cookies: append([]*http.Cookie{}, c.cookies...), csrf: c.csrf}
}
func TestFavoriteCRUDReorderAndBackup(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	var app map[string]any
	json.Unmarshal(c.req("POST", "/api/apps", map[string]any{"name": "Favorite", "url": "https://favorite.local", "category_id": 1, "favorite": true}, 201), &app)
	if app["favorite"] != true {
		t.Fatal("favorite not returned", app)
	}
	c.req("POST", "/api/apps", map[string]any{"name": "Ordinary", "url": "https://ordinary.local", "category_id": 1}, 201)
	c.req("PUT", "/api/apps/reorder", map[string]any{"ids": []int{2, 1}}, 200)
	var apps []map[string]any
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if len(apps) != 2 || apps[0]["favorite"] != false || apps[1]["favorite"] != true {
		t.Fatal("reorder changed favorite state", apps)
	}
	app["favorite"] = false
	c.req("PATCH", "/api/apps/1", app, 200)
	app["favorite"] = true
	c.req("PATCH", "/api/apps/1", app, 200)
	var backup map[string]any
	json.Unmarshal(c.req("GET", "/api/export", nil, 200), &backup)
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "replace", "confirm": true}, 200)
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if apps[1]["favorite"] != true {
		t.Fatal("backup lost favorite", apps)
	}
	for _, value := range backup["apps"].([]any) {
		delete(value.(map[string]any), "favorite")
	}
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "replace", "confirm": true}, 200)
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	for _, a := range apps {
		if a["favorite"] != false {
			t.Fatal("old backup did not default false", a)
		}
	}
}
func TestPasswordChangeValidationPreservesSessions(t *testing.T) {
	c, db := newClient(t)
	anon := &client{t: t, h: c.h}
	anon.req("POST", "/api/auth/password", map[string]string{"current_password": oldPassword, "new_password": newPassword}, 401)
	c.setup()
	var before string
	db.DB.QueryRow("SELECT password_hash FROM users").Scan(&before)
	c.req("POST", "/api/auth/password", map[string]string{"current_password": "wrong", "new_password": newPassword}, 400)
	c.req("POST", "/api/auth/password", map[string]string{"current_password": oldPassword, "new_password": "short"}, 400)
	c.req("POST", "/api/auth/password", map[string]string{"current_password": oldPassword, "new_password": strings.Repeat("x", 1025)}, 400)
	c.req("POST", "/api/auth/password", map[string]string{"current_password": strings.Repeat("x", 1025), "new_password": newPassword}, 400)
	var after string
	db.DB.QueryRow("SELECT password_hash FROM users").Scan(&after)
	if before != after {
		t.Fatal("rejected password change modified password")
	}
	c.req("GET", "/api/apps", nil, 200)
	var n int
	db.DB.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
	if n != 1 {
		t.Fatal("rejected change modified sessions", n)
	}
}
func TestPasswordChangeRequiresCSRFAndSameOrigin(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	token := c.csrf
	c.csrf = "invalid"
	c.req("POST", "/api/auth/password", map[string]string{"current_password": oldPassword, "new_password": newPassword}, 403)
	c.csrf = token
	var body bytes.Buffer
	json.NewEncoder(&body).Encode(map[string]string{"current_password": oldPassword, "new_password": newPassword})
	r := httptest.NewRequest("POST", "/api/auth/password", &body)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-CSRF-Token", token)
	r.Header.Set("Origin", "https://evil.example")
	for _, cookie := range c.cookies {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin password change allowed", w.Code, w.Body.String())
	}
	c.req("GET", "/api/apps", nil, 200)
}
func TestPasswordChangeRotatesAllSessionsAndCredentials(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	oldSession := cloneClient(c)
	other := &client{t: t, h: c.h}
	other.loginAs(oldPassword, 200)
	oldCSRF := c.csrf
	var session struct {
		Authenticated bool   `json:"authenticated"`
		Username      string `json:"username"`
		CSRF          string `json:"csrf_token"`
	}
	json.Unmarshal(c.req("POST", "/api/auth/password", map[string]string{"current_password": oldPassword, "new_password": newPassword}, 200), &session)
	if !session.Authenticated || session.Username != "admin" || session.CSRF == oldCSRF || len(session.CSRF) != 64 {
		t.Fatal("invalid replacement session", session)
	}
	c.csrf = session.CSRF
	c.req("GET", "/api/apps", nil, 200)
	c.req("POST", "/api/categories", map[string]string{"name": "Still signed in"}, 201)
	oldSession.req("GET", "/api/apps", nil, 401)
	other.req("GET", "/api/apps", nil, 401)
	var n int
	db.DB.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
	if n != 1 {
		t.Fatal("old sessions remain", n)
	}
	fresh := &client{t: t, h: c.h}
	fresh.loginAs(oldPassword, 401)
	fresh.loginAs(newPassword, 200)
}
func TestConcurrentPasswordChangeOnlyOneSucceeds(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	start := make(chan struct{})
	var wg sync.WaitGroup
	responses := make(chan *httptest.ResponseRecorder, 2)
	for _, password := range []string{"concurrent-password-one", "concurrent-password-two"} {
		wg.Add(1)
		go func(password string) {
			defer wg.Done()
			<-start
			b, _ := json.Marshal(map[string]string{"current_password": oldPassword, "new_password": password})
			r := httptest.NewRequest("POST", "/api/auth/password", bytes.NewReader(b))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-CSRF-Token", c.csrf)
			for _, cookie := range c.cookies {
				r.AddCookie(cookie)
			}
			w := httptest.NewRecorder()
			c.h.ServeHTTP(w, r)
			responses <- w
		}(password)
	}
	close(start)
	wg.Wait()
	close(responses)
	success := 0
	for w := range responses {
		switch w.Code {
		case 200:
			success++
			replacement := cloneClient(c)
			replacement.cookies = w.Result().Cookies()
			var state struct {
				CSRF string `json:"csrf_token"`
			}
			json.Unmarshal(w.Body.Bytes(), &state)
			replacement.csrf = state.CSRF
			replacement.req("GET", "/api/apps", nil, 200)
		case 400, 401:
		default:
			t.Fatalf("unexpected concurrent result %d: %s", w.Code, w.Body.String())
		}
	}
	if success != 1 {
		t.Fatal("concurrent password changes both succeeded or failed", success)
	}
	var n int
	db.DB.QueryRow("SELECT count(*) FROM sessions WHERE expires_at>?", time.Now().Unix()).Scan(&n)
	if n != 1 {
		t.Fatal("rotation was not atomic", n)
	}
}

func TestLoginSessionRejectsStalePasswordVerification(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	s := c.h.(*Server)
	var oldHash string
	db.DB.QueryRow("SELECT password_hash FROM users").Scan(&oldHash)
	db.DB.Exec("UPDATE users SET password_hash='changed-after-verification'")
	w := httptest.NewRecorder()
	s.newSession(w, httptest.NewRequest("POST", "/api/auth/login", nil), "admin", 200, oldHash)
	if w.Code != 401 {
		t.Fatal("stale verified credentials issued a session", w.Code, w.Body.String())
	}
	var n int
	db.DB.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
	if n != 1 {
		t.Fatal("stale login changed sessions", n)
	}
}

func TestPasswordChangeConcurrencyAndAttemptLimits(t *testing.T) {
	t.Run("work bound", func(t *testing.T) {
		c, db := newClient(t)
		c.setup()
		s := c.h.(*Server)
		s.passwordSlots <- struct{}{}
		s.passwordSlots <- struct{}{}
		c.req("POST", "/api/auth/password", map[string]string{"current_password": oldPassword, "new_password": newPassword}, 429)
		<-s.passwordSlots
		<-s.passwordSlots
		var n int
		db.DB.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
		if n != 1 {
			t.Fatal("overloaded request changed sessions", n)
		}
		c.req("GET", "/api/apps", nil, 200)
	})
	t.Run("attempt limit", func(t *testing.T) {
		c, _ := newClient(t)
		c.setup()
		for i := 0; i < 9; i++ {
			c.req("POST", "/api/auth/password", map[string]string{"current_password": "wrong", "new_password": newPassword}, 400)
		}
		c.req("POST", "/api/auth/password", map[string]string{"current_password": "wrong", "new_password": newPassword}, 429)
		c.req("GET", "/api/apps", nil, 200)
	})
}
func TestPasswordChangeAcceptsMaximumLength(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	password := strings.Repeat("a", 1024)
	var session struct {
		CSRF string `json:"csrf_token"`
	}
	json.Unmarshal(c.req("POST", "/api/auth/password", map[string]string{"current_password": oldPassword, "new_password": password}, 200), &session)
	c.csrf = session.CSRF
	fresh := &client{t: t, h: c.h}
	fresh.loginAs(password, 200)
}
func TestFavoriteMergeImportPreservesFlag(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	var backup map[string]any
	json.Unmarshal(c.req("GET", "/api/export", nil, 200), &backup)
	backup["apps"] = []any{map[string]any{"name": "Imported favorite", "url": "https://imported.local", "category_id": 1, "favorite": true}}
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "merge", "confirm": true}, 200)
	var apps []map[string]any
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if len(apps) != 1 || apps[0]["favorite"] != true {
		t.Fatal("merge lost favorite", apps)
	}
}
