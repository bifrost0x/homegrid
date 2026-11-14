package store

import (
	"context"
	"strings"
	"testing"
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
