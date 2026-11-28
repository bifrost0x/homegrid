package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/bifrost0x/homegrid/internal/auth"
	"github.com/bifrost0x/homegrid/internal/store"
)

func TestResetPassword(t *testing.T) {
	dir := t.TempDir()
	var out bytes.Buffer
	if e := resetPassword(dir, &out); e == nil || !strings.Contains(e.Error(), "no HomeGrid database") {
		t.Fatal("reset without a database", e)
	}
	if _, e := os.Stat(filepath.Join(dir, "homegrid.db")); !os.IsNotExist(e) {
		t.Fatal("reset created a database", e)
	}
	db, e := store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	db.Close()
	if e := resetPassword(dir, &out); e == nil || !strings.Contains(e.Error(), "no administrator") {
		t.Fatal("reset before setup", e)
	}
	db, e = store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	hash, e := auth.Hash("an-old-test-password")
	if e != nil {
		t.Fatal(e)
	}
	if e = db.CreateAdministrator(context.Background(), "admin", hash); e != nil {
		t.Fatal(e)
	}
	if e = db.CreateSession(context.Background(), hash, "", "session-hash", "csrf", time.Now().Unix()); e != nil {
		t.Fatal(e)
	}
	db.Close()

	if e = resetPassword(dir, &out); e != nil {
		t.Fatal(e)
	}
	m := regexp.MustCompile(`New password: ([0-9a-f]{32})\n`).FindStringSubmatch(out.String())
	if m == nil {
		t.Fatal("no password printed", out.String())
	}
	db, e = store.Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	stored, e := db.PasswordHash(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if !auth.Verify(stored, m[1]) || auth.Verify(stored, "an-old-test-password") {
		t.Fatal("password not replaced")
	}
	var n int
	if e = db.DB.QueryRow("SELECT count(*) FROM sessions").Scan(&n); e != nil || n != 0 {
		t.Fatal("sessions survived the reset", n, e)
	}
}
