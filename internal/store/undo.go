package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var ErrConflict = errors.New("conflict")

type UndoRecord struct {
	Token     string    `json:"token"`
	Label     string    `json:"label"`
	ExpiresAt time.Time `json:"expires_at"`
}
type savedApp struct {
	App
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}
type orderRow struct {
	ID         int64
	Order      int
	CategoryID int64
}
type undoPayload struct {
	Before  json.RawMessage
	After   json.RawMessage
	Deleted *savedApp `json:",omitempty"`
}

func undoConflict() error {
	return fmt.Errorf("%w: this action expired, was already undone, or its target has changed", ErrConflict)
}
func snapshot(ctx context.Context, tx *sql.Tx, kind string) (json.RawMessage, error) {
	if kind == "settings" {
		var raw string
		if e := tx.QueryRowContext(ctx, "SELECT value FROM settings WHERE id=1").Scan(&raw); e != nil {
			return nil, e
		}
		var v Settings
		if e := json.Unmarshal([]byte(raw), &v); e != nil {
			return nil, e
		}
		return json.Marshal(normalizeSettings(v))
	}
	if kind == "delete" {
		rows, e := tx.QueryContext(ctx, "SELECT id,name,url,description,icon,category_id,sort_order,open_in_new_tab,favorite,icon_color,created_at,updated_at FROM applications ORDER BY id")
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		out := []savedApp{}
		for rows.Next() {
			var a savedApp
			if e = rows.Scan(&a.ID, &a.Name, &a.URL, &a.Description, &a.Icon, &a.CategoryID, &a.SortOrder, &a.OpenInNewTab, &a.Favorite, &a.IconColor, &a.CreatedAt, &a.UpdatedAt); e != nil {
				return nil, e
			}
			out = append(out, a)
		}
		if e = rows.Err(); e != nil {
			return nil, e
		}
		return json.Marshal(out)
	}
	query := "SELECT id,sort_order,category_id FROM applications ORDER BY id"
	if kind == "categories" {
		query = "SELECT id,sort_order,0 FROM categories ORDER BY id"
	}
	rows, e := tx.QueryContext(ctx, query)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []orderRow{}
	for rows.Next() {
		var v orderRow
		if e = rows.Scan(&v.ID, &v.Order, &v.CategoryID); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	return json.Marshal(out)
}
func insertUndo(ctx context.Context, tx *sql.Tx, kind, label string, p undoPayload) (string, error) {
	var random [32]byte
	if _, e := rand.Read(random[:]); e != nil {
		return "", e
	}
	token := hex.EncodeToString(random[:])
	b, e := json.Marshal(p)
	if e != nil {
		return "", e
	}
	now := time.Now().Unix()
	if _, e = tx.ExecContext(ctx, "DELETE FROM undo_records WHERE expires_at<=?", now); e != nil {
		return "", e
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO undo_records(token,kind,label,payload,expires_at,created_at) VALUES(?,?,?,?,?,?)", token, kind, label, string(b), now+1800, now); e != nil {
		return "", e
	}
	_, e = tx.ExecContext(ctx, "DELETE FROM undo_records WHERE rowid NOT IN (SELECT rowid FROM undo_records ORDER BY created_at DESC,rowid DESC LIMIT 1000)")
	return token, e
}
func (s *Store) DeleteAppWithUndo(ctx context.Context, id int64) (string, error) {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return "", e
	}
	defer tx.Rollback()
	before, e := snapshot(ctx, tx, "delete")
	if e != nil {
		return "", e
	}
	var apps []savedApp
	if e = json.Unmarshal(before, &apps); e != nil {
		return "", e
	}
	var deleted *savedApp
	for i := range apps {
		if apps[i].ID == id {
			deleted = &apps[i]
			break
		}
	}
	if deleted == nil {
		return "", ErrNotFound
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM applications WHERE id=?", id); e != nil {
		return "", e
	}
	after, e := snapshot(ctx, tx, "applications")
	if e != nil {
		return "", e
	}
	token, e := insertUndo(ctx, tx, "delete", "Application deleted", undoPayload{After: after, Deleted: deleted})
	if e != nil {
		return "", e
	}
	return token, tx.Commit()
}
func (s *Store) ReorderWithUndo(ctx context.Context, kind string, ids []int64) (string, error) {
	if kind != "applications" && kind != "categories" {
		return "", ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return "", e
	}
	defer tx.Rollback()
	before, e := snapshot(ctx, tx, kind)
	if e != nil {
		return "", e
	}
	var order []orderRow
	if e = json.Unmarshal(before, &order); e != nil {
		return "", e
	}
	if len(ids) != len(order) {
		return "", fmt.Errorf("%w: include every ID exactly once", ErrInvalid)
	}
	seen := map[int64]bool{}
	for i, id := range ids {
		if seen[id] {
			return "", fmt.Errorf("%w: duplicate ID", ErrInvalid)
		}
		seen[id] = true
		r, e := tx.ExecContext(ctx, "UPDATE "+kind+" SET sort_order=? WHERE id=?", i, id)
		if e != nil {
			return "", e
		}
		n, e := r.RowsAffected()
		if e != nil {
			return "", e
		}
		if n != 1 {
			return "", fmt.Errorf("%w: unknown ID", ErrInvalid)
		}
	}
	after, e := snapshot(ctx, tx, kind)
	if e != nil {
		return "", e
	}
	if string(before) == string(after) {
		return "", tx.Commit()
	}
	label := "Applications reordered"
	if kind == "categories" {
		label = "Groups reordered"
	}
	token, e := insertUndo(ctx, tx, kind, label, undoPayload{Before: before, After: after})
	if e != nil {
		return "", e
	}
	return token, tx.Commit()
}
func (s *Store) SaveSettingsWithUndo(ctx context.Context, v Settings) (Settings, string, error) {
	v = normalizeSettings(v)
	if e := ValidateSettings(v); e != nil {
		return v, "", e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return v, "", e
	}
	defer tx.Rollback()
	before, e := snapshot(ctx, tx, "settings")
	if e != nil {
		return v, "", e
	}
	after, e := json.Marshal(v)
	if e != nil {
		return v, "", e
	}
	if string(before) == string(after) {
		return v, "", tx.Commit()
	}
	if _, e = tx.ExecContext(ctx, "UPDATE settings SET value=? WHERE id=1", string(after)); e != nil {
		return v, "", e
	}
	token, e := insertUndo(ctx, tx, "settings", "Appearance and layout saved", undoPayload{Before: before, After: after})
	if e != nil {
		return v, "", e
	}
	return v, token, tx.Commit()
}
func validUndo(ctx context.Context, tx *sql.Tx, kind string, p undoPayload) (bool, error) {
	snapshotKind := kind
	if kind == "delete" {
		snapshotKind = "applications"
	}
	current, e := snapshot(ctx, tx, snapshotKind)
	if e != nil {
		return false, e
	}
	if string(current) != string(p.After) {
		return false, nil
	}
	if kind == "delete" {
		if p.Deleted == nil {
			return false, nil
		}
		var n int
		if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM categories WHERE id=?", p.Deleted.CategoryID).Scan(&n); e != nil {
			return false, e
		}
		return n == 1, nil
	}
	return true, nil
}
func (s *Store) PendingUndo(ctx context.Context) ([]UndoRecord, error) {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	rows, e := tx.QueryContext(ctx, "SELECT token,label,expires_at,kind,payload FROM undo_records WHERE expires_at>? ORDER BY created_at DESC,rowid DESC LIMIT 1000", time.Now().Unix())
	if e != nil {
		return nil, e
	}
	type candidate struct {
		record    UndoRecord
		kind, raw string
	}
	all := []candidate{}
	for rows.Next() {
		var c candidate
		var expiry int64
		if e = rows.Scan(&c.record.Token, &c.record.Label, &expiry, &c.kind, &c.raw); e != nil {
			rows.Close()
			return nil, e
		}
		c.record.ExpiresAt = time.Unix(expiry, 0).UTC()
		all = append(all, c)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	out := []UndoRecord{}
	for _, c := range all {
		var p undoPayload
		if e = json.Unmarshal([]byte(c.raw), &p); e != nil {
			return nil, e
		}
		valid, e := validUndo(ctx, tx, c.kind, p)
		if e != nil {
			return nil, e
		}
		if valid {
			out = append(out, c.record)
			if len(out) == 10 {
				break
			}
		}
	}
	return out, nil
}
func (s *Store) Undo(ctx context.Context, token string) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var kind, raw string
	var expiry int64
	e = tx.QueryRowContext(ctx, "SELECT kind,payload,expires_at FROM undo_records WHERE token=?", token).Scan(&kind, &raw, &expiry)
	if errors.Is(e, sql.ErrNoRows) {
		return undoConflict()
	}
	if e != nil {
		return e
	}
	if expiry <= time.Now().Unix() {
		return undoConflict()
	}
	var p undoPayload
	if e = json.Unmarshal([]byte(raw), &p); e != nil {
		return e
	}
	valid, e := validUndo(ctx, tx, kind, p)
	if e != nil {
		return e
	}
	if !valid {
		return undoConflict()
	}
	switch kind {
	case "delete":
		a := p.Deleted
		_, e = tx.ExecContext(ctx, "INSERT INTO applications(id,name,url,description,icon,category_id,sort_order,open_in_new_tab,favorite,icon_color,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", a.ID, a.Name, a.URL, a.Description, a.Icon, a.CategoryID, a.SortOrder, a.OpenInNewTab, a.Favorite, a.IconColor, a.CreatedAt, a.UpdatedAt)
	case "settings":
		_, e = tx.ExecContext(ctx, "UPDATE settings SET value=? WHERE id=1", string(p.Before))
	case "applications", "categories":
		var order []orderRow
		if e = json.Unmarshal(p.Before, &order); e != nil {
			return e
		}
		for _, v := range order {
			if _, e = tx.ExecContext(ctx, "UPDATE "+kind+" SET sort_order=? WHERE id=?", v.Order, v.ID); e != nil {
				return e
			}
		}
	default:
		return undoConflict()
	}
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM undo_records WHERE token=?", token); e != nil {
		return e
	}
	return tx.Commit()
}

