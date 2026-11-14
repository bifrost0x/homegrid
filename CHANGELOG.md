# Changelog

## 0.1.0 - 2026-11-14

The first HomeGrid release brings a self-hosted application launcher with one
local administrator, a Go backend, an embedded React frontend and SQLite storage.

- First-run administrator creation with no default credentials; password changes
  verify the current password and sign out other sessions.
- Sessions stay signed in while the dashboard is in use: each visit extends the
  session to seven days, up to 30 days after sign-in. Then HomeGrid asks for the
  password again.
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
- Settings as an administration area: section navigation, a large sheet
  with a fixed action bar, an About section with version and project links,
  and an account menu in the top bar for every section and signing out.
  On a background, the top bar, heading and categories use frosted glass.
- When a service's logo is not bundled, HomeGrid asks the service for the icon
  it advertises (page links, web manifest, apple-touch-icon, favicon.ico) and
  stores a re-encoded copy, automatically while adding an application or on
  request with "From service". Lookups are administrator-only, refuse loopback,
  link-local and multicast addresses at connect time and never fetch SVG.
- Calm application cards: edit, duplicate and delete live in a keyboard-accessible
  card menu; the favorite toggle appears on hover or focus and stays visible
  once set. The dashboard heading summarizes applications and categories.
- Optional example cards that require configuration before launch.
- Optional web search in quick search: DuckDuckGo, Startpage, Brave Search,
  Google, Bing or a custom address such as a self-hosted SearXNG. Off by
  default; the browser opens the search in a new tab.
- Optional service status: when enabled in the layout settings, a dot after
  each application name shows whether its address answers. The server sends
  one HEAD request per address at most once a minute, follows no redirects,
  refuses loopback and link-local addresses and keeps no history.
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
- Import from Homepage (`services.yaml`, `bookmarks.yaml`), Homer (`config.yml`)
  and Dashy (`conf.yml`): names, links, descriptions and groups are carried
  over with logo recognition; widgets and non-HTTP(S) links are skipped and
  counted in the preview.
- A single non-root container with a read-only root filesystem, persistent data
  volume, built-in health check and no Docker socket requirement.
- Tag-driven releases: versioned AMD64/ARM64 images with SBOM, build provenance
  and a vulnerability scan gate, GitHub releases with a pinned Compose file, a
  weekly rescan of the published image, and a project website on GitHub Pages.
- Installable web app: a manifest, app icons and an SVG favicon with an ICO
  fallback let browsers show the HomeGrid icon in tabs and bookmarks and add
  HomeGrid to the home screen or install it as a standalone window.
- Unused image cleanup in the backup settings: review uploaded icons and
  backgrounds that nothing uses anymore, then delete them after confirming.
  Images referenced by a pending undo and uploads from the last 24 hours are
  kept.
- A hint in Settings → About and one log warning when requests arrive through
  a proxy outside `HOMEGRID_TRUSTED_PROXIES`, where rate limits would count
  every visitor as the proxy.
- Cached gzip delivery for embedded JavaScript and CSS; authenticated APIs,
  backups and uploaded files remain uncompressed.
