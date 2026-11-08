# Changelog

## 0.1.0 (prepared)

The first HomeGrid release brings a self-hosted application launcher with one
local administrator, a Go backend, an embedded React frontend and SQLite storage.

- First-run administrator creation with no default credentials; password changes
  verify the current password and sign out other sessions.
- Application and category management, persistent favorites, duplication, and
  keyboard command search across names, descriptions and categories.
- Drag cards directly between categories, including empty or collapsed groups,
  with target-relative placement, touch/keyboard alternatives and atomic undo.
- Twelve locally bundled photographic wallpapers with matching palettes,
  lightweight previews and readable surfaces in both light and dark modes.
- Reverse-proxy-compatible origin checks for HTTPS-to-HTTP deployments, with
  distinct address and expired-session errors and unchanged CSRF token checks.
- 343 categorized service templates with local logos and URL-only setup;
  2,629 searchable icons, among them 2,585 service logos: the curated templates
  plus every other SVG icon of the pinned Dashboard Icons commit, minified
  without changing the artwork. Icon colors, browser favicons and raster image
  uploads.
  New applications recognize well-known services from their name, hostname,
  URL path or a distinctive default port and preselect the matching logo, with
  a clear hint and a one-click way to keep the previous icon. Existing
  applications with automatic or generic icons get reviewable logo suggestions,
  and imports fill in missing logos the same way. Bundled logos are
  synchronized from a pinned upstream commit by `scripts/sync-service-icons.mjs`,
  which verifies every file against its upstream blob hash and generates the
  backend allowlist and the icon credits. The icon picker shows popular
  services first and searches all logos by name and alias.
  Uploads are written atomically, so an interrupted write never leaves a
  truncated image behind.
- Calm application cards: edit, duplicate and delete live in a keyboard-accessible
  card menu; the favorite toggle appears on hover or focus and stays visible
  once set. The dashboard heading summarizes applications and categories.
- Optional example cards that require configuration before launch.
- In-dashboard Organize mode with drag-and-drop, keyboard and explicit sorting
  controls; empty categories are hidden during normal use.
- Appearance settings in clear layers: twenty presets, light/dark/system mode,
  eighteen surface palettes, named, extra and custom accents, and backgrounds
  from twelve generated gradients, twelve bundled photographs or your own
  image. A live preview lists what the current look is made of.
- Responsive dashboard widths, group and application columns, and card, tile or
  list layouts, with shared live preview, save and cancel controls.
- Persistent, atomic undo for application deletion, ordering and saved
  appearance/layout changes, with a 30-minute window and conflict protection.
- Versioned JSON export, validated import previews, merge and confirmed replace;
  compatibility with a simple Homarr-derived application list.
- A single non-root container with a read-only root filesystem, persistent data
  volume, built-in health check and no Docker socket requirement.
- Tag-driven releases: versioned AMD64/ARM64 images with SBOM, build provenance
  and a vulnerability scan gate, GitHub releases with a pinned Compose file, a
  weekly rescan of the published image, and a project website on GitHub Pages.
- Cached gzip delivery for embedded JavaScript and CSS; authenticated APIs,
  backups and uploaded files remain uncompressed.

This entry describes the prepared 0.1.0 source. Publication is pending.