func (s *Store) SeedExamples(ctx context.Context) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var n int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM applications").Scan(&n); e != nil {
		return e
	}
	if n != 0 {
		return fmt.Errorf("%w: examples can only be loaded on an empty dashboard", ErrConflict)
	}
	groups := map[string]int64{}
	for _, name := range []string{"Storage", "Media", "Tools"} {
		var id int64
		e = tx.QueryRowContext(ctx, "SELECT id FROM categories WHERE name=? ORDER BY id LIMIT 1", name).Scan(&id)
		if errors.Is(e, sql.ErrNoRows) {
			var result sql.Result
			result, e = tx.ExecContext(ctx, "INSERT INTO categories(name,sort_order) VALUES(?,(SELECT COALESCE(MAX(sort_order)+1,0) FROM categories))", name)
			if e == nil {
				id, e = result.LastInsertId()
			}
		}
		if e != nil {
			return e
		}
		groups[name] = id
	}
	for i, app := range []struct{ name, id, group string }{{"Nextcloud", "nextcloud", "Storage"}, {"Jellyfin", "jellyfin", "Media"}, {"Grafana", "grafana", "Tools"}, {"Home Assistant", "homeassistant", "Tools"}} {
		if _, e = tx.ExecContext(ctx, "INSERT INTO applications(name,url,description,icon,category_id,sort_order,open_in_new_tab) VALUES(?,?,?,?,?,?,1)", app.name, "http://example.homegrid.invalid/"+app.id, "Example service — edit to configure your URL.", "service:"+app.id, groups[app.group], i); e != nil {
			return e
		}
	}
	return tx.Commit()
}
