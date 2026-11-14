# HomeGrid Roadmap

HomeGrid is a self-hosted homepage for homelabs. This roadmap describes the
direction and the candidates under consideration. It is not a release-date
promise; issues, pull requests and release notes are the source of truth.

## Product direction

- Make the first minutes delightful: services should be recognized, look right
  and be arranged without manual work.
- Stay small: one container, one data volume, no cloud dependency, no
  telemetry, no Docker socket.
- Keep privileged actions explicit and server-validated; the server only
  contacts service URLs for icon lookups and opt-in status checks.
- Work equally well on phones, tablets and large screens.

## Now: first public release

- Publish 0.1.0 through the tag-driven release workflow with versioned
  AMD64/ARM64 images, SBOM, provenance and a GitHub release
  ([docs/releasing.md](docs/releasing.md)).
- Launch the project website from `site/` on GitHub Pages.

## Next candidates

- **Offline shell** for the installed web app, without caching dashboard data
  beyond the session.
- **Automatic group layout** that places small categories side by side.

## Out of scope for now

Multi-user accounts, external identity providers, plugins and service
monitoring with history. These change the security model or the operating
footprint and need their own design first.
