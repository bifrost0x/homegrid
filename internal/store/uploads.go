package store

import (
	"context"
	"fmt"
	"regexp"
)

var uploadReference = regexp.MustCompile(`/uploads/([a-f0-9]{64}\.(?:png|jpg|webp))`)

// ReferencedUploads returns the file names of uploads that applications,
// settings or undo records still refer to. Undo records count because
// undoing a change may restore an icon or background that is otherwise unused.
func (s *Store) ReferencedUploads(ctx context.Context) (map[string]bool, error) {
	refs := map[string]bool{}
	for _, query := range []string{
		"SELECT icon FROM applications",
		"SELECT value FROM settings",
		"SELECT payload FROM undo_records",
	} {
		rows, e := s.DB.QueryContext(ctx, query)
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
