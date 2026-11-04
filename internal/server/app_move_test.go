package server

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/bifrost0x/homegrid/internal/store"
)

func moveRequest(c *client, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("PUT", path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-CSRF-Token", c.csrf)
	for _, cookie := range c.cookies {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	return w
}

func TestAppMovePersistsCategoryOrderAndUndo(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	c.req("POST", "/api/examples", nil, 200)
	before, err := db.Apps(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	w := moveRequest(c, "/api/apps/reorder", `{"ids":[4,1,3,2],"move":{"id":1,"category_id":4}}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	token := w.Header().Get("X-HomeGrid-Undo")
	if len(token) != 64 {
		t.Fatal("missing undo", w.Header())
	}
	after, err := db.Apps(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range after {
		if a.ID == 1 && (a.CategoryID != 4 || a.SortOrder != 1) {
			t.Fatal("move not persisted", a)
		}
	}
	var pending []store.UndoRecord
	if err = json.Unmarshal(c.req("GET", "/api/undo", nil, 200), &pending); err != nil || len(pending) != 1 || pending[0].Token != token {
		t.Fatal(pending, err)
	}
	c.req("POST", "/api/undo", map[string]string{"token": token}, 200)
	restored, err := db.Apps(t.Context())
	if err != nil || !reflect.DeepEqual(before, restored) {
		t.Fatal("undo did not restore category/order", restored, before, err)
	}
}

func TestAppMoveRejectsInvalidRequestsWithoutWrites(t *testing.T) {
	c, db := newClient(t)
	c.setup()
	c.req("POST", "/api/examples", nil, 200)
	before, _ := db.Apps(t.Context())
	cases := []struct{ path, body string }{
		{"/api/apps/reorder", `{"ids":[4,3,2,1],"move":{}}`},
		{"/api/apps/reorder", `{"ids":[4,3,2,1],"move":{"id":1}}`},
		{"/api/apps/reorder", `{"ids":[4,3,2,1],"move":{"id":1,"category_id":999}}`},
		{"/api/apps/reorder", `{"ids":[4,3,2,1],"move":{"id":999,"category_id":4}}`},
		{"/api/apps/reorder", `{"ids":[4,3,2,1],"move":{"id":1,"category_id":-1}}`},
		{"/api/apps/reorder", `{"ids":[4,3,2,1],"move":{"id":"1","category_id":4}}`},
		{"/api/apps/reorder", `{"ids":[4,3,2,1],"move":{"id":1,"category_id":null}}`},
		{"/api/apps/reorder", `{"ids":[4,3,2],"move":{"id":1,"category_id":4}}`},
		{"/api/apps/reorder", `{"ids":[4,3,2,2],"move":{"id":1,"category_id":4}}`},
		{"/api/apps/reorder", `{"ids":[4,3,2,999],"move":{"id":1,"category_id":4}}`},
		{"/api/categories/reorder", `{"ids":[4,3,2,1],"move":{"id":1,"category_id":4}}`},
	}
	for _, tc := range cases {
		t.Run(tc.body+tc.path, func(t *testing.T) {
			w := moveRequest(c, tc.path, tc.body)
			if w.Code != 400 || w.Header().Get("X-HomeGrid-Undo") != "" {
				t.Fatal(w.Code, w.Header(), w.Body.String())
			}
			after, _ := db.Apps(t.Context())
			if !reflect.DeepEqual(before, after) {
				t.Fatal("rejected request changed apps", after)
			}
			pending, err := db.PendingUndo(t.Context())
			if err != nil || len(pending) != 0 {
				t.Fatal("rejected request recorded undo", pending, err)
			}
		})
	}
}
