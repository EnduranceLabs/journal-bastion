#!/usr/bin/env bash
# Set the package version. One publishable package, so this is a single edit.
# Usage: packaging/bump-version.sh 0.1.0
#
# Uses node rather than sed: `sed -i` and the `0,/re/` range differ between GNU
# and BSD, and the BSD build ships on macOS, where this script silently did
# nothing.
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.].+)?$ ]]; then
  echo "Usage: $0 <version>   (e.g. $0 0.1.0)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node - "$VERSION" <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const version = process.argv[2];

// Guard on the pattern being present, not on the content changing, so that
// re-running with the current version stays a no-op instead of an error.
function setVersion(path, pattern, replacement) {
  const before = readFileSync(path, "utf8");
  if (!pattern.test(before)) {
    console.error(`ERROR: no version field found in ${path}`);
    process.exit(1);
  }
  writeFileSync(path, before.replace(pattern, replacement));
  console.log(`  ${path} -> ${version}`);
}

setVersion("package.json", /^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);
// The Python client is unpublished but tracks the same version for clarity.
setVersion(
  "clients/python/pyproject.toml",
  /^version = ".*"$/m,
  `version = "${version}"`
);
NODE

echo "Updating lockfile..."
pnpm install >/dev/null
echo "Done."
