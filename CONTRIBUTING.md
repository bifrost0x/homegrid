# Contributing

Keep changes focused and explain the user-visible problem, the intended behavior,
and how you verified it. Preserve unrelated local work. Use synthetic services
and credentials in examples, fixtures, screenshots, and reports.

## Local checks

Docker is the simplest way to validate the production build:

```sh
docker build --tag homegrid:check .
```

The Dockerfile builds the frontend before testing and vetting the Go backend.
For direct development, use Node.js 24 and the Go version declared in `go.mod`:

```sh
cd frontend
npm ci
npm test
npm run typecheck
npm run build
cd ..
go test ./...
go vet ./...
```

Build the frontend first: Go embeds the generated `web/dist` files. Include the
lockfile when deliberately changing frontend dependencies.

## Browser verification

Follow [tests/README.md](tests/README.md) for the disposable Compose project on
local port `8096`, including initial setup and persistence checks. The browser
scripts create accounts and modify dashboard data; some scenarios replace or
reset that data. Never point them at an existing personal or production instance.
Keep the owner's normal data volume and instance separate. Only remove a test
volume after confirming that it belongs to the disposable verification project.

Review screenshots and exported test output before sharing them: internal URLs,
service names, and settings may be private. The default CI runs unit tests, type
checks, Go checks, a container build with a browser sign-in regression, CodeQL,
and a redacted secret scan. Broader desktop/mobile browser workflows remain
local checks; their private resume state and artifacts are not uploaded by CI.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
