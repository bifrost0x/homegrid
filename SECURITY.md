# Security

## Supported versions

Security fixes target the latest `0.1.x` release. Update to the latest patch
release before reporting an issue. Earlier release lines and unreleased commits
do not have a separate maintenance commitment.

## Reporting a vulnerability

Keep vulnerability details private while maintainers assess the report. Use
[GitHub private vulnerability reporting](https://github.com/bifrost0x/homegrid/security/advisories/new)
to contact the maintainer. If that option is unavailable, ask a maintainer for a
private reporting channel without posting exploit details.
Do not open a public issue containing a vulnerability or send sensitive material
until a private channel has been established.

Include the affected version, deployment method, expected behavior, observed
behavior, and a minimal reproduction using synthetic data. Describe the access
an attacker needs and the impact you observed. Remove passwords, session cookies,
tokens, private service URLs, database files, and personal data from the report.
Dashboard exports can disclose internal service names and addresses even when
they contain no authentication secrets; treat them as sensitive configuration.

Maintainers will assess reports and coordinate fixes and disclosure as capacity
allows. There is no guaranteed response deadline or formal security certification.

## Deployment guidance

Use HTTPS at a trusted reverse proxy and enable secure cookies when serving over
HTTPS. Protect access to the dashboard, its data volume, backups, and exports.
Keep dependencies and the container image updated. Do not publish real `.env`
files, database files, or private screenshots in issues or pull requests.

See the deployment and security notes in [README.md](README.md) for configuration
and the current security boundaries.
