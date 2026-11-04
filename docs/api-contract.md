# API contract

All JSON endpoints return the resource directly (arrays for lists), errors `{ "error": { "code": "validation", "message": "..." } }`. IDs are numeric. PATCH accepts a full editable resource from the frontend. Empty DELETE responses are 204.

App: `{id,name,url,description,icon,category_id,sort_order,open_in_new_tab}`. Category: `{id,name,sort_order,collapsed}`. Default category id 1, name General, cannot be deleted.

Applications additionally include `favorite:boolean` (default false), persisted
by migration 002 and carried through create/update/export/import. Older backup
files without the field remain supported. The default category can be renamed;
its protected identity remains ID 1.

Settings: `{title,theme,accent,density,radius,background,blur,show_descriptions,design,wallpaper,custom_accent,background_strength,content_width,columns,group_columns,card_style}`.
Theme is system/light/dark; accent sage/blue/amber/rose/violet/cyan; density
comfortable/compact; radius rounded/square; background empty or a validated
`/uploads/id.ext` image path; blur and show_descriptions are booleans.
Design is homegrid/porcelain/dune/terracotta/rosewood/lavender/forest/lagoon/arctic/
midnight/aurora/ember; wallpaper accepts those IDs plus none. Custom_accent is
empty or `#RRGGBB` (case-insensitive hex). Background_strength is
subtle/balanced/vivid; content_width focused/standard/wide/full; columns
auto/2/3/4/5/6; group_columns 1/2/3; card_style cards/tiles/list. All eight new
fields are strings. Omitted or empty new fields normalize to
homegrid/none/empty/subtle/standard/auto/1/cards respectively on reads, saves,
and version-1 backup import/export. Reading or exporting legacy settings does
not rewrite their stored JSON. Existing custom background uploads are preserved.
Unsupported enum values or custom accent formats return validation errors before
writes; uploaded backgrounds remain subject to the existing path validation.

GET /api/auth/session returns `{setup_required,authenticated,username,csrf_token}`. When authenticated csrf_token is supplied and mutations include X-CSRF-Token. Login/setup POST `{username,password}` returns same session object and sets cookie. Public session query returns a pre-auth CSRF token cookie and response; setup/login must send X-CSRF-Token too. All browser requests use same-origin credentials. POST logout requires token.

CRUD /api/apps and /api/categories as specified. PUT /api/apps/reorder and /api/categories/reorder body `{ids:[...]}` containing ALL IDs of that resource. Application reorder also accepts optional `move:{id,category_id}` to move one application to an existing category and assign the complete order atomically with one persisted undo record. Invalid/incomplete IDs or unknown categories return 400 without changing state. Ordinary app edits can still change category via PATCH. Category collapsed saved by PATCH. GET/PATCH /api/settings.

Successful application DELETE, resource reorder and settings PATCH advertise a
persisted undo token in `X-HomeGrid-Undo` without changing their existing response
statuses or bodies. Unchanged settings/order do not create records. Authenticated
GET `/api/undo` returns up to ten available `{token,label,expires_at}` records,
newest first; expiry is RFC3339 UTC. POST `/api/undo` accepts `{token}` and requires
CSRF. It restores and consumes the record atomically, returns `{ok:true}`, or 409
if expired, replayed or conflicting. Tokens expire after 30 minutes; at most 1000
records are retained. Records are not part of configuration exports.

Authenticated, CSRF-protected POST `/api/examples` returns `{ok:true}` after seeding
four clearly marked example applications only if there are no applications.
Nonempty/repeated seed requests return 409. Settings, accounts and sessions are
preserved. `example.homegrid.invalid` URLs identify configuration-only examples;
the UI does not navigate to them. `service:<id>` icons accept only the forty local
catalog IDs, including `service:jellyfin` and `service:nextcloud`.

POST /api/uploads multipart form field file returns `{url}`. PNG/JPEG/WebP <=5MB, max 16 million pixels, authenticated serving /uploads/. Icons: `builtin:server`, `builtin:cloud`, `builtin:database`, `builtin:film`, `builtin:music`, `builtin:home`, `builtin:shield`, `builtin:code`, `builtin:globe`, `builtin:folder`, `builtin:network`, `builtin:hard-drive`; `favicon` for browser-only URL-origin favicon; or upload URL. No arbitrary icon URL.

GET /api/export returns `{version:1,apps:[...],categories:[...],settings:{...}}`. POST /api/import/preview body is raw backup JSON or Homarr-derived `{apps:[{name,url,category,icon}]}`; returns `{apps:number,categories:number,duplicates:number}`. POST /api/import/apply body `{data:<same parsed JSON>,mode:"merge"|"replace",confirm:true}`; returns `{imported:number}`. Replace preserves admin and sessions. Merge skips duplicate normalized URLs.

Health GET /api/health returns `{status:"ok",version,commit}`. Never exposes sensitive config.

POST `/api/auth/password` accepts `{current_password,new_password}`. It requires
an authenticated session, matching origin and CSRF token, and uses bounded
password-work concurrency and rate limiting. The new password must contain
12–1024 UTF-8 bytes. Incorrect current passwords and invalid changes return 400;
missing sessions return 401. Success atomically replaces the password hash,
invalidates all old sessions and creates a replacement session for the current
browser, returning the standard session object plus a rotated cookie/CSRF token.
Concurrent changes compare the verified hash and session inside the transaction.

Applications additionally include `icon_color`, one of `auto`, `sage`, `blue`,
`amber`, `rose`, `violet`, `cyan`. Migration 003 adds default `auto`. Omitted or
empty values in older requests/imports normalize to `auto`; unsupported values
return 400 before writes. All CRUD, ordering and backup paths preserve colors
and favorites. Bundled icon IDs now include the 44 identifiers in
`frontend/src/catalog.ts`; arbitrary icon URLs remain disallowed.

Only embedded JS/CSS negotiate cached gzip delivery. Responses vary on
Accept-Encoding; explicit q=0 is respected. HEAD uses the selected representation
length without a body, and byte-range requests use identity. A static request
that forbids both available representations returns 406. HTML, APIs, exports and
uploads are never compressed by this feature.
