#!/usr/bin/env bash
# Publish the single package, @journal/journal-bastion.
#
# The CLI, the hub library and the wire schemas all ship in this one package as
# subpath exports (".", "./hub", "./protocol"). There is nothing to keep in
# version lockstep any more, and the Python client in clients/python is not
# published at all.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "Checking npm login..."
if ! npm whoami --registry=https://registry.npmjs.org >/dev/null 2>&1; then
  echo "You are not logged in to npm. Run:" >&2
  echo "  npm login --registry=https://registry.npmjs.org" >&2
  exit 1
fi

echo "Building..."
pnpm build

echo "Publishing $(node -p "require('./package.json').name")@$(node -p "require('./package.json').version")..."
pnpm publish --access public --no-git-checks

echo "Done."
