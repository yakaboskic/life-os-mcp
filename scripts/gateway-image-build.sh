#!/usr/bin/env bash
# Build once in the verified job; deployment loads this exact image artifact.
set -euo pipefail
: "${LIFE_OS_RELEASE_SHA:?}"
[[ $LIFE_OS_RELEASE_SHA =~ ^[a-f0-9]{40}$ ]] || exit 2
output=${1:-release}
mkdir -p "$output"
image="life-os-web-gateway:$LIFE_OS_RELEASE_SHA"
docker build --platform linux/amd64 --provenance=false --label "org.opencontainers.image.revision=$LIFE_OS_RELEASE_SHA" --tag "$image" deploy/web-gateway
docker run --rm --platform linux/amd64 "$image" node --check server.mjs
docker save "$image" | gzip -n >"$output/gateway-image.tar.gz"
(cd "$output" && sha256sum gateway-image.tar.gz >gateway-image.tar.gz.sha256)
