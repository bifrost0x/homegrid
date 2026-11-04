package server

import (
	"encoding/json"
	"testing"
)

func TestIconColorCRUDReorderAndBackupCompatibility(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	var app map[string]any
	json.Unmarshal(c.req("POST", "/api/apps", map[string]any{"name": "Colored", "url": "https://color.local", "category_id": 1, "favorite": true, "icon_color": "violet", "icon": "builtin:server"}, 201), &app)
	if app["icon_color"] != "violet" || app["favorite"] != true {
		t.Fatal(app)
	}
	c.req("POST", "/api/apps", map[string]any{"name": "Legacy", "url": "https://legacy.local", "category_id": 1}, 201)
	c.req("PUT", "/api/apps/reorder", map[string]any{"ids": []int{2, 1}}, 200)
	var apps []map[string]any
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if apps[0]["icon_color"] != "auto" || apps[1]["icon_color"] != "violet" || apps[1]["favorite"] != true {
		t.Fatal("reorder changed appearance", apps)
	}
	for _, color := range []string{"auto", "sage", "blue", "amber", "rose", "violet", "cyan"} {
		app["icon_color"] = color
		var changed map[string]any
		json.Unmarshal(c.req("PATCH", "/api/apps/1", app, 200), &changed)
		if changed["icon_color"] != color || changed["favorite"] != true {
			t.Fatal("edit changed preference", changed)
		}
	}
	var backup map[string]any
	json.Unmarshal(c.req("GET", "/api/export", nil, 200), &backup)
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "replace", "confirm": true}, 200)
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if apps[1]["icon_color"] != "cyan" || apps[1]["favorite"] != true {
		t.Fatal("replace lost tint/favorite", apps)
	}
	for _, v := range backup["apps"].([]any) {
		delete(v.(map[string]any), "icon_color")
	}
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "replace", "confirm": true}, 200)
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if apps[1]["icon_color"] != "auto" || apps[1]["favorite"] != true {
		t.Fatal("legacy backup compatibility failed", apps)
	}
}
func TestIconColorInvalidRequestsDoNotWrite(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	for _, color := range []string{"red", "AUTO", "url(evil)", " cyan "} {
		c.req("POST", "/api/apps", map[string]any{"name": "Bad", "url": "https://bad.local", "icon_color": color}, 400)
	}
	var backup map[string]any
	json.Unmarshal(c.req("GET", "/api/export", nil, 200), &backup)
	backup["apps"] = []any{map[string]any{"name": "Invalid import", "url": "https://bad.local", "category_id": 1, "icon_color": "red"}}
	c.req("POST", "/api/import/preview", backup, 400)
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "replace", "confirm": true}, 400)
	var apps []any
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if len(apps) != 0 {
		t.Fatal("invalid color wrote data", apps)
	}
}
func TestExpandedBuiltinIconCatalog(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	for _, icon := range []string{"camera", "image", "book-open", "file-text", "notebook", "mail", "calendar", "clock", "router", "container", "monitor", "smartphone", "printer", "download", "archive", "rss", "link", "key", "lock", "wifi", "lightbulb", "heart", "gamepad", "map-pin", "terminal", "git-branch", "headphones", "search", "settings", "chart", "clipboard", "bookmark"} {
		c.req("POST", "/api/apps", map[string]any{"name": icon, "url": "https://icon.local", "icon": "builtin:" + icon}, 201)
	}
	c.req("POST", "/api/apps", map[string]any{"name": "Unknown", "url": "https://icon.local", "icon": "builtin:not-a-real-icon"}, 400)
}

func TestIconColorMergeAndEmptyCompatibility(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	var app map[string]any
	json.Unmarshal(c.req("POST", "/api/apps", map[string]any{"name": "Empty tint", "url": "https://empty.local", "favorite": true, "icon_color": ""}, 201), &app)
	if app["icon_color"] != "auto" || app["favorite"] != true {
		t.Fatal(app)
	}
	var backup map[string]any
	json.Unmarshal(c.req("GET", "/api/export", nil, 200), &backup)
	backup["apps"] = []any{map[string]any{"name": "Merged", "url": "https://merge.local", "favorite": true, "icon_color": "sage", "category_id": 1}}
	c.req("POST", "/api/import/apply", map[string]any{"data": backup, "mode": "merge", "confirm": true}, 200)
	var apps []map[string]any
	json.Unmarshal(c.req("GET", "/api/apps", nil, 200), &apps)
	if len(apps) != 2 || apps[1]["favorite"] != true || apps[1]["icon_color"] != "sage" {
		t.Fatal("merge lost preference", apps)
	}
}
