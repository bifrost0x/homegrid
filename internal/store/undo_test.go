package store

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func undoStore(t *testing.T) *Store {
	t.Helper()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func TestUnchangedSettingsAndOrderDoNotCreateUndo(t *testing.T) {
	s := undoStore(t)
	ctx := context.Background()
	settings, e := s.Settings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, token, e := s.SaveSettingsWithUndo(ctx, settings)
	if e != nil || token != "" {
		t.Fatal("unchanged settings advertised undo", token, e)
	}
	token, e = s.ReorderWithUndo(ctx, "applications", []int64{})
	if e != nil || token != "" {
		t.Fatal("unchanged order advertised undo", token, e)
	}
	records, e := s.PendingUndo(ctx)
	if e != nil || len(records) != 0 {
		t.Fatal("unexpected undo records", records, e)
	}
}
func undoApp(t *testing.T, s *Store, name string) App {
	t.Helper()
	a, e := s.SaveApp(context.Background(), App{Name: name, URL: "https://example.local", Favorite: true, IconColor: "blue"}, true)
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func TestDeleteUndoSurvivesRestartAndIsSingleUse(t *testing.T) {
	s := undoStore(t)
	ctx := context.Background()
	a := undoApp(t, s, "Keep exact")
	s.DB.Exec("UPDATE applications SET created_at='2001-01-01',updated_at='2002-01-01' WHERE id=?", a.ID)
	token, e := s.DeleteAppWithUndo(ctx, a.ID)
	if e != nil {
		t.Fatal(e)
	}
	if len(token) != 64 {
		t.Fatal(token)
	}
	dir := s.DataDir
	s.Close()
	s, e = Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	pending, e := s.PendingUndo(ctx)
	if e != nil || len(pending) != 1 || pending[0].Token != token {
		t.Fatal(pending, e)
	}
	if e = s.Undo(ctx, token); e != nil {
		t.Fatal(e)
	}
	apps, _ := s.Apps(ctx)
	if len(apps) != 1 || !reflect.DeepEqual(apps[0], a) {
		t.Fatal(apps, a)
	}
	var created, updated string
	s.DB.QueryRow("SELECT created_at,updated_at FROM applications WHERE id=?", a.ID).Scan(&created, &updated)
	if created != "2001-01-01" || updated != "2002-01-01" {
		t.Fatal(created, updated)
	}
	if e = s.Undo(ctx, token); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
}
func TestUndoConflictsAndExpiry(t *testing.T) {
	s := undoStore(t)
	ctx := context.Background()
	a := undoApp(t, s, "A")
	b := undoApp(t, s, "B")
	token, e := s.ReorderWithUndo(ctx, "applications", []int64{b.ID, a.ID})
	if e != nil {
		t.Fatal(e)
	}
	a.CategoryID = 1
	a.Name = "later edit"
	s.SaveApp(ctx, a, false)
	if e = s.Undo(ctx, token); e != nil {
		t.Fatal("name edit should survive order undo", e)
	}
	apps, _ := s.Apps(ctx)
	if apps[0].Name != "later edit" {
		t.Fatal(apps)
	}
	token, _ = s.ReorderWithUndo(ctx, "applications", []int64{b.ID, a.ID})
	s.Reorder(ctx, "applications", []int64{a.ID, b.ID})
	if e = s.Undo(ctx, token); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	pending, _ := s.PendingUndo(ctx)
	if len(pending) != 0 {
		t.Fatal(pending)
	}
	v, _ := s.Settings(ctx)
	v.Title = "New"
	_, token, e = s.SaveSettingsWithUndo(ctx, v)
	if e != nil {
		t.Fatal(e)
	}
	v.Title = "Later"
	s.SaveSettings(ctx, v)
	if e = s.Undo(ctx, token); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	token, _ = s.DeleteAppWithUndo(ctx, a.ID)
	s.DB.Exec("UPDATE undo_records SET expires_at=? WHERE token=?", time.Now().Add(-time.Hour).Unix(), token)
	if e = s.Undo(ctx, token); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
}
func TestUndoRecordFailureRollsBackMutation(t *testing.T) {
	s := undoStore(t)
	ctx := context.Background()
	a := undoApp(t, s, "A")
	if _, e := s.DB.Exec("CREATE TRIGGER reject_undo BEFORE INSERT ON undo_records BEGIN SELECT RAISE(ABORT,'test failure'); END"); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DeleteAppWithUndo(ctx, a.ID); e == nil {
		t.Fatal("expected failure")
	}
	apps, _ := s.Apps(ctx)
	if len(apps) != 1 {
		t.Fatal("delete not rolled back")
	}
	v, _ := s.Settings(ctx)
	v.Title = "Changed"
	if _, _, e := s.SaveSettingsWithUndo(ctx, v); e == nil {
		t.Fatal("expected failure")
	}
	got, _ := s.Settings(ctx)
	if got.Title == v.Title {
		t.Fatal("settings not rolled back")
	}
}
func TestExampleSeedIsAtomicAndNeverDuplicates(t *testing.T) {
	s := undoStore(t)
	ctx := context.Background()
	if e := s.SeedExamples(ctx); e != nil {
		t.Fatal(e)
	}
	apps, _ := s.Apps(ctx)
	if len(apps) != 4 {
		t.Fatal(apps)
	}
	for _, a := range apps {
		if !strings.HasPrefix(a.URL, "http://example.homegrid.invalid/") || !strings.HasPrefix(a.Icon, "service:") || !strings.Contains(strings.ToLower(a.Description), "example") {
			t.Fatal(a)
		}
	}
	if e := s.SeedExamples(ctx); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	again, _ := s.Apps(ctx)
	if !reflect.DeepEqual(apps, again) {
		t.Fatal("seed modified existing apps")
	}
}

func TestSettingsAndCategoryUndoAndConflict(t *testing.T) {
	s := undoStore(t)
	ctx := context.Background()
	before, _ := s.Settings(ctx)
	v := before
	v.Title = "Saved appearance"
	normalized, token, e := s.SaveSettingsWithUndo(ctx, v)
	if e != nil || normalized.Design == "" {
		t.Fatal(normalized, e)
	}
	if e = s.Undo(ctx, token); e != nil {
		t.Fatal(e)
	}
	after, _ := s.Settings(ctx)
	if after != before {
		t.Fatal(after, before)
	}
	cat, e := s.SaveCategory(ctx, Category{Name: "Media"}, true)
	if e != nil {
		t.Fatal(e)
	}
	token, e = s.ReorderWithUndo(ctx, "categories", []int64{cat.ID, 1})
	if e != nil {
		t.Fatal(e)
	}
	cat.Name = "Renamed"
	s.SaveCategory(ctx, cat, false)
	if e = s.Undo(ctx, token); e != nil {
		t.Fatal(e)
	}
	cats, _ := s.Categories(ctx)
	if cats[0].ID != 1 || cats[1].Name != "Renamed" {
		t.Fatal(cats)
	}
	a := undoApp(t, s, "A")
	b := undoApp(t, s, "B")
	token, e = s.ReorderWithUndo(ctx, "applications", []int64{b.ID, a.ID})
	if e != nil {
		t.Fatal(e)
	}
	a.CategoryID = cat.ID
	s.SaveApp(ctx, a, false)
	if e = s.Undo(ctx, token); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	token, e = s.DeleteAppWithUndo(ctx, a.ID)
	if e != nil {
		t.Fatal(e)
	}
	s.Delete(ctx, "categories", cat.ID)
	if e = s.Undo(ctx, token); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
}
func TestUndoRestoreFailureKeepsTokenAndTargetUnchanged(t *testing.T) {
	s := undoStore(t)
	ctx := context.Background()
	a := undoApp(t, s, "A")
	token, e := s.DeleteAppWithUndo(ctx, a.ID)
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.DB.Exec("CREATE TRIGGER reject_restore BEFORE INSERT ON applications BEGIN SELECT RAISE(ABORT,'test failure'); END")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Undo(ctx, token); e == nil {
		t.Fatal("expected restore failure")
	}
	pending, e := s.PendingUndo(ctx)
	if e != nil || len(pending) != 1 {
		t.Fatal(pending, e)
	}
	apps, _ := s.Apps(ctx)
	if len(apps) != 0 {
		t.Fatal(apps)
	}
	s.DB.Exec("DROP TRIGGER reject_restore")
	if e = s.Undo(ctx, token); e != nil {
		t.Fatal("token was consumed on failure", e)
	}
}
func TestUndoBoundedAndExpiredCleanup(t *testing.T) {
	s := undoStore(t)
	ctx := context.Background()
	v, _ := s.Settings(ctx)
	v.Title = "Expired change"
	_, token, e := s.SaveSettingsWithUndo(ctx, v)
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("UPDATE undo_records SET expires_at=? WHERE token=?", time.Now().Add(-time.Hour).Unix(), token)
	for i := 0; i < 1005; i++ {
		if i%2 == 0 {
			v.Title = "First layout"
		} else {
			v.Title = "Second layout"
		}
		if _, _, e = s.SaveSettingsWithUndo(ctx, v); e != nil {
			t.Fatal(e)
		}
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM undo_records").Scan(&n)
	if n != 1000 {
		t.Fatal(n)
	}
	s.DB.QueryRow("SELECT count(*) FROM undo_records WHERE token=?", token).Scan(&n)
	if n != 0 {
		t.Fatal("expired record retained")
	}
	records, e := s.PendingUndo(ctx)
	if e != nil || len(records) != 10 {
		t.Fatal(len(records), e)
	}
}
func TestSeedFailureRollsBackCategoriesAndApps(t *testing.T) {
	s := undoStore(t)
	ctx := context.Background()
	_, e := s.DB.Exec("CREATE TRIGGER reject_seed BEFORE INSERT ON applications WHEN NEW.name='Grafana' BEGIN SELECT RAISE(ABORT,'test failure'); END")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.SeedExamples(ctx); e == nil {
		t.Fatal("expected seed failure")
	}
	apps, _ := s.Apps(ctx)
	cats, _ := s.Categories(ctx)
	if len(apps) != 0 || len(cats) != 1 {
		t.Fatal(apps, cats)
	}
}
func TestServiceIconAllowlist(t *testing.T) {
	for _, icon := range []string{"service:nextcloud", "service:jellyfin", "service:grafana", "service:homeassistant", "service:authelia"} {
		if !ValidIcon(icon) {
			t.Fatal(icon)
		}
	}
	for _, icon := range []string{"service:unknown", "service:../nextcloud", "service:NEXTCLOUD", "https://remote.invalid/icon.svg"} {
		if ValidIcon(icon) {
			t.Fatal(icon)
		}
	}
}
