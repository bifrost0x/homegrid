package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestUpgradeFromInitialSchemaPreservesData(t *testing.T) {
	dir := t.TempDir()
	db, e := sql.Open("sqlite", filepath.Join(dir, "homegrid.db"))
	if e != nil {
		t.Fatal(e)
	}
	initial, e := migrations.ReadFile("migrations/001_initial.sql")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(string(initial)); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(1); INSERT INTO applications(id,name,url,category_id,sort_order) VALUES(42,'Existing','https://existing.local',1,5); INSERT INTO users(id,username,password_hash) VALUES(1,'owner','existing-hash'); INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES('existing-session',1,'existing-csrf',9999999999,1)"); e != nil {
		t.Fatal(e)
	}
	db.Close()
	upgraded, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer upgraded.Close()
	var favorite bool
	if e = upgraded.DB.QueryRow("SELECT favorite FROM applications WHERE id=42").Scan(&favorite); e != nil {
		t.Fatal(e)
	}
	if favorite {
		t.Fatal("existing app changed to favorite")
	}
	apps, e := upgraded.Apps(context.Background())
	if e != nil || len(apps) != 1 || apps[0].ID != 42 || apps[0].Name != "Existing" || apps[0].SortOrder != 5 {
		t.Fatal("upgrade modified existing applications", apps, e)
	}
	var hash string
	if e = upgraded.DB.QueryRow("SELECT password_hash FROM users WHERE username='owner'").Scan(&hash); e != nil || hash != "existing-hash" {
		t.Fatal("upgrade modified admin", hash, e)
	}
	if e = upgraded.DB.QueryRow("SELECT csrf_token FROM sessions WHERE token_hash='existing-session'").Scan(&hash); e != nil || hash != "existing-csrf" {
		t.Fatal("upgrade modified sessions", hash, e)
	}
	var n int
	upgraded.DB.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&n)
	if n != 4 {
		t.Fatal("pending migrations missing", n)
	}
}

func TestFavoritePersistsAfterRestart(t *testing.T) {
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.SaveApp(context.Background(), App{Name: "Favorite", URL: "https://favorite.local", CategoryID: 1, Favorite: true}, true)
	if e != nil {
		t.Fatal(e)
	}
	s.Close()
	s, e = Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	apps, e := s.Apps(context.Background())
	if e != nil || len(apps) != 1 || apps[0].ID != a.ID || !apps[0].Favorite {
		t.Fatal("favorite did not persist", apps, e)
	}
}

func TestUpgradeFavoritesSchemaPreservesPreferencesAndAccount(t *testing.T) {
	dir := t.TempDir()
	db, e := sql.Open("sqlite", filepath.Join(dir, "homegrid.db"))
	if e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"001_initial.sql", "002_favorites.sql"} {
		b, e := migrations.ReadFile("migrations/" + name)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.Exec(string(b)); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = db.Exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(1),(2); INSERT INTO categories(id,name,sort_order,collapsed) VALUES(8,'Existing category',3,1); INSERT INTO applications(id,name,url,category_id,sort_order,favorite,icon) VALUES(42,'Existing','https://existing.local',8,5,1,'builtin:cloud'); UPDATE settings SET value=json_set(value,'$.title','Existing dashboard','$.accent','blue'); INSERT INTO users(id,username,password_hash) VALUES(1,'owner','existing-hash'); INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES('existing-session',1,'existing-csrf',9999999999,1)`); e != nil {
		t.Fatal(e)
	}
	db.Close()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	var color string
	if e = s.DB.QueryRow("SELECT icon_color FROM applications WHERE id=42").Scan(&color); e != nil {
		t.Fatal(e)
	}
	if color != "auto" {
		t.Fatal("old app tint was not auto", color)
	}
	apps, e := s.Apps(context.Background())
	if e != nil || len(apps) != 1 || apps[0].ID != 42 || apps[0].CategoryID != 8 || apps[0].SortOrder != 5 || !apps[0].Favorite || apps[0].Icon != "builtin:cloud" {
		t.Fatal("migration modified app", apps, e)
	}
	settings, e := s.Settings(context.Background())
	if e != nil || settings.Title != "Existing dashboard" || settings.Accent != "blue" {
		t.Fatal("migration modified settings", settings, e)
	}
	var hash string
	s.DB.QueryRow("SELECT password_hash FROM users WHERE username='owner'").Scan(&hash)
	if hash != "existing-hash" {
		t.Fatal("migration modified password", hash)
	}
	s.DB.QueryRow("SELECT csrf_token FROM sessions WHERE token_hash='existing-session'").Scan(&hash)
	if hash != "existing-csrf" {
		t.Fatal("migration modified sessions", hash)
	}
	cats, e := s.Categories(context.Background())
	if e != nil || len(cats) != 2 || !cats[1].Collapsed || cats[1].Name != "Existing category" {
		t.Fatal("migration modified category", cats, e)
	}
}

func TestIconColorAndFavoritePersistAfterRestart(t *testing.T) {
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.SaveApp(context.Background(), App{Name: "Colored favorite", URL: "https://favorite.local", CategoryID: 1, Favorite: true, IconColor: "cyan"}, true)
	if e != nil {
		t.Fatal(e)
	}
	s.Close()
	s, e = Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	apps, e := s.Apps(context.Background())
	if e != nil || len(apps) != 1 || apps[0].ID != a.ID || !apps[0].Favorite || apps[0].IconColor != "cyan" {
		t.Fatal("appearance did not persist", apps, e)
	}
}
