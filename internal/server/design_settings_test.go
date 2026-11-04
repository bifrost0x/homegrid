package server

import (
	"encoding/json"
	"testing"
)

func TestLegacySettingsResponseMatchesStoredDefaults(t *testing.T) {
	c, _ := newClient(t)
	c.setup()
	var settings map[string]any
	json.Unmarshal(c.req("PATCH", "/api/settings", map[string]any{"title": "Legacy", "theme": "light", "accent": "sage", "density": "comfortable", "radius": "rounded", "background": "", "blur": false, "show_descriptions": true}, 200), &settings)
	if settings["design"] != "homegrid" || settings["wallpaper"] != "none" || settings["group_columns"] != "1" {
		t.Fatal("PATCH must return normalized settings", settings)
	}
}
