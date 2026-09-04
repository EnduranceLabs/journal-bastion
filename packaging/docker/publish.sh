#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${IMAGE:-journal-bastion:local}"
version="$(node -p "require('$repo_dir/package.json').version")"
revision="$(git -C "$repo_dir" rev-parse HEAD)"
dockerfile="$repo_dir/packaging/docker/Dockerfile"
build_args=(
  --build-arg "IMAGE_VERSION=$version"
  --build-arg "VCS_REF=$revision"
)

if [ -n "${BASTION_TOOLS_IMAGE:-}" ]; then
  dockerfile="$repo_dir/packaging/docker/Dockerfile.prebuilt"
  build_args+=(--build-arg "TOOLS_IMAGE=$BASTION_TOOLS_IMAGE")
  echo "Using pinned prebuilt Go tools image: $BASTION_TOOLS_IMAGE"
else
  echo "BASTION_TOOLS_IMAGE is not set; using the legacy in-image Go build"
fi

echo "Building local Docker image: $image"
docker build \
  "${build_args[@]}" \
  -f "$dockerfile" \
  -t "$image" \
  "$repo_dir"

echo "Running Docker contract: $image"
BUILD_IMAGE=0 IMAGE="$image" EXPECTED_VERSION="$version" \
  "$repo_dir/testing/docker/run-contract.sh"

echo "Local image ready: $image"
echo "Production images are published only by .github/workflows/docker-release.yml."
