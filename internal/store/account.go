package store

import (
	"context"
	"errors"
)

var ErrInvalidPasswordChange = errors.New("password or session changed")

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
