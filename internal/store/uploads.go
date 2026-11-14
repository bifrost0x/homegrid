package store

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"time"
)

var uploadReference = regexp.MustCompile(`/uploads/([a-f0-9]{64}\.(?:png|jpg|webp))`)

type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// ReferencedUploads returns the file names of uploads that applications,
// settings or unexpired undo records refer to. Undo records count because
// undoing a change may restore an icon or background that is otherwise unused.
func (s *Store) ReferencedUploads(ctx context.Context) (map[string]bool, error) {
	return referencedUploads(ctx, s.DB, time.Now().Unix())
}

// WithUploadReferences calls fn with the current upload references inside a
// write transaction. No application, settings, import or undo change can add
// a reference until fn returns, so fn may delete files that are not in refs.
func (s *Store) WithUploadReferences(ctx context.Context, fn func(refs map[string]bool) error) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	// The purge is the transaction's first statement, so it takes SQLite's
	// write lock before the references are read.
	if _, e = tx.ExecContext(ctx, "DELETE FROM undo_records WHERE expires_at<=?", now); e != nil {
		return fmt.Errorf("purge expired undo records: %w", e)
	}
	refs, e := referencedUploads(ctx, tx, now)
	if e != nil {
		return e
	}
	if e = fn(refs); e != nil {
		return e
	}
	return tx.Commit()
}

func referencedUploads(ctx context.Context, q querier, now int64) (map[string]bool, error) {
	refs := map[string]bool{}
	for _, query := range []struct {
		sql  string
		args []any
	}{
		{"SELECT icon FROM applications", nil},
		{"SELECT value FROM settings", nil},
		{"SELECT payload FROM undo_records WHERE expires_at>?", []any{now}},
	} {
		rows, e := q.QueryContext(ctx, query.sql, query.args...)
		if e != nil {
			return nil, fmt.Errorf("read upload references: %w", e)
		}
		for rows.Next() {
			var v string
			if e = rows.Scan(&v); e != nil {
				rows.Close()
				return nil, fmt.Errorf("read upload references: %w", e)
			}
			for _, m := range uploadReference.FindAllStringSubmatch(v, -1) {
				refs[m[1]] = true
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, fmt.Errorf("read upload references: %w", e)
		}
	}
	return refs, nil
}
