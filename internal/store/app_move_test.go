package store

import (
	"errors"
	"reflect"
	"testing"
)

func TestAppMoveUndoSurvivesRestartAndPreservesLaterFields(t *testing.T) {
	s := undoStore(t)
	ctx := t.Context()
	a := undoApp(t, s, "A")
	b := undoApp(t, s, "B")
	target, err := s.SaveCategory(ctx, Category{Name: "Target"}, true)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := s.Apps(ctx)
	token, err := s.ReorderWithUndo(ctx, "applications", []int64{b.ID, a.ID}, AppMove{ID: a.ID, CategoryID: target.ID})
	if err != nil || len(token) != 64 {
		t.Fatal(token, err)
	}
	moved, _ := s.Apps(ctx)
	want := a
	want.CategoryID = target.ID
	want.SortOrder = 1
	if !reflect.DeepEqual(moved[1], want) {
		t.Fatal("move changed unrelated fields", moved, want)
	}
	dir := s.DataDir
	s.Close()
	reopened, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	pending, err := reopened.PendingUndo(ctx)
	if err != nil || len(pending) != 1 || pending[0].Token != token {
		t.Fatal(pending, err)
	}
	want.Name = "Later edit"
	want.Icon = "service:grafana"
	want.IconColor = "violet"
	want.Favorite = false
	if _, err = reopened.SaveApp(ctx, want, false); err != nil {
		t.Fatal(err)
	}
	if err = reopened.Undo(ctx, token); err != nil {
		t.Fatal(err)
	}
	restored, _ := reopened.Apps(ctx)
	before[0].Name = want.Name
	before[0].Icon = want.Icon
	before[0].IconColor = want.IconColor
	before[0].Favorite = want.Favorite
	if !reflect.DeepEqual(restored, before) {
		t.Fatal(restored, before)
	}
	if err = reopened.Undo(ctx, token); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
}

func TestAppMoveFailureRollsBackCategoryOrderAndUndo(t *testing.T) {
	for _, trigger := range []string{
		"CREATE TRIGGER reject_order BEFORE UPDATE OF sort_order ON applications WHEN NEW.sort_order=1 BEGIN SELECT RAISE(ABORT,'test failure'); END",
		"CREATE TRIGGER reject_undo BEFORE INSERT ON undo_records BEGIN SELECT RAISE(ABORT,'test failure'); END",
	} {
		t.Run(trigger, func(t *testing.T) {
			s := undoStore(t)
			a := undoApp(t, s, "A")
			b := undoApp(t, s, "B")
			cat, err := s.SaveCategory(t.Context(), Category{Name: "Target"}, true)
			if err != nil {
				t.Fatal(err)
			}
			before, _ := s.Apps(t.Context())
			if _, err = s.DB.Exec(trigger); err != nil {
				t.Fatal(err)
			}
			if _, err = s.ReorderWithUndo(t.Context(), "applications", []int64{b.ID, a.ID}, AppMove{ID: a.ID, CategoryID: cat.ID}); err == nil {
				t.Fatal("expected failure")
			}
			after, _ := s.Apps(t.Context())
			if !reflect.DeepEqual(before, after) {
				t.Fatal("partial move committed", after, before)
			}
			pending, err := s.PendingUndo(t.Context())
			if err != nil || len(pending) != 0 {
				t.Fatal(pending, err)
			}
		})
	}
}

func TestAppMoveUndoConflictsWithNewerMovesAndMissingSource(t *testing.T) {
	for _, change := range []string{"move", "order", "delete source"} {
		t.Run(change, func(t *testing.T) {
			s := undoStore(t)
			ctx := t.Context()
			a := undoApp(t, s, "A")
			b := undoApp(t, s, "B")
			source, err := s.SaveCategory(ctx, Category{Name: "Source"}, true)
			if err != nil {
				t.Fatal(err)
			}
			target, err := s.SaveCategory(ctx, Category{Name: "Target"}, true)
			if err != nil {
				t.Fatal(err)
			}
			a.CategoryID = source.ID
			if _, err = s.SaveApp(ctx, a, false); err != nil {
				t.Fatal(err)
			}
			token, err := s.ReorderWithUndo(ctx, "applications", []int64{b.ID, a.ID}, AppMove{ID: a.ID, CategoryID: target.ID})
			if err != nil {
				t.Fatal(err)
			}
			switch change {
			case "move":
				a.CategoryID = 1
				a.SortOrder = 1
				_, err = s.SaveApp(ctx, a, false)
			case "order":
				err = s.Reorder(ctx, "applications", []int64{a.ID, b.ID})
			case "delete source":
				err = s.Delete(ctx, "categories", source.ID)
			}
			if err != nil {
				t.Fatal(err)
			}
			before, _ := s.Apps(ctx)
			if err = s.Undo(ctx, token); !errors.Is(err, ErrConflict) {
				t.Fatal("expected conflict", err)
			}
			after, _ := s.Apps(ctx)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("conflicting undo changed apps", after, before)
			}
			pending, err := s.PendingUndo(ctx)
			if err != nil || len(pending) != 0 {
				t.Fatal(pending, err)
			}
		})
	}
}

func TestAppMoveWithoutOrderChangeAndNoop(t *testing.T) {
	s := undoStore(t)
	ctx := t.Context()
	a := undoApp(t, s, "A")
	cat, err := s.SaveCategory(ctx, Category{Name: "Target"}, true)
	if err != nil {
		t.Fatal(err)
	}
	token, err := s.ReorderWithUndo(ctx, "applications", []int64{a.ID}, AppMove{ID: a.ID, CategoryID: cat.ID})
	if err != nil || len(token) != 64 {
		t.Fatal("category-only move needs undo", token, err)
	}
	noop, err := s.ReorderWithUndo(ctx, "applications", []int64{a.ID}, AppMove{ID: a.ID, CategoryID: cat.ID})
	if err != nil || noop != "" {
		t.Fatal("unchanged move advertised undo", noop, err)
	}
	if err = s.Undo(ctx, token); err != nil {
		t.Fatal(err)
	}
	restored, _ := s.Apps(ctx)
	if len(restored) != 1 || !reflect.DeepEqual(restored[0], a) {
		t.Fatal(restored, a)
	}
}
