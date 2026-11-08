package store

import (
	"context"
	"errors"
)

var ErrInvalidPasswordChange = errors.New("password or session changed")
var ErrSetupComplete = errors.New("administrator is already configured")
var ErrPasswordChanged = errors.New("password changed")

// MaxSessions bounds the session table; the oldest sessions are evicted first.
const MaxSessions = 100

// SessionByTokenHash returns the owner and CSRF token of an unexpired session.
func (s *Store) SessionByTokenHash(ctx context.Context, tokenHash string, now int64) (username, csrf string, err error) {
	err = s.DB.QueryRowContext(ctx, "SELECT users.username,sessions.csrf_token FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?", tokenHash, now).Scan(&username, &csrf)
	return username, csrf, err
}
func (s *Store) SetupRequired(ctx context.Context) (bool, error) {
	var n int
	e := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n)
	return n == 0, e
}

// CreateAdministrator inserts the sole user unless one already exists.
func (s *Store) CreateAdministrator(ctx context.Context, username, passwordHash string) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var n int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n); e != nil {
		return e
	}
	if n != 0 {
		return ErrSetupComplete
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO users(id,username,password_hash) VALUES(1,?,?)", username, passwordHash); e != nil {
		return e
	}
	return tx.Commit()
}

// Credentials returns the administrator's username and password hash, or sql.ErrNoRows before setup.
func (s *Store) Credentials(ctx context.Context) (username, passwordHash string, err error) {
	err = s.DB.QueryRowContext(ctx, "SELECT username,password_hash FROM users WHERE id=1").Scan(&username, &passwordHash)
	return username, passwordHash, err
}
func (s *Store) PasswordHash(ctx context.Context) (string, error) {
	var hash string
	e := s.DB.QueryRowContext(ctx, "SELECT password_hash FROM users WHERE id=1").Scan(&hash)
	return hash, e
}

// CreateSession compares the password verified before the transaction, purges expired
// sessions and the replaced session (when replacedTokenHash is set), inserts the new
// session and evicts the oldest sessions beyond MaxSessions.
func (s *Store) CreateSession(ctx context.Context, expectedPasswordHash, replacedTokenHash, tokenHash, csrf string, now int64) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var currentHash string
	if e = tx.QueryRowContext(ctx, "SELECT password_hash FROM users WHERE id=1").Scan(&currentHash); e != nil {
		return e
	}
	if currentHash != expectedPasswordHash {
		return ErrPasswordChanged
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at<=?", now); e != nil {
		return e
	}
	if replacedTokenHash != "" {
		if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=?", replacedTokenHash); e != nil {
			return e
		}
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,1,?,?,?)", tokenHash, csrf, now+86400, now); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT -1 OFFSET ?)", MaxSessions); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, e := s.DB.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=?", tokenHash)
	return e
}

// RotatePassword compares the password verified before the transaction, then commits
// the new password and sole replacement session together.
func (s *Store) RotatePassword(ctx context.Context, expectedHash, newHash, currentSessionHash, replacementSessionHash, csrf string, now int64) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	result, e := tx.ExecContext(ctx, `UPDATE users SET password_hash=? WHERE id=1 AND password_hash=? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=1 AND expires_at>?)`, newHash, expectedHash, currentSessionHash, now)
	if e != nil {
		return e
	}
	n, e := result.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return ErrInvalidPasswordChange
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sessions"); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,1,?,?,?)", replacementSessionHash, csrf, now+86400, now); e != nil {
		return e
	}
	return tx.Commit()
}
