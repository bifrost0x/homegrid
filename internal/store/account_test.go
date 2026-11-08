package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func passwordStore(t *testing.T) *Store {
	t.Helper()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	if _, e = s.DB.Exec("INSERT INTO users(id,username,password_hash) VALUES(1,'admin','old-hash'); INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES('old-session',1,'csrf',?,?)", time.Now().Add(time.Hour).Unix(), time.Now().Unix()); e != nil {
		t.Fatal(e)
	}
	return s
}
func TestConcurrentPasswordHashCompareAndSwap(t *testing.T) {
	s := passwordStore(t)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, hash := range []string{"new-hash-one", "new-hash-two"} {
		wg.Add(1)
		go func(hash string) {
			defer wg.Done()
			<-start
			results <- s.RotatePassword(context.Background(), "old-hash", hash, "old-session", "session-"+hash, "csrf-"+hash, time.Now().Unix())
		}(hash)
	}
	close(start)
	wg.Wait()
	close(results)
	success, rejected := 0, 0
	for e := range results {
		if e == nil {
			success++
		} else if errors.Is(e, ErrInvalidPasswordChange) {
			rejected++
		} else {
			t.Fatal(e)
		}
	}
	if success != 1 || rejected != 1 {
		t.Fatal("hash comparison did not serialize changes", success, rejected)
	}
	var hash, session string
	s.DB.QueryRow("SELECT password_hash FROM users").Scan(&hash)
	s.DB.QueryRow("SELECT token_hash FROM sessions").Scan(&session)
	if session != "session-"+hash {
		t.Fatal("password and session belong to different changes", hash, session)
	}
}
func TestPasswordRotationRollsBackOnSessionInsertFailure(t *testing.T) {
	s := passwordStore(t)
	if _, e := s.DB.Exec("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'session write failed'); END"); e != nil {
		t.Fatal(e)
	}
	if e := s.RotatePassword(context.Background(), "old-hash", "new-hash", "old-session", "new-session", "new-csrf", time.Now().Unix()); e == nil {
		t.Fatal("injected write failure ignored")
	}
	var hash, token string
	s.DB.QueryRow("SELECT password_hash FROM users").Scan(&hash)
	s.DB.QueryRow("SELECT token_hash FROM sessions").Scan(&token)
	if hash != "old-hash" || token != "old-session" {
		t.Fatal("failed rotation partially committed", hash, token)
	}
}
func TestExpiredSessionCannotRotatePassword(t *testing.T) {
	s := passwordStore(t)
	s.DB.Exec("UPDATE sessions SET expires_at=0")
	if e := s.RotatePassword(context.Background(), "old-hash", "new-hash", "old-session", "replacement", "csrf", time.Now().Unix()); !errors.Is(e, ErrInvalidPasswordChange) {
		t.Fatal("expired session changed password", e)
	}
	var hash string
	s.DB.QueryRow("SELECT password_hash FROM users").Scan(&hash)
	if hash != "old-hash" {
		t.Fatal(hash)
	}
}
func TestAdministratorSetupRunsOnce(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	ctx := context.Background()
	if required, e := s.SetupRequired(ctx); e != nil || !required {
		t.Fatal("fresh store does not require setup", required, e)
	}
	if _, _, e := s.Credentials(ctx); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal("credentials before setup", e)
	}
	if e := s.CreateAdministrator(ctx, "admin", "first-hash"); e != nil {
		t.Fatal(e)
	}
	if e := s.CreateAdministrator(ctx, "intruder", "second-hash"); !errors.Is(e, ErrSetupComplete) {
		t.Fatal("second setup accepted", e)
	}
	if required, e := s.SetupRequired(ctx); e != nil || required {
		t.Fatal("setup still required", required, e)
	}
	username, hash, e := s.Credentials(ctx)
	if e != nil || username != "admin" || hash != "first-hash" {
		t.Fatal("administrator overwritten", username, hash, e)
	}
	if hash, e = s.PasswordHash(ctx); e != nil || hash != "first-hash" {
		t.Fatal(hash, e)
	}
}
func TestSessionLookupIgnoresExpiredSessions(t *testing.T) {
	s := passwordStore(t)
	ctx := context.Background()
	now := time.Now().Unix()
	username, csrf, e := s.SessionByTokenHash(ctx, "old-session", now)
	if e != nil || username != "admin" || csrf != "csrf" {
		t.Fatal(username, csrf, e)
	}
	s.DB.Exec("UPDATE sessions SET expires_at=?", now)
	if _, _, e = s.SessionByTokenHash(ctx, "old-session", now); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal("expired session returned", e)
	}
	if _, _, e = s.SessionByTokenHash(ctx, "unknown", now); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal("unknown session returned", e)
	}
}
func TestCreateSessionRejectsChangedPassword(t *testing.T) {
	s := passwordStore(t)
	now := time.Now().Unix()
	s.DB.Exec("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES('expired',1,'csrf',?,?)", now-1, now-100)
	if e := s.CreateSession(context.Background(), "stale-hash", "old-session", "new-session", "new-csrf", now); !errors.Is(e, ErrPasswordChanged) {
		t.Fatal("stale password hash issued a session", e)
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
	if n != 2 {
		t.Fatal("rejected session creation changed sessions", n)
	}
}
func TestCreateSessionReplacesAndPurges(t *testing.T) {
	s := passwordStore(t)
	ctx := context.Background()
	now := time.Now().Unix()
	s.DB.Exec("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES('expired',1,'csrf',?,?),('other',1,'csrf',?,?)", now, now-100, now+100, now-50)
	if e := s.CreateSession(ctx, "old-hash", "old-session", "new-session", "new-csrf", now); e != nil {
		t.Fatal(e)
	}
	rows, e := s.DB.Query("SELECT token_hash FROM sessions ORDER BY token_hash")
	if e != nil {
		t.Fatal(e)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var v string
		rows.Scan(&v)
		got = append(got, v)
	}
	if len(got) != 2 || got[0] != "new-session" || got[1] != "other" {
		t.Fatal("unexpected sessions", got)
	}
	var csrf string
	var expires int64
	s.DB.QueryRow("SELECT csrf_token,expires_at FROM sessions WHERE token_hash='new-session'").Scan(&csrf, &expires)
	if csrf != "new-csrf" || expires != now+86400 {
		t.Fatal(csrf, expires)
	}
	if e = s.DeleteSession(ctx, "new-session"); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.SessionByTokenHash(ctx, "new-session", now); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal("deleted session returned", e)
	}
}
func TestCreateSessionEvictsOldestBeyondCap(t *testing.T) {
	s := passwordStore(t)
	now := time.Now().Unix()
	s.DB.Exec("UPDATE sessions SET created_at=?", now-1000)
	for i := 0; i < MaxSessions+5; i++ {
		if _, e := s.DB.Exec("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,1,'csrf',?,?)", fmt.Sprint("session-", i), now+3600, now-500+int64(i)); e != nil {
			t.Fatal(e)
		}
	}
	if e := s.CreateSession(context.Background(), "old-hash", "", "newest", "csrf", now); e != nil {
		t.Fatal(e)
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM sessions").Scan(&n)
	if n != MaxSessions {
		t.Fatal("session cap not enforced", n)
	}
	var oldest string
	s.DB.QueryRow("SELECT token_hash FROM sessions ORDER BY created_at LIMIT 1").Scan(&oldest)
	if oldest != "session-6" {
		t.Fatal("wrong sessions evicted", oldest)
	}
	if e := s.DB.QueryRow("SELECT 1 FROM sessions WHERE token_hash='newest'").Scan(&n); e != nil {
		t.Fatal("new session evicted", e)
	}
}
