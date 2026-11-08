# Releasing HomeGrid

Releases are published by `.github/workflows/release.yml` when a version tag
is pushed. Merges to `main` keep publishing `ghcr.io/bifrost0x/homegrid:latest`
through `image.yml`; a release adds immutable version tags and a GitHub release.

## What a release produces

- Container images `ghcr.io/bifrost0x/homegrid:X.Y.Z` and `:X.Y` (stable releases
  only) for AMD64 and ARM64, built from the tagged commit, with an SBOM and
  `mode=max` build provenance in the registry and a GitHub build attestation.
- A GitHub release with the notes from `docs/release-notes-X.Y.Z.md`, the image
  digest, an SPDX SBOM and a Compose file pinned to the release image.

The workflow refuses to publish when the tagged commit is not on `main`, when
the tag does not match every version source, when the changelog section or the
release notes are missing or still marked as prepared, when the tests fail, or
when the image has a fixable critical or high vulnerability.

## Steps

1. On a branch, set the version everywhere it is recorded:

   ```sh
   node scripts/release.mjs set X.Y.Z
   ```

2. Rename the changelog section to `## X.Y.Z - YYYY-MM-DD` and write
   `docs/release-notes-X.Y.Z.md` for users: highlights, upgrade notes and
   known limitations. Remove any "prepared" wording.
3. Check the result locally, then open and merge the pull request:

   ```sh
   node scripts/release.mjs check vX.Y.Z
   ```

4. Tag the merged commit on `main` and push the tag:

   ```sh
   git switch main && git pull --ff-only
   git tag -a vX.Y.Z -m "HomeGrid X.Y.Z"
   git push origin vX.Y.Z
   ```

5. Follow the Release workflow run. When it finishes, check the release page
   and verify the image:

   ```sh
   gh attestation verify oci://ghcr.io/bifrost0x/homegrid:X.Y.Z --repo bifrost0x/homegrid
   ```

A tag such as `vX.Y.Z-rc.1` creates a pre-release and only the full version
image tag. Published tags and images are not moved; fix problems with a new
patch release.

## Website

`site/` is deployed to GitHub Pages by `.github/workflows/pages.yml` on every
change to `main`. Pages must use **GitHub Actions** as its source in the
repository settings.
