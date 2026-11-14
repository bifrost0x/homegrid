package store

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestReferencedUploadsIncludeAppsSettingsAndUndo(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	name := func(c string) string { return strings.Repeat(c, 64) + ".png" }
	if _, e = s.DB.Exec("INSERT INTO applications(name,url,icon) VALUES('NAS','https://nas.home.arpa',?)", "/uploads/"+name("a")); e != nil {
		t.Fatal(e)
	}
	if _, e = s.DB.Exec("UPDATE settings SET value=json_set(value,'$.background',?)", "/uploads/"+name("b")); e != nil {
		t.Fatal(e)
	}
	if _, e = s.DB.Exec("INSERT INTO undo_records(token,kind,label,payload,expires_at,created_at) VALUES('t','delete-app','x',?,9999999999,1)", `{"icon":"/uploads/`+name("c")+`"}`); e != nil {
		t.Fatal(e)
	}
	refs, e := s.ReferencedUploads(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if len(refs) != 3 || !refs[name("a")] || !refs[name("b")] || !refs[name("c")] {
		t.Fatal(refs)
	}
}

func TestExpiredUndoRecordsDoNotProtectUploads(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	name := strings.Repeat("e", 64) + ".png"
	if _, e = s.DB.Exec("INSERT INTO undo_records(token,kind,label,payload,expires_at,created_at) VALUES('old','delete-app','x',?,1,0)", `{"icon":"/uploads/`+name+`"}`); e != nil {
		t.Fatal(e)
	}
	refs, e := s.ReferencedUploads(context.Background())
	if e != nil || refs[name] {
		t.Fatal("expired undo record protected an upload", refs, e)
	}
	var seen map[string]bool
	if e = s.WithUploadReferences(context.Background(), func(refs map[string]bool) error { seen = refs; return nil }); e != nil {
		t.Fatal(e)
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM undo_records").Scan(&n)
	if seen == nil || seen[name] || n != 0 {
		t.Fatal("expired undo records were not purged", seen, n)
	}
}

func TestReferenceWritesWaitForUploadCleanup(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	inside, release := make(chan struct{}), make(chan struct{})
	cleanup := make(chan error, 1)
	go func() {
		cleanup <- s.WithUploadReferences(context.Background(), func(map[string]bool) error {
			close(inside)
			<-release
			return nil
		})
	}()
	<-inside
	saved := make(chan error, 1)
	go func() {
		_, e := s.DB.Exec("INSERT INTO applications(name,url,icon) VALUES('NAS','https://nas.home.arpa',?)", "/uploads/"+strings.Repeat("f", 64)+".png")
		saved <- e
	}()
	select {
	case e := <-saved:
		t.Fatal("a reference was saved during cleanup", e)
	case <-time.After(200 * time.Millisecond):
	}
	close(release)
	if e := <-cleanup; e != nil {
		t.Fatal(e)
	}
	if e := <-saved; e != nil {
		t.Fatal(e)
	}
}
