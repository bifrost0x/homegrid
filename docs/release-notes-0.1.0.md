# HomeGrid 0.1.0

Prepared release notes. The GitHub release has not been published. The public
container image is available as `ghcr.io/bifrost0x/homegrid:latest` for AMD64
and ARM64.

HomeGrid is licensed under the [Apache License 2.0](../LICENSE). Bundled
third-party artwork retains its separate licenses and credits.

HomeGrid is a self-hosted homepage for your homelab: one place to organize and
launch your services, built with Go, React and SQLite.

## Highlights

- Add services from 40 categorized templates with bundled logos and URL-only
  setup, or create your own application cards. Choose from 84 local icons.
- Keep favorites close, search with Ctrl+K or Cmd+K, and duplicate cards without
  saving until you are ready.
- Arrange applications and categories in the dashboard's Organize mode, using
  drag-and-drop, keyboard sorting or explicit controls.
- Pick from twelve designs and bundled backgrounds, customize colors and images,
  and choose responsive card, tile or list layouts.
- Preview appearance and layout together, then save or cancel. Undo supported
  deletions, ordering and appearance changes for 30 minutes, with persistent
  history and protection against conflicting edits.
- Export and preview imports of portable JSON configuration. Full volume backups
  also preserve uploads and the administrator account.

## Run it

From the directory containing `docker-compose.yml`, with Docker and Compose installed:

```sh
docker compose pull
docker compose up -d --wait
```

Open `http://<docker-host-ip>:8095` and create the first administrator.
No default credentials are provided. Compose publishes to all host interfaces;
complete setup from a trusted network and use HTTPS over untrusted networks.
See the [Docker guide](docker.md) for configuration, updates, backup and restore.

The production container runs one Go executable as UID/GID 65532, with embedded
frontend assets, a read-only root filesystem and a persistent data volume. It
does not need the Docker socket. Builds download dependencies; bundled icons and
backgrounds are available offline at runtime.

## Scope

This first release supports one local administrator. It does not include
multi-user management, external identity providers, recovery email, service
monitoring or plugins. Optional example cards require your own service URL before
launching. Browser favicon discovery depends on browser access to that service.

See the [changelog](../CHANGELOG.md) for the feature list and
[icon credits](third-party-icons.md) for bundled third-party artwork.
