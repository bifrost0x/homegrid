# Run HomeGrid with Docker

HomeGrid runs as one container with a named volume for SQLite and uploads. These
instructions use Docker with the Compose plugin and a local source checkout or
extracted source archive. A public registry image is not currently provided.
The source build needs internet access; normal operation uses bundled frontend
assets, icons and backgrounds. Optional browser favicons need access to the
configured service.

## First start

From the directory containing `compose.yaml`:

```sh
docker compose up --build -d --wait
docker compose ps
```

Open [localhost:8095](http://localhost:8095) and create the administrator account.
There are no default credentials. Finish setup before allowing other clients to
reach the installation.

Compose uses the project name `homegrid`, container `homegrid`, local image
`homegrid:0.1.0`, and volume `homegrid_homegrid_data`. The container runs as
UID/GID 65532 with `/data` writable, a read-only root filesystem, a temporary
`/tmp`, dropped capabilities, and no Docker socket. A fresh named volume needs
no manual permission changes.

## LAN access and HTTPS

The default host binding is `127.0.0.1:8095`. To allow LAN access, copy the
provided environment example:

```sh
cp .env.example .env
```

Edit `.env` and set:

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

## Everyday commands

```sh
docker compose logs --tail=100 -f
docker compose stop
docker compose start
docker compose restart
```

`restart` does not apply changed Compose settings. Use
`docker compose up -d --wait` after editing settings.

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

Create `compose.restore.yaml` alongside `compose.yaml`:

```yaml
volumes:
  homegrid_data:
    external: true
    name: homegrid_restore_01
```

Check the merged configuration, stop the current container, then start with the
restored volume:

```sh
docker compose -f compose.yaml -f compose.restore.yaml config
docker compose stop
docker compose -f compose.yaml -f compose.restore.yaml up -d --wait
```

Sign in and check applications, images and settings. Keep the original volume
until the restored installation is verified. Continue including both `-f`
arguments for subsequent commands if you keep this configuration. To return to
the original volume, stop the container and run `docker compose up -d --wait`
using only the original Compose file.

## Update and roll back

1. Make a full stopped-volume backup.
2. Update or replace the source checkout with the desired version.
3. Run `docker compose up --build -d --wait` and check `docker compose logs`.

Database migrations run at startup. For rollback, use the old source/image with
a restored pre-upgrade volume; schema downgrades are not supported. Preserve
your `.env` when replacing source files.

`docker compose down` removes the container and network while keeping data.
**Do not run `docker compose down -v` unless you intend to delete the data
volume**, including the administrator account, applications and uploaded files.
