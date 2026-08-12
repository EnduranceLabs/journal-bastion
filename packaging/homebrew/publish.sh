#!/usr/bin/env bash
set -euo pipefail

TAP_REPO="${TAP_REPO:-EnduranceLabs/homebrew-tap}"
FORMULA="packaging/homebrew/journal-bastion.rb"
VERSION="${VERSION:-$(node -p "require('./bastion/package.json').version")}"
# Scoped packages keep the scope in the path but drop it from the filename.
TARBALL_URL="https://registry.npmjs.org/@journal-labs/bastion/-/bastion-${VERSION}.tgz"

echo "Downloading tarball to compute sha256..."
SHA256=$(curl -fsSL "${TARBALL_URL}" | shasum -a 256 | cut -d' ' -f1)

echo "Updating formula for version ${VERSION}..."
sed -i '' "s|url \".*\"|url \"${TARBALL_URL}\"|" "${FORMULA}"
sed -i '' "s|sha256 \".*\"|sha256 \"${SHA256}\"|" "${FORMULA}"

echo "Formula updated locally. This script does not push to Homebrew."
echo "Before publishing, verify that ${TAP_REPO} is the correct tap and that you have access."
echo "Done."
