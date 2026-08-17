#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${IMAGE:-journal-bastion:local}"
version="$(node -p "require('$repo_dir/package.json').version")"
revision="$(git -C "$repo_dir" rev-parse HEAD)"

echo "Building local Docker image: $image"
docker build \
  --build-arg "IMAGE_VERSION=$version" \
  --build-arg "VCS_REF=$revision" \
  -f "$repo_dir/packaging/docker/Dockerfile" \
  -t "$image" \
  "$repo_dir"

echo "Running Docker contract: $image"
BUILD_IMAGE=0 IMAGE="$image" EXPECTED_VERSION="$version" \
  "$repo_dir/testing/docker/run-contract.sh"

echo "Local image ready: $image"
echo "Production images are published only by .github/workflows/docker-release.yml."
