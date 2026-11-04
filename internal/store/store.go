package store

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/net/idna"
	_ "modernc.org/sqlite"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

//go:embed migrations/*.sql
var migrations embed.FS
var ErrNotFound = errors.New("not found")
var ErrInvalid = errors.New("invalid resource")

type Store struct {
	DB      *sql.DB
	DataDir string
}
type App struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	URL          string `json:"url"`
	Description  string `json:"description"`
	Icon         string `json:"icon"`
	CategoryID   int64  `json:"category_id"`
	SortOrder    int    `json:"sort_order"`
	OpenInNewTab bool   `json:"open_in_new_tab"`
	Favorite     bool   `json:"favorite"`
	IconColor    string `json:"icon_color"`
}
type Category struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
	Collapsed bool   `json:"collapsed"`
}
type Settings struct {
	Title              string `json:"title"`
	Theme              string `json:"theme"`
	Accent             string `json:"accent"`
	Density            string `json:"density"`
	Radius             string `json:"radius"`
	Background         string `json:"background"`
	Blur               bool   `json:"blur"`
	ShowDescriptions   bool   `json:"show_descriptions"`
	Design             string `json:"design"`
	Wallpaper          string `json:"wallpaper"`
	CustomAccent       string `json:"custom_accent"`
	BackgroundStrength string `json:"background_strength"`
	ContentWidth       string `json:"content_width"`
	Columns            string `json:"columns"`
	GroupColumns       string `json:"group_columns"`
	CardStyle          string `json:"card_style"`
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	info, err := os.Stat(dir)
	if err != nil {
		return nil, err
	}
	if err = os.Chmod(dir, info.Mode().Perm()&0700); err != nil {
		return nil, err
	}
	abs, err := filepath.Abs(filepath.Join(dir, "homegrid.db"))
	if err != nil {
		return nil, err
	}
	file, err := os.OpenFile(abs, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = file.Chmod(0600); err != nil {
		file.Close()
		return nil, err
	}
	if err = file.Close(); err != nil {
		return nil, err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if err = os.Chmod(abs+suffix, 0600); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}
	dbPath := filepath.ToSlash(abs)
	if !strings.HasPrefix(dbPath, "/") {
		dbPath = "/" + dbPath
	}
	u := url.URL{Scheme: "file", Path: dbPath}
	q := u.Query()
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{DB: db, DataDir: dir}
	if err = s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.DB.Close() }
func (s *Store) migrate() error {
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.Exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)"); e != nil {
		return e
	}
	entries, e := migrations.ReadDir("migrations")
	if e != nil {
		return e
	}
	for i, f := range entries {
		v := i + 1
		var count int
		if e = tx.QueryRow("SELECT count(*) FROM schema_migrations WHERE version=?", v).Scan(&count); e != nil {
			return e
		}
		if count != 0 {
			continue
		}
		b, e := migrations.ReadFile("migrations/" + f.Name())
		if e != nil {
			return e
		}
		if _, e = tx.Exec(string(b)); e != nil {
			return fmt.Errorf("migration %d: %w", v, e)
		}
		if _, e = tx.Exec("INSERT INTO schema_migrations VALUES(?)", v); e != nil {
			return e
		}
	}
	return tx.Commit()
}

var uploadPath = regexp.MustCompile(`^/uploads/[a-f0-9]{64}\.(png|jpg|webp)$`)

