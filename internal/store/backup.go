package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strings"
)

type Backup struct {
	Version    int        `json:"version"`
	Apps       []App      `json:"apps"`
	Categories []Category `json:"categories"`
	Settings   Settings   `json:"settings"`
}
type ImportData struct {
	Apps       []App
	Categories []Category
	Settings   *Settings
}
type Preview struct {
	Apps       int `json:"apps"`
	Categories int `json:"categories"`
	Duplicates int `json:"duplicates"`
}

func decodeStrict(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return fmt.Errorf("%w: malformed import: %v", ErrInvalid, e)
	}
	if e := d.Decode(new(any)); e != io.EOF {
		return fmt.Errorf("%w: import must contain one JSON object", ErrInvalid)
	}
	return nil
}
func ParseImport(raw []byte) (ImportData, error) {
	var header struct {
		Version int `json:"version"`
	}
	if e := json.Unmarshal(raw, &header); e != nil {
		return ImportData{}, fmt.Errorf("%w: malformed import", ErrInvalid)
	}
	out := ImportData{}
	if header.Version != 0 {
		if header.Version != 1 {
			return out, fmt.Errorf("%w: unsupported backup version", ErrInvalid)
		}
		var b Backup
		if e := decodeStrict(raw, &b); e != nil {
			return out, e
		}
		b.Settings = normalizeSettings(b.Settings)
		if e := ValidateSettings(b.Settings); e != nil {
			return out, e
		}
		out = ImportData{Apps: b.Apps, Categories: b.Categories, Settings: &b.Settings}
	} else {
		var b struct {
			Apps []struct {
				Name     string `json:"name"`
				URL      string `json:"url"`
				Category string `json:"category"`
				Icon     string `json:"icon"`
			} `json:"apps"`
		}
		if e := decodeStrict(raw, &b); e != nil {
			return out, e
		}
		if b.Apps == nil {
			return out, fmt.Errorf("%w: apps is required", ErrInvalid)
		}
		out.Categories = []Category{{ID: 1, Name: "General"}}
		byName := map[string]int64{"General": 1}
		for _, a := range b.Apps {
			name := strings.TrimSpace(a.Category)
			if name == "" {
				name = "General"
			}
			id, ok := byName[name]
			if !ok {
				id = int64(len(out.Categories) + 1)
				byName[name] = id
				out.Categories = append(out.Categories, Category{ID: id, Name: name, SortOrder: len(out.Categories)})
			}
			out.Apps = append(out.Apps, App{Name: a.Name, URL: a.URL, Icon: a.Icon, CategoryID: id, SortOrder: len(out.Apps), OpenInNewTab: true})
		}
	}
	if len(out.Apps) > 5000 || len(out.Categories) > 500 {
		return out, fmt.Errorf("%w: import exceeds 5000 apps or 500 categories", ErrInvalid)
	}
	ids := map[int64]bool{}
	hasDefault := false
	for i := range out.Categories {
		c := &out.Categories[i]
		if e := ValidateCategory(c); e != nil {
			return out, e
		}
		if c.ID < 1 || ids[c.ID] {
			return out, fmt.Errorf("%w: duplicate or invalid category ID", ErrInvalid)
		}
		ids[c.ID] = true
		if c.ID == 1 {
			hasDefault = true
		}
	}
	if !hasDefault {
		out.Categories = append([]Category{{ID: 1, Name: "General"}}, out.Categories...)
		ids[1] = true
	}
	for i := range out.Apps {
		a := &out.Apps[i]
		if e := ValidateApp(a); e != nil {
			return out, e
		}
		if !ids[a.CategoryID] {
			return out, fmt.Errorf("%w: app references unknown category", ErrInvalid)
		}
	}
	return out, nil
}
func NormalizedURL(v string) string {
	u, e := url.Parse(v)
	if e != nil {
		return v
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Fragment = ""
	u.Path = strings.TrimRight(u.Path, "/")
	if (u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80") {
		u.Host = u.Hostname()
		if strings.Contains(u.Host, ":") {
			u.Host = "[" + u.Host + "]"
		}
	}
	return u.String()
}
func (s *Store) Preview(ctx context.Context, d ImportData) (Preview, error) {
	existing, e := s.Apps(ctx)
	if e != nil {
		return Preview{}, e
	}
	seen := map[string]bool{}
	for _, a := range existing {
		seen[NormalizedURL(a.URL)] = true
	}
	p := Preview{Apps: len(d.Apps), Categories: len(d.Categories)}
	for _, a := range d.Apps {
		u := NormalizedURL(a.URL)
		if seen[u] {
			p.Duplicates++
		}
		seen[u] = true
	}
	return p, nil
}
func (s *Store) Import(ctx context.Context, d ImportData, replace bool) (int, error) {
	if d.Settings != nil {
		settings := normalizeSettings(*d.Settings)
		if e := ValidateSettings(settings); e != nil {
			return 0, e
		}
		d.Settings = &settings
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback()
	seen := map[string]bool{}
	if replace {
		if _, e = tx.ExecContext(ctx, "DELETE FROM applications"); e != nil {
			return 0, e
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM categories WHERE id<>1"); e != nil {
			return 0, e
		}
	} else {
		rows, e := tx.QueryContext(ctx, "SELECT url FROM applications")
		if e != nil {
			return 0, e
		}
		for rows.Next() {
			var u string
			if e = rows.Scan(&u); e != nil {
				rows.Close()
				return 0, e
			}
			seen[NormalizedURL(u)] = true
		}
		if e = rows.Err(); e != nil {
			rows.Close()
			return 0, e
		}
		rows.Close()
	}
	categoryMap := map[int64]int64{1: 1}
	for _, c := range d.Categories {
		if c.ID == 1 {
			if replace {
				if _, e = tx.ExecContext(ctx, "UPDATE categories SET name=?,sort_order=?,collapsed=? WHERE id=1", c.Name, c.SortOrder, c.Collapsed); e != nil {
					return 0, e
				}
			}
			continue
		}
		var id int64
		found := false
		if !replace {
			e = tx.QueryRowContext(ctx, "SELECT id FROM categories WHERE name=? ORDER BY id LIMIT 1", c.Name).Scan(&id)
			if e != nil && e != sql.ErrNoRows {
				return 0, e
			}
			found = e == nil
		}
		if !found {
			r, err := tx.ExecContext(ctx, "INSERT INTO categories(name,sort_order,collapsed) VALUES(?,(SELECT COALESCE(MAX(sort_order)+1,0) FROM categories),?)", c.Name, c.Collapsed)
			if err != nil {
				return 0, err
			}
			id, err = r.LastInsertId()
			if err != nil {
				return 0, err
			}
		}
		if replace {
			if _, e = tx.ExecContext(ctx, "UPDATE categories SET sort_order=? WHERE id=?", c.SortOrder, id); e != nil {
				return 0, e
			}
		}
		categoryMap[c.ID] = id
	}
	imported := 0
	for _, a := range d.Apps {
		u := NormalizedURL(a.URL)
		if !replace && seen[u] {
			continue
		}
		seen[u] = true
		if _, e = tx.ExecContext(ctx, "INSERT INTO applications(name,url,description,icon,category_id,sort_order,open_in_new_tab,favorite,icon_color) VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(sort_order)+1,0) FROM applications),?,?,?)", a.Name, a.URL, a.Description, a.Icon, categoryMap[a.CategoryID], a.OpenInNewTab, a.Favorite, a.IconColor); e != nil {
			return 0, e
		}
		imported++
	}
	if d.Settings != nil {
		b, e := json.Marshal(d.Settings)
		if e != nil {
			return 0, e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE settings SET value=? WHERE id=1", string(b)); e != nil {
			return 0, e
		}
	}
	return imported, tx.Commit()
}
func (s *Store) Export(ctx context.Context) (Backup, error) {
	b := Backup{Version: 1, Apps: []App{}, Categories: []Category{}}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return b, e
	}
	defer tx.Rollback()
	rows, e := tx.QueryContext(ctx, "SELECT id,name,url,description,icon,category_id,sort_order,open_in_new_tab,favorite,icon_color FROM applications ORDER BY sort_order,id")
	if e != nil {
		return b, e
	}
	for rows.Next() {
		var a App
		if e = rows.Scan(&a.ID, &a.Name, &a.URL, &a.Description, &a.Icon, &a.CategoryID, &a.SortOrder, &a.OpenInNewTab, &a.Favorite, &a.IconColor); e != nil {
			rows.Close()
			return b, e
		}
		b.Apps = append(b.Apps, a)
	}
	if e = rows.Err(); e != nil {
		rows.Close()
		return b, e
	}
	rows.Close()
	rows, e = tx.QueryContext(ctx, "SELECT id,name,sort_order,collapsed FROM categories ORDER BY sort_order,id")
	if e != nil {
		return b, e
	}
	for rows.Next() {
		var c Category
		if e = rows.Scan(&c.ID, &c.Name, &c.SortOrder, &c.Collapsed); e != nil {
			rows.Close()
			return b, e
		}
		b.Categories = append(b.Categories, c)
	}
	if e = rows.Err(); e != nil {
		rows.Close()
		return b, e
	}
	rows.Close()
	var settings string
	if e = tx.QueryRowContext(ctx, "SELECT value FROM settings WHERE id=1").Scan(&settings); e != nil {
		return b, e
	}
	if e = json.Unmarshal([]byte(settings), &b.Settings); e != nil {
		return b, e
	}
	b.Settings = normalizeSettings(b.Settings)
	return b, tx.Commit()
}
