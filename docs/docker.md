# Run HomeGrid with Docker

HomeGrid runs as one container with a named volume for SQLite and uploads. These
instructions use Docker with the Compose plugin and the public image
`ghcr.io/bifrost0x/homegrid:latest` for AMD64 and ARM64. Only
`docker-compose.yml` is required on the server; source code and build tools are
optional. Normal operation uses bundled assets, icons and backgrounds. Optional
browser favicons need access to the configured service.

## First start

From the directory containing `docker-compose.yml`:

```sh
docker compose pull
docker compose up -d --wait
docker compose ps
```

Open [localhost:8095](http://localhost:8095) and create the administrator account.
There are no default credentials. Finish setup before allowing other clients to
reach the installation.

Compose uses the project name `homegrid`, container `homegrid`, public image
`ghcr.io/bifrost0x/homegrid:latest`, and volume `homegrid_homegrid_data`. The container runs as
UID/GID 65532 with `/data` writable, a read-only root filesystem, a temporary
`/tmp`, dropped capabilities, and no Docker socket. A fresh named volume needs
no manual permission changes.

## LAN access and HTTPS

The registry image is public and can be pulled without signing in to GitHub.

The default host binding is `127.0.0.1:8095`. To allow LAN access, create or edit
`.env` alongside `docker-compose.yml` and set:

```dotenv
HOMEGRID_BIND_ADDRESS=0.0.0.0
HOMEGRID_PORT=8095
```

Apply changes with `docker compose up -d --wait`. Use your host's address to
connect. Opening the binding exposes HomeGrid on every host interface, subject
to the host firewall; choose a specific interface address if appropriate.

Use an HTTPS reverse proxy for access over an untrusted network. Set
`HOMEGRID_SECURE_COOKIE=true` when the browser accesses HomeGrid through HTTPS.
Set `HOMEGRID_TRUSTED_PROXIES` only to the CIDRs of proxies you control; leaving
it empty ignores forwarded headers. Preserve the original Host and Origin
headers through the proxy. A proxy on the host can use the default localhost
binding; a proxy in another container needs an appropriate shared network or
reachable host binding.

Compose reads `.env` for interpolation. `HOMEGRID_LISTEN` and
`HOMEGRID_DATA_DIR` are set explicitly inside the container to `0.0.0.0:8080`
and `/data`; native execution does not automatically read `.env`.

## Portainer stacks

Paste `docker-compose.yml` into Portainer's stack editor. For access from another
computer, add these variables in the stack's **Environment variables** section
before deploying or updating the stack:

```dotenv
HOMEGRID_BIND_ADDRESS=0.0.0.0
HOMEGRID_PORT=8095
```

Then open `http://<docker-host-ip>:8095`. Use the address of the Docker endpoint
managed by Portainer. The Portainer server may run on a different host. Complete
administrator setup from a trusted network before exposing the installation more
broadly.

Without `HOMEGRID_BIND_ADDRESS`, the Compose file publishes only to the Docker
host's loopback interface. A healthy container and a successful image build do
not mean the host port is reachable from the network. A `.env` file on your own
computer is not automatically available to a stack pasted into Portainer.

Alternatively, replace the stack's `ports` entry with an explicit mapping:

```yaml
ports:
  - "8095:8080"
```

This also publishes on all host interfaces. Keep the existing stack name and
`homegrid_data` volume when updating; do not delete the volume to repair a port
mapping. If the page is still unreachable, inspect the container's published
ports and health on the Docker endpoint:

```sh
docker port homegrid 8080/tcp
docker exec homegrid /homegrid healthcheck
```

The published port should show `0.0.0.0:8095` or the intended LAN address. If the
container is healthy and that mapping is present, check the host firewall and
reachability of that host from your browser. Direct port access uses HTTP unless
you have configured an HTTPS reverse proxy.

## Everyday commands

```sh
docker compose logs --tail=100 -f
docker compose stop
docker compose start
docker compose restart
```

`restart` does not apply changed Compose settings. Use
`docker compose up -d --wait` after editing settings.

## Optional source build

For development, use a source checkout with the additional
`docker-compose.dev.yml` override:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d --wait
```

This explicitly builds `homegrid:local` from the checkout. Continue including
both `-f` arguments when managing that development installation. The default
Compose file uses the public registry image.

## Back up

Settings → Backup exports portable JSON containing applications, categories and
appearance settings. It excludes passwords and sessions and references uploaded
image paths without embedding those files.

A full volume backup preserves the database, uploaded files and administrator
account. Treat it as sensitive. Stop HomeGrid for the entire copy; copying just
`homegrid.db` from a running SQLite WAL database is not a complete backup.

The following commands use a POSIX shell and a temporary Alpine helper container.
Run them from the project directory. The helper image may need downloading.

```sh
set -eu
docker volume inspect homegrid_homegrid_data >/dev/null
umask 077
mkdir -p backups
chmod 700 backups
backup_file="homegrid-data-$(date -u +%Y%m%dT%H%M%SZ).tgz"
# Create privately as the invoking user; refuse to overwrite an existing backup.
( set -C; : > "backups/$backup_file" )
docker compose stop
docker run --rm --network none --read-only \
  --mount type=volume,source=homegrid_homegrid_data,target=/data,readonly \
  --mount "type=bind,source=$PWD/backups,target=/backup" \
  alpine:3.22@sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f tar -czf "/backup/$backup_file" -C /data .
docker compose start
```

The private directory and pre-created archive protect the initial copy, not just
its eventual destination. The helper writes that existing file, preserving the
invoking user's ownership and `0600` mode on POSIX hosts. Creating a file only
inside the root helper can instead leave a root-owned or world-readable archive.
On hosts without POSIX permission enforcement, restrict the backup directory's
host ACL to the backup operator before copying sensitive data.

If the copy fails, these commands leave HomeGrid stopped. Resolve the error,
retry the copy, then run `docker compose start`. Copy successful backups to a
separate protected location and test restoration before relying on them.

## Restore safely

Restore into a **new** named volume so the current installation remains available
for recovery. The commands below stop if the example volume name is already in
use. Replace the example archive filename before running them:

```sh
set -eu
if docker volume inspect homegrid_restore_01 >/dev/null 2>&1; then
  echo "Choose a new restore volume name; homegrid_restore_01 already exists." >&2
  exit 1
fi
docker volume create homegrid_restore_01
docker run --rm --network none --read-only \
  --mount type=volume,source=homegrid_restore_01,target=/restore \
  --mount "type=bind,source=$PWD/backups,target=/backup,readonly" \
  alpine:3.22@sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f tar -xzf /backup/REPLACE_WITH_BACKUP_FILENAME.tgz -C /restore
```

Restore only archives you trust. If extraction fails, leave the original
installation in place and use a new empty restore volume for your next attempt.

Create `compose.restore.yaml` alongside `docker-compose.yml`:

```yaml
volumes:
  homegrid_data:
    external: true
    name: homegrid_restore_01
```

Check the merged configuration, stop the current container, then start with the
restored volume:

```sh
docker compose -f docker-compose.yml -f compose.restore.yaml config
docker compose stop
docker compose -f docker-compose.yml -f compose.restore.yaml up -d --wait
```

Sign in and check applications, images and settings. Keep the original volume
until the restored installation is verified. Continue including both `-f`
arguments for subsequent commands if you keep this configuration. To return to
the original volume, stop the container and run `docker compose up -d --wait`
using only the original Compose file.

## Update and roll back

1. Make a full stopped-volume backup.
2. Run `docker compose pull` to download the current image.
3. Run `docker compose up -d --wait` and check `docker compose logs`.

`latest` is a moving tag. For repeatable deployments or rollback, set
`HOMEGRID_IMAGE` to a recorded `ghcr.io/bifrost0x/homegrid@sha256:...` digest.

Database migrations run at startup. For rollback, use the old source/image with
a restored pre-upgrade volume; schema downgrades are not supported. Preserve
your `.env` and Compose overrides when updating deployment files.

`docker compose down` removes the container and network while keeping data.
**Do not run `docker compose down -v` unless you intend to delete the data
volume**, including the administrator account, applications and uploaded files.