func ValidUpload(v string) bool { return uploadPath.MatchString(v) }
func ValidIcon(v string) bool {
	if v == "" || v == "favicon" || ValidUpload(v) {
		return true
	}
	for _, x := range []string{"server", "cloud", "database", "film", "music", "home", "shield", "code", "globe", "folder", "network", "hard-drive", "camera", "image", "book-open", "file-text", "notebook", "mail", "calendar", "clock", "router", "container", "monitor", "smartphone", "printer", "download", "archive", "rss", "link", "key", "lock", "wifi", "lightbulb", "heart", "gamepad", "map-pin", "terminal", "git-branch", "headphones", "search", "settings", "chart", "clipboard", "bookmark"} {
		if v == "builtin:"+x {
			return true
		}
	}
	for _, id := range []string{"jellyfin", "plex", "emby", "sonarr", "radarr", "lidarr", "audiobookshelf", "navidrome", "immich", "photoprism", "nextcloud", "syncthing", "paperlessngx", "vaultwarden", "homeassistant", "adguardhome", "pihole", "uptimekuma", "grafana", "prometheus", "portainer", "dockge", "proxmox", "truenas", "gitea", "forgejo", "gitlab", "mealie", "freshrss", "miniflux", "qbittorrent", "transmission", "sabnzbd", "kavita", "calibreweb", "linkwarden", "nginxproxymanager", "traefik", "authentik", "authelia"} {
		if v == "service:"+id {
			return true
		}
	}
	return false
}
func ValidateApp(a *App) error {
	if a.IconColor == "" {
		a.IconColor = "auto"
	}
	switch a.IconColor {
	case "auto", "sage", "blue", "amber", "rose", "violet", "cyan":
	default:
		return fmt.Errorf("%w: choose a supported icon color", ErrInvalid)
	}
	a.Name = strings.TrimSpace(a.Name)
	a.URL = strings.TrimSpace(a.URL)
	if a.CategoryID == 0 {
		a.CategoryID = 1
	}
	if !utf8.ValidString(a.Name) || len(a.Name) < 1 || len(a.Name) > 100 || len(a.Description) > 500 || len(a.URL) > 2048 || !ValidIcon(a.Icon) {
		return fmt.Errorf("%w: name, description, URL or icon is invalid", ErrInvalid)
	}
	u, e := url.Parse(a.URL)
	if e != nil || u.Host == "" || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return fmt.Errorf("%w: enter an HTTP or HTTPS URL without credentials", ErrInvalid)
	}
	if !validBrowserHost(u) {
		return fmt.Errorf("%w: enter a valid hostname and port (1–65535)", ErrInvalid)
	}
	return nil
}

func validBrowserHost(u *url.URL) bool {
	if strings.HasSuffix(u.Host, ":") {
		return false
	}
	if p := u.Port(); p != "" {
		n, e := strconv.Atoi(p)
		if e != nil || n < 1 || n > 65535 {
			return false
		}
	}
	host := u.Hostname()
	if strings.ContainsAny(host, "%\\\x00\r\n\t ") {
		return false
	}
	if strings.HasPrefix(u.Host, "[") {
		ip, e := netip.ParseAddr(host)
		return e == nil && ip.Is6() && ip.Zone() == ""
	}
	if strings.Contains(host, ":") {
		return false
	}
	ascii, e := idna.Lookup.ToASCII(host)
	if e != nil || ascii == "" {
		return false
	}
	labels := strings.Split(strings.TrimSuffix(ascii, "."), ".")
	last := labels[len(labels)-1]
	numeric := last != ""
	for _, c := range last {
		if c < '0' || c > '9' {
			numeric = false
			break
		}
	}
	if numeric || strings.HasPrefix(strings.ToLower(last), "0x") {
		ip, e := netip.ParseAddr(strings.TrimSuffix(ascii, "."))
		return e == nil && ip.Is4()
	}
	return true
}
func ValidateCategory(c *Category) error {
	c.Name = strings.TrimSpace(c.Name)
	if len(c.Name) < 1 || len(c.Name) > 80 {
		return fmt.Errorf("%w: category name must be 1–80 characters", ErrInvalid)
	}
	return nil
}
func normalizeSettings(v Settings) Settings {
	defaults := []struct {
		value    *string
		fallback string
	}{
		{&v.Design, "homegrid"}, {&v.Wallpaper, "none"},
		{&v.BackgroundStrength, "subtle"}, {&v.ContentWidth, "standard"},
		{&v.Columns, "auto"}, {&v.GroupColumns, "1"}, {&v.CardStyle, "cards"},
	}
	for _, d := range defaults {
		if *d.value == "" {
			*d.value = d.fallback
		}
	}
	return v
}

