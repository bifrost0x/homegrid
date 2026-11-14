# HomeGrid Roadmap

HomeGrid is a self-hosted homepage for homelabs. This roadmap describes the
direction and the candidates under consideration. It is not a release-date
promise; issues, pull requests and release notes are the source of truth.

## Product direction

- Make the first minutes delightful: services should be recognized, look right
  and be arranged without manual work.
- Stay small: one container, one data volume, no cloud dependency, no
  telemetry, no Docker socket.
- Keep privileged actions explicit and server-validated; the dashboard never
  fetches service URLs unless a future feature is enabled on purpose.
- Work equally well on phones, tablets and large screens.

## Now: first public release

- Publish 0.1.0 through the tag-driven release workflow with versioned
  AMD64/ARM64 images, SBOM, provenance and a GitHub release
  ([docs/releasing.md](docs/releasing.md)).
- Launch the project website from `site/` on GitHub Pages.

## Next candidates

- **Optional reachability indicator** per application. This would be the first
  backend request to a service URL, so it must stay opt-in and bounded:
  administrator-configured targets only, strict timeouts, no redirects, and a
  plain up/down result.
- **Offline shell** for the installed web app, without caching dashboard data
  beyond the session.
- **Automatic group layout** that places small categories side by side.
- **Reverse proxy hint** when requests arrive through an untrusted proxy, since
  rate limits then apply to the proxy address.
- **Unused upload cleanup** with an explicit review step.

## Out of scope for now

Multi-user accounts, external identity providers, plugins and service
monitoring with history. These change the security model or the operating
footprint and need their own design first.
