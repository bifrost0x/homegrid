#!/bin/sh
# Scans a local container image with Trivy and passes any further arguments to
# `trivy image`. Trivy runs from its own image pinned by digest, so CI does not
# depend on downloading a release binary. The image is exported to a tarball,
# which avoids giving the scanner access to the Docker socket. Output files
# (for example an SBOM) are written to the current directory.
#
#   scripts/scan-image.sh homegrid:ci --scanners vuln --severity CRITICAL,HIGH --exit-code 1
set -eu

# aquasec/trivy:0.76.1 (multi-platform index)
TRIVY_IMAGE="aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c"

image="${1:?usage: scan-image.sh <image> [trivy image arguments]}"
shift

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
docker save "$image" --output "$work/image.tar"

cache="${TRIVY_CACHE_DIR:-$HOME/.cache/trivy}"
mkdir -p "$cache"

attempt=1
while ! docker pull --quiet "$TRIVY_IMAGE" >/dev/null; do
  if [ "$attempt" -ge 3 ]; then
    echo "unable to pull $TRIVY_IMAGE" >&2
    exit 1
  fi
  sleep $((attempt * 20))
  attempt=$((attempt + 1))
done

docker run --rm \
  --volume "$work:/scan:ro" \
  --volume "$cache:/root/.cache/trivy" \
  --volume "$PWD:/out" \
  --workdir /out \
  "$TRIVY_IMAGE" image --input /scan/image.tar "$@"