var customAccent = regexp.MustCompile(`^#[a-fA-F0-9]{6}$`)

func validDesign(v string) bool {
	switch v {
	case "homegrid", "porcelain", "dune", "terracotta", "rosewood", "lavender", "forest", "lagoon", "arctic", "midnight", "aurora", "ember":
		return true
	}
	return false
}

func ValidateSettings(v Settings) error {
	v = normalizeSettings(v)
	in := func(s string, vs ...string) bool {
		for _, v := range vs {
			if v == s {
				return true
			}
		}
		return false
	}
	if len(strings.TrimSpace(v.Title)) < 1 || len(v.Title) > 100 || !in(v.Theme, "system", "light", "dark") || !in(v.Accent, "sage", "blue", "amber", "rose", "violet", "cyan") || !in(v.Density, "comfortable", "compact") || !in(v.Radius, "rounded", "square") || (v.Background != "" && !ValidUpload(v.Background)) ||
		!validDesign(v.Design) || (v.Wallpaper != "none" && !validDesign(v.Wallpaper)) ||
		(v.CustomAccent != "" && !customAccent.MatchString(v.CustomAccent)) ||
		!in(v.BackgroundStrength, "subtle", "balanced", "vivid") || !in(v.ContentWidth, "focused", "standard", "wide", "full") ||
		!in(v.Columns, "auto", "2", "3", "4", "5", "6") || !in(v.GroupColumns, "1", "2", "3") || !in(v.CardStyle, "cards", "tiles", "list") {
		return fmt.Errorf("%w: invalid appearance settings", ErrInvalid)
	}
	return nil
}
func (s *Store) Apps(ctx context.Context) ([]App, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT id,name,url,description,icon,category_id,sort_order,open_in_new_tab,favorite,icon_color FROM applications ORDER BY sort_order,id")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []App{}
	for rows.Next() {
		var a App
		if e = rows.Scan(&a.ID, &a.Name, &a.URL, &a.Description, &a.Icon, &a.CategoryID, &a.SortOrder, &a.OpenInNewTab, &a.Favorite, &a.IconColor); e != nil {
			return nil, e
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func (s *Store) Categories(ctx context.Context) ([]Category, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT id,name,sort_order,collapsed FROM categories ORDER BY sort_order,id")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Category{}
	for rows.Next() {
		var c Category
		if e = rows.Scan(&c.ID, &c.Name, &c.SortOrder, &c.Collapsed); e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Store) SaveApp(ctx context.Context, a App, create bool) (App, error) {
	if e := ValidateApp(&a); e != nil {
		return a, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return a, e
	}
	defer tx.Rollback()
	var n int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM categories WHERE id=?", a.CategoryID).Scan(&n); e != nil {
		return a, e
	}
	if n == 0 {
		return a, fmt.Errorf("%w: category does not exist", ErrInvalid)
	}
	var r sql.Result
	if create {
		r, e = tx.ExecContext(ctx, "INSERT INTO applications(name,url,description,icon,category_id,sort_order,open_in_new_tab,favorite,icon_color) VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(sort_order)+1,0) FROM applications),?,?,?)", a.Name, a.URL, a.Description, a.Icon, a.CategoryID, a.OpenInNewTab, a.Favorite, a.IconColor)
		if e == nil {
			a.ID, e = r.LastInsertId()
		}
	} else {
		r, e = tx.ExecContext(ctx, "UPDATE applications SET name=?,url=?,description=?,icon=?,category_id=?,open_in_new_tab=?,favorite=?,icon_color=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", a.Name, a.URL, a.Description, a.Icon, a.CategoryID, a.OpenInNewTab, a.Favorite, a.IconColor, a.ID)
		if e == nil {
			n, e := r.RowsAffected()
			if e != nil {
				return a, e
			}
			if n == 0 {
				return a, ErrNotFound
			}
		}
	}
	if e != nil {
		return a, e
	}
	if e = tx.QueryRowContext(ctx, "SELECT sort_order FROM applications WHERE id=?", a.ID).Scan(&a.SortOrder); e != nil {
		return a, e
	}
	return a, tx.Commit()
}
func (s *Store) SaveCategory(ctx context.Context, c Category, create bool) (Category, error) {
	if e := ValidateCategory(&c); e != nil {
		return c, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return c, e
	}
	defer tx.Rollback()
	var r sql.Result
	if create {
		r, e = tx.ExecContext(ctx, "INSERT INTO categories(name,sort_order,collapsed) VALUES(?,(SELECT COALESCE(MAX(sort_order)+1,0) FROM categories),?)", c.Name, c.Collapsed)
		if e == nil {
			c.ID, e = r.LastInsertId()
		}
	} else {
		r, e = tx.ExecContext(ctx, "UPDATE categories SET name=?,collapsed=? WHERE id=?", c.Name, c.Collapsed, c.ID)
		if e == nil {
			n, e := r.RowsAffected()
			if e != nil {
				return c, e
			}
			if n == 0 {
				return c, ErrNotFound
			}
		}
	}
	if e != nil {
		return c, e
	}
	if e = tx.QueryRowContext(ctx, "SELECT sort_order FROM categories WHERE id=?", c.ID).Scan(&c.SortOrder); e != nil {
		return c, e
	}
	return c, tx.Commit()
}
func (s *Store) Delete(ctx context.Context, kind string, id int64) error {
	table := "applications"
	if kind == "categories" {
		table = "categories"
		if id == 1 {
			return fmt.Errorf("%w: General cannot be deleted", ErrInvalid)
		}
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if kind == "categories" {
		if _, e = tx.ExecContext(ctx, "UPDATE applications SET category_id=1,updated_at=CURRENT_TIMESTAMP WHERE category_id=?", id); e != nil {
			return e
		}
	}
	r, e := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE id=?", id)
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e != nil {
		return e
	}
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}
func (s *Store) Reorder(ctx context.Context, kind string, ids []int64) error {
	table := "applications"
	if kind == "categories" {
		table = "categories"
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var n int
	if e = tx.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&n); e != nil {
		return e
	}
	if len(ids) != n {
		return fmt.Errorf("%w: include every ID exactly once", ErrInvalid)
	}
	seen := map[int64]bool{}
	for i, id := range ids {
		if seen[id] {
			return fmt.Errorf("%w: duplicate ID", ErrInvalid)
		}
		seen[id] = true
		r, e := tx.ExecContext(ctx, "UPDATE "+table+" SET sort_order=? WHERE id=?", i, id)
		if e != nil {
			return e
		}
		n, e := r.RowsAffected()
		if e != nil {
			return e
		}
		if n != 1 {
			return fmt.Errorf("%w: unknown ID", ErrInvalid)
		}
	}
	return tx.Commit()
}
func (s *Store) Settings(ctx context.Context) (Settings, error) {
	var v Settings
	var b string
	e := s.DB.QueryRowContext(ctx, "SELECT value FROM settings WHERE id=1").Scan(&b)
	if e != nil {
		return v, e
	}
	e = json.Unmarshal([]byte(b), &v)
	return normalizeSettings(v), e
}
func (s *Store) SaveSettings(ctx context.Context, v Settings) error {
	v = normalizeSettings(v)
	if e := ValidateSettings(v); e != nil {
		return e
	}
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	_, e = s.DB.ExecContext(ctx, "UPDATE settings SET value=? WHERE id=1", string(b))
	return e
}
