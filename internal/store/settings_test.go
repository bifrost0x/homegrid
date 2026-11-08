package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

const legacySettings = `{"title":"Existing dashboard","theme":"dark","accent":"blue","density":"compact","radius":"square","background":"/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png","blur":true,"show_descriptions":false}`

func settingsFixture(t *testing.T, extra map[string]string) Settings {
	t.Helper()
	var data map[string]any
	if e := json.Unmarshal([]byte(legacySettings), &data); e != nil {
		t.Fatal(e)
	}
	for k, v := range extra {
		data[k] = v
	}
	b, e := json.Marshal(data)
	if e != nil {
		t.Fatal(e)
	}
	var v Settings
	if e = json.Unmarshal(b, &v); e != nil {
		t.Fatal(e)
	}
	return v
}

func assertSettingsFields(t *testing.T, v Settings, want map[string]string) {
	t.Helper()
	b, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	var got map[string]any
	if e = json.Unmarshal(b, &got); e != nil {
		t.Fatal(e)
	}
	for k, value := range want {
		if got[k] != value {
			t.Errorf("%s = %v, want %q", k, got[k], value)
		}
	}
}

func TestLegacySettingsReadAndExportNormalizeWithoutWriting(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	if _, e = s.DB.Exec("UPDATE settings SET value=? WHERE id=1", legacySettings); e != nil {
		t.Fatal(e)
	}
	want := map[string]string{"design": "homegrid", "wallpaper": "none", "custom_accent": "", "background_strength": "subtle", "content_width": "standard", "columns": "auto", "group_columns": "1", "card_style": "cards"}
	v, e := s.Settings(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	assertSettingsFields(t, v, want)
	if v.Background != "/uploads/"+strings.Repeat("a", 64)+".png" || !v.Blur || v.Title != "Existing dashboard" || v.ShowDescriptions {
		t.Fatal("legacy preferences changed", v)
	}
	b, e := s.Export(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	assertSettingsFields(t, b.Settings, want)
	var stored string
	if e = s.DB.QueryRow("SELECT value FROM settings WHERE id=1").Scan(&stored); e != nil {
		t.Fatal(e)
	}
	if stored != legacySettings {
		t.Fatal("read/export rewrote stored settings")
	}
	for _, replace := range []bool{false, true} {
		raw := []byte(`{"version":1,"apps":[],"categories":[],"settings":` + legacySettings + `}`)
		d, e := ParseImport(raw)
		if e != nil {
			t.Fatal(e)
		}
		assertSettingsFields(t, *d.Settings, want)
		if _, e = s.Import(context.Background(), d, replace); e != nil {
			t.Fatal(e)
		}
		v, e = s.Settings(context.Background())
		if e != nil {
			t.Fatal(e)
		}
		assertSettingsFields(t, v, want)
	}
}

func TestExpandedSettingsPersistAndBackupRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	want := map[string]string{"design": "aurora", "wallpaper": "lagoon", "accent": "cyan", "custom_accent": "#12aBef", "background_strength": "vivid", "content_width": "full", "columns": "6", "group_columns": "3", "card_style": "list"}
	v := settingsFixture(t, want)
	if e = s.SaveSettings(context.Background(), v); e != nil {
		t.Fatal(e)
	}
	s.Close()
	s, e = Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	v, e = s.Settings(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	assertSettingsFields(t, v, want)
	b, e := s.Export(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if b.Version != 1 {
		t.Fatal("backup version changed")
	}
	raw, e := json.Marshal(b)
	if e != nil {
		t.Fatal(e)
	}
	d, e := ParseImport(raw)
	if e != nil {
		t.Fatal(e)
	}
	target, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer target.Close()
	if _, e = target.Import(context.Background(), d, true); e != nil {
		t.Fatal(e)
	}
	v, e = target.Settings(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	assertSettingsFields(t, v, want)
	if v.Background != "/uploads/"+strings.Repeat("a", 64)+".png" {
		t.Fatal("upload lost on round trip")
	}
}

func TestExpandedSettingsValidationRejectsInvalidBeforeWrites(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	var before string
	if e = s.DB.QueryRow("SELECT value FROM settings WHERE id=1").Scan(&before); e != nil {
		t.Fatal(e)
	}
	for field, values := range map[string][]string{
		"design": {"unknown", "../aurora", "gradient-dawn"}, "wallpaper": {"unknown", "https://example.com/x.svg", "graphite", "gradient-unknown"}, "accent": {"custom"},
		"custom_accent":       {"red", "#fff", "#12345678", "#12345g", "#123456;background:red", " #123456"},
		"background_strength": {"maximum"}, "content_width": {"huge"}, "columns": {"1", "7", "2.5"}, "group_columns": {"0", "4"}, "card_style": {"table"},
		"background": {"/uploads/../bad.png", "https://example.com/x.png"},
	} {
		for _, value := range values {
			t.Run(field+"/"+value, func(t *testing.T) {
				v := settingsFixture(t, map[string]string{field: value})
				if e := s.SaveSettings(context.Background(), v); !errors.Is(e, ErrInvalid) {
					t.Errorf("SaveSettings accepted invalid %s: %v", field, e)
				}
				raw, _ := json.Marshal(Backup{Version: 1, Settings: v})
				if _, e := ParseImport(raw); !errors.Is(e, ErrInvalid) {
					t.Errorf("ParseImport accepted invalid %s: %v", field, e)
				}
				if _, e := s.Import(context.Background(), ImportData{Settings: &v}, true); !errors.Is(e, ErrInvalid) {
					t.Errorf("Import accepted invalid %s: %v", field, e)
				}
			})
		}
	}
	var after string
	if e = s.DB.QueryRow("SELECT value FROM settings WHERE id=1").Scan(&after); e != nil {
		t.Fatal(e)
	}
	if before != after {
		t.Fatal("invalid settings changed database")
	}
}

func TestEmptyExpandedSettingsNormalizeOnSave(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	v := settingsFixture(t, map[string]string{"design": "", "wallpaper": "", "custom_accent": "", "background_strength": "", "content_width": "", "columns": "", "group_columns": "", "card_style": ""})
	if e = s.SaveSettings(context.Background(), v); e != nil {
		t.Fatal(e)
	}
	var raw string
	if e = s.DB.QueryRow("SELECT value FROM settings WHERE id=1").Scan(&raw); e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal([]byte(raw), &v); e != nil {
		t.Fatal(e)
	}
	assertSettingsFields(t, v, map[string]string{"design": "homegrid", "wallpaper": "none", "custom_accent": "", "background_strength": "subtle", "content_width": "standard", "columns": "auto", "group_columns": "1", "card_style": "cards"})
}

func TestAllDesignsAndLayoutOptionsAccepted(t *testing.T) {
	for field, values := range map[string][]string{
		"design": {"homegrid", "porcelain", "dune", "terracotta", "rosewood", "lavender", "forest", "lagoon", "arctic", "midnight", "aurora", "ember",
			"graphite", "paper", "nord", "mocha", "slate", "sakura"},
		"wallpaper": {"none", "homegrid", "porcelain", "dune", "terracotta", "rosewood", "lavender", "forest", "lagoon", "arctic", "midnight", "aurora", "ember",
			"gradient-dawn", "gradient-meadow", "gradient-tide", "gradient-sand", "gradient-blossom", "gradient-mist",
			"gradient-dusk", "gradient-nebula", "gradient-boreal", "gradient-ember", "gradient-deepsea", "gradient-carbon"},
		"accent": {"sage", "blue", "amber", "rose", "violet", "cyan"}, "custom_accent": {"", "#000000", "#FFFFFF"},
		"background_strength": {"subtle", "balanced", "vivid"}, "content_width": {"focused", "standard", "wide", "full"}, "columns": {"auto", "2", "3", "4", "5", "6"}, "group_columns": {"1", "2", "3"}, "card_style": {"cards", "tiles", "list"},
	} {
		for _, value := range values {
			if e := ValidateSettings(settingsFixture(t, map[string]string{field: value})); e != nil {
				t.Errorf("rejected %s=%q: %v", field, value, e)
			}
		}
	}
}
