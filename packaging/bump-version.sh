#!/usr/bin/env bash
# Set the package version. One publishable package, so this is a single edit.
# Usage: packaging/bump-version.sh 0.9.0
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.].+)?$ ]]; then
  echo "Usage: $0 <version>   (e.g. $0 0.9.0)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

sed -i.bak -E "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$VERSION\"/" package.json
rm -f package.json.bak
echo "  package.json -> $VERSION"

# The Python client is unpublished but tracks the same version for clarity.
sed -i.bak -E "s/^version = \".*\"/version = \"$VERSION\"/" clients/python/pyproject.toml
rm -f clients/python/pyproject.toml.bak
echo "  clients/python/pyproject.toml -> $VERSION"

echo "Updating lockfile..."
pnpm install >/dev/null
echo "Done."
