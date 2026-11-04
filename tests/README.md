# Browser integration checks

`node tests/auth.mjs` requires a fresh disposable installation on local port
8096. It creates a temporary administrator with a one-character username through
the API and verifies sign-in in a separate browser session. Run it as a standalone
check: it leaves an account with a random password in that disposable data
directory. Remove and recreate that test volume before running the other browser
suites, which use their own administrator fixture. Container CI runs this
regression separately against its newly built image with ephemeral data.

The browser workflow operates on a separate Compose project and volume:

```sh
docker compose -p homegrid-verify -f docker-compose.yml -f tests/compose.verify.yaml up --build -d
node tests/browser.mjs
docker compose -p homegrid-verify -f docker-compose.yml -f tests/compose.verify.yaml restart
node tests/browser.mjs --persistence
```

The default target is `http://localhost:8096`. It must be a fresh disposable
installation for the initial run. Install dependencies with `npm ci` in frontend.
If necessary, install Chromium with `npx playwright install chromium` there.
Screenshots are written to test-results/. The test credentials exist only in
the disposable verification database; they are not production defaults.
Resume state can contain live test session cookies and undo tokens. Keep it
private; do not upload the entire test-results directory as a public artifact.

The persistence pass logs in and checks the application saved by the first pass.
Never point this workflow at an installation containing real data.

After the browser workflow, run `node tests/security.mjs` for HTTP protection
checks and `node tests/search-scale.mjs` for a 122-application search check. The
scale test removes its extra fixtures afterward. It leaves the two applications
from the main workflow intact.

`node tests/refinement.mjs` verifies favorites, Organize mode, settings tabs,
unsaved appearance previews and password/session rotation. It restores the test
password afterward. `node tests/a11y.mjs` runs axe checks across light/dark,
mobile, forms, search and settings; this is an automated check, not a formal
accessibility certification. Both scripts use the same disposable installation.
Restart the verification container between suites when running repeated sign-in
and password scenarios so independent suites do not share rate-limit state.

`node tests/quick-add.mjs` checks templates, editable URL/name handling, the icon
catalog, per-app colors, favorite preservation, explicit duplicate saving and
320px layout. It deletes only the applications it creates.
`node tests/static-delivery.mjs` compares raw identity/gzip bytes, negotiation,
HEAD and range responses, and confirms that API responses remain uncompressed.

`node tests/themes-layout.mjs` checks all twelve design drafts, explicit save and
cancel, custom color/wallpaper combinations, export persistence, responsive groups,
list view and all designs in both modes. It runs axe across desktop/mobile settings
and dashboard surfaces, writes screenshots/results and restores its own fixtures.
It requires the disposable installation on port 8096 after the browser workflow.

To also test container recreation, run the same Compose command with
`up -d --force-recreate --wait`, then repeat the persistence pass. Remove the
disposable installation with the verification Compose arguments and `down -v`.
The main installation on port 8095 uses a different project and volume.

`node tests/usability.mjs` checks settings actions/focus at 1440×1000, 390×844 and
320×568, delayed-save protection, failed-load recovery and emulated touch editing/
sorting/undo. Run after the browser workflow on the disposable installation.
Screenshots and eight accessibility scans are recorded under test-results/.

`node tests/product-quality.mjs` verifies first-run choices, optional example
configuration, URL-only catalog setup, image fallbacks, preview save/cancel,
reorder/layout undo, privacy requests and deletion undo. It prepares private
test state in test-results/. Recreate the verification container with `up -d
--force-recreate --wait`, then run `node tests/product-quality.mjs --resume` to
verify persisted deletion undo, restored identity, replay rejection and conflicts.
Both phases capture screenshots/axe results and enforce a local port-8096 target.
