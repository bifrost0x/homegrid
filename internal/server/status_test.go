package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/bifrost0x/homegrid/internal/store"
)

func TestStatusChecksAreOptIn(t *testing.T) {
	var hits atomic.Int32
	service := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits.Add(1) }))
	defer service.Close()
	db, e := store.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	s, e := New(Config{Store: db, DataDir: db.DataDir, StatusPolicy: func(netip.Addr) bool { return true }})
	if e != nil {
		t.Fatal(e)
	}
	c := &client{t: t, h: s}
	c.req("GET", "/api/status", nil, 401)
	c.setup()
	var app struct {
		ID int64 `json:"id"`
	}
	json.Unmarshal(c.req("POST", "/api/apps", map[string]any{"name": "Service", "url": service.URL, "icon": "builtin:server", "open_in_new_tab": true}, 201), &app)
	c.req("POST", "/api/apps", map[string]any{"name": "Down", "url": "http://127.0.0.1:1", "icon": "builtin:server", "open_in_new_tab": true}, 201)

	var result struct {
		Enabled  bool              `json:"enabled"`
		Statuses map[string]string `json:"statuses"`
	}
	json.Unmarshal(c.req("GET", "/api/status", nil, 200), &result)
	if result.Enabled || len(result.Statuses) != 0 || hits.Load() != 0 {
		t.Fatal("status checks ran while disabled", result, hits.Load())
	}

	var settings map[string]any
	json.Unmarshal(c.req("GET", "/api/settings", nil, 200), &settings)
	if settings["status_checks"] != false {
		t.Fatal("status checks are not off by default", settings)
	}
	settings["status_checks"] = true
	c.req("PATCH", "/api/settings", settings, 200)
	json.Unmarshal(c.req("GET", "/api/status", nil, 200), &result)
	if !result.Enabled || result.Statuses[strconv.FormatInt(app.ID, 10)] != "up" || len(result.Statuses) != 2 || hits.Load() != 1 {
		t.Fatal("unexpected status result", result, hits.Load())
	}
	for id, state := range result.Statuses {
		if id != strconv.FormatInt(app.ID, 10) && state != "down" {
			t.Fatal("closed port reported as", state)
		}
	}
}
