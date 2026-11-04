# Changelog

## 0.1.0 (prepared)

The first HomeGrid release brings a self-hosted application launcher with one
local administrator, a Go backend, an embedded React frontend and SQLite storage.

- First-run administrator creation with no default credentials; password changes
  verify the current password and sign out other sessions.
- Application and category management, persistent favorites, duplication, and
  keyboard command search across names, descriptions and categories.
- Forty categorized service templates with local logos and URL-only setup;
  84 searchable icons, icon colors, browser favicons and raster image uploads.
- Optional example cards that require configuration before launch.
- In-dashboard Organize mode with drag-and-drop, keyboard and explicit sorting
  controls; empty categories are hidden during normal use.
- Twelve designs with local backgrounds, light/dark/system modes, custom accents,
  background uploads and adjustable appearance.
- Responsive dashboard widths, group and application columns, and card, tile or
  list layouts, with shared live preview, save and cancel controls.
- Persistent, atomic undo for application deletion, ordering and saved
  appearance/layout changes, with a 30-minute window and conflict protection.
- Versioned JSON export, validated import previews, merge and confirmed replace;
  compatibility with a simple Homarr-derived application list.
- A single non-root container with a read-only root filesystem, persistent data
  volume, built-in health check and no Docker socket requirement.
- Cached gzip delivery for embedded JavaScript and CSS; authenticated APIs,
  backups and uploaded files remain uncompressed.

This entry describes the prepared 0.1.0 source. Publication is pending.
