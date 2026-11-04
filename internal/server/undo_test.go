package server

import (
	"encoding/json"
	"github.com/bifrost0x/homegrid/internal/store"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUndoRoutesAndOriginalMutationContracts(t *testing.T) {
	c, _ := newClient(t)
	c.req("GET", "/api/undo", nil, 401)
	c.req("POST", "/api/examples", nil, 401)
	c.setup()
	c.req("POST", "/api/examples", nil, 200)
	c.req("POST", "/api/examples", nil, 409)
	r := httptest.NewRequest("DELETE", "/api/apps/1", nil)
	for _, cookie := range c.cookies {
		r.AddCookie(cookie)
	}
	r.Header.Set("X-CSRF-Token", c.csrf)
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	if w.Code != 204 || len(w.Header().Get("X-HomeGrid-Undo")) != 64 {
		t.Fatal(w.Code, w.Header(), w.Body.String())
	}
	token := w.Header().Get("X-HomeGrid-Undo")
	var records []store.UndoRecord
	if e := json.Unmarshal(c.req("GET", "/api/undo", nil, 200), &records); e != nil || len(records) != 1 || records[0].Token != token {
		t.Fatal(records, e)
	}
	old := c.csrf
	c.csrf = "bad"
	c.req("POST", "/api/undo", map[string]string{"token": token}, 403)
	c.csrf = old
	c.req("POST", "/api/undo", map[string]string{"token": token}, 200)
	c.req("POST", "/api/undo", map[string]string{"token": token}, 409)
	c.req("POST", "/api/undo", map[string]string{"token": strings.Repeat("a", 64)}, 409)
}

func TestSettingsReorderUndoHeadersAndFailureHeaders(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	c.req("POST", "/api/examples", nil, 200)
	settings, _ := db.Settings(t.Context())
	settings.Title = "Saved title"
	cases := []struct {
		method, path, body string
		status             int
	}{{"PATCH", "/api/settings", func() string { b, _ := json.Marshal(settings); return string(b) }(), 200}, {"PUT", "/api/apps/reorder", `{"ids":[4,3,2,1]}`, 200}, {"PUT", "/api/categories/reorder", `{"ids":[4,3,2,1]}`, 200}, {"PUT", "/api/apps/reorder", `{"ids":[1,1]}`, 400}, {"DELETE", "/api/apps/999", "", 404}, {"PATCH", "/api/settings", `{"title":"Invalid"}`, 400}}
	for _, item := range cases {
		r := httptest.NewRequest(item.method, item.path, strings.NewReader(item.body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", c.csrf)
		for _, cookie := range c.cookies {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		c.h.ServeHTTP(w, r)
		if w.Code != item.status {
			t.Fatal(item.path, w.Code, w.Body.String())
		}
		token := w.Header().Get("X-HomeGrid-Undo")
		if (item.status == 200) != (len(token) == 64) {
			t.Fatal(item.path, w.Header())
		}
		if item.path == "/api/settings" && item.status == 200 {
			var got store.Settings
			if e := json.Unmarshal(w.Body.Bytes(), &got); e != nil || got.Title != settings.Title || got.Design == "" {
				t.Fatal(got, e)
			}
		}
	}
}
