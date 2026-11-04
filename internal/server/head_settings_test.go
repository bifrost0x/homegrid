package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSettingsHEADIsReadOnly(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	original, err := db.Settings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	changed := original
	changed.Title = "Only PATCH should save this"
	body, err := json.Marshal(changed)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name string
		body []byte
	}{{"with JSON body", body}, {"without body", nil}} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodHead, "/api/settings", bytes.NewReader(test.body))
			if test.body != nil {
				r.Header.Set("Content-Type", "application/json")
			}
			for _, cookie := range c.cookies {
				r.AddCookie(cookie)
			}
			w := httptest.NewRecorder()
			c.h.ServeHTTP(w, r)
			if w.Code != http.StatusOK {
				t.Errorf("HEAD status = %d, want 200", w.Code)
			}
			stored, err := db.Settings(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			if stored != original {
				t.Error("HEAD changed persisted settings")
			}
			var undoCount int
			if err := db.DB.QueryRowContext(t.Context(), "SELECT count(*) FROM undo_records").Scan(&undoCount); err != nil {
				t.Fatal(err)
			}
			if undoCount != 0 || w.Header().Get("X-HomeGrid-Undo") != "" {
				t.Errorf("HEAD created an undo action: count=%d, header=%q", undoCount, w.Header().Get("X-HomeGrid-Undo"))
			}
		})
	}
	c.req(http.MethodPatch, "/api/settings", changed, http.StatusOK)
	stored, err := db.Settings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if stored != changed {
		t.Fatal("PATCH did not persist changed settings")
	}
	var undoCount int
	if err := db.DB.QueryRowContext(t.Context(), "SELECT count(*) FROM undo_records").Scan(&undoCount); err != nil {
		t.Fatal(err)
	}
	if undoCount != 1 {
		t.Fatalf("PATCH undo count = %d, want 1", undoCount)
	}
	anon := &client{t: t, h: c.h}
	anon.req(http.MethodHead, "/api/settings", nil, http.StatusUnauthorized)
}
