package store

import (
	"context"
	"errors"
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
