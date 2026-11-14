# HomeGrid 0.1.0

The first release of HomeGrid, a self-hosted homepage for your homelab: one
place to organize and launch your services, built with Go, React and SQLite and
shipped as a single container for AMD64 and ARM64.

HomeGrid is licensed under the [Apache License 2.0](https://github.com/bifrost0x/homegrid/blob/v0.1.0/LICENSE). Bundled
third-party artwork retains its separate licenses and credits.

## Highlights

- Add services from 343 categorized templates with bundled logos and URL-only
  setup, or create your own cards. HomeGrid recognizes well-known services from
  the name, hostname or default port, searches 2,629 local icons, and can ask a
  service for its own icon when no bundled logo matches.
- Move over from another dashboard: import Homepage, Homer or Dashy
  configurations, or HomeGrid's own JSON backups, with a preview and merge or
  replace choices.
- Keep favorites close, find anything with Ctrl+K or Cmd+K, and optionally
  continue the search on the web with DuckDuckGo, Startpage, Brave Search,
  Google, Bing or your own SearXNG.
- Arrange applications and categories in Organize mode with drag-and-drop,
  keyboard or touch, and undo deletions, ordering and appearance changes for
  30 minutes.
- Twenty presets, eighteen surface palettes, custom accents, twelve gradients,
  twelve bundled photographs or your own background, and card, tile or list
  layouts, all previewed before saving.
- Optionally show whether each service answers. The check is off by default.
- Install HomeGrid on a phone's home screen or as a desktop app.
- Stay signed in while you use the dashboard: sessions extend to seven days on
  use and end at the latest 30 days after sign-in.

## Run it

From the directory containing `docker-compose.yml`, with Docker and Compose
installed:

```sh
docker compose pull
docker compose up -d --wait
```

Open `http://<docker-host-ip>:8095` and create the first administrator. No
default credentials are provided. Compose publishes to all host interfaces;
complete setup from a trusted network and use HTTPS over untrusted networks.
To stay on this release, set `HOMEGRID_IMAGE=ghcr.io/bifrost0x/homegrid:0.1.0`
in `.env`. See the [Docker guide](https://github.com/bifrost0x/homegrid/blob/v0.1.0/docs/docker.md) for configuration, updates, backup
and restore.

The container runs one Go executable as UID/GID 65532 with a read-only root
filesystem and a persistent data volume. It does not need the Docker socket.
Bundled icons and backgrounds work offline, and HomeGrid sends no telemetry.

## Privacy and network access

The server contacts a service only when you ask it to: once to fetch a logo
that is not bundled, and, if you turn on status checks, with one `HEAD` request
per application address at most once a minute. Both refuse loopback,
link-local and multicast addresses and verify certificates. Web searches are
opened by your browser, never by the server. Details are in
[SECURITY.md](https://github.com/bifrost0x/homegrid/blob/v0.1.0/SECURITY.md).

## Known limitations

- One local administrator. There is no multi-user management, external
  identity provider, recovery email or plugin system.
- Status checks report only up, down or unknown and keep no history. Services
  entered as `localhost` or `127.0.0.1` always show as unknown.
- JSON exports contain no images; use a full data-volume backup to keep
  uploaded icons and backgrounds.
- Homepage widgets and Dashy multi-page configurations are not imported.

See the [changelog](https://github.com/bifrost0x/homegrid/blob/v0.1.0/CHANGELOG.md) for the full feature list and the
[icon credits](https://github.com/bifrost0x/homegrid/blob/v0.1.0/docs/third-party-icons.md) for bundled third-party artwork.
