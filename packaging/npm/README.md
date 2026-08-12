# Publishing

Internal guide for releasing the Journal Bastion packages and container image.

All packages release in **lockstep** — the same version number every time, so a
customer can trust that the bastion, TypeScript client, protocol package, and
Python client speak the same protocol when installed at the same version. Bump
them together with the script below; never edit versions by hand. The npm and
PyPI publish scripts run `packaging/check-lockstep.sh` and refuse to publish if
the four versions disagree.

## Packages

| Package | Registry | Location |
|---------|----------|----------|
| `journal-bastion` | npm | `bastion/` |
| `journal-bastion-client` | npm | `clients/typescript/` |
| `journal-bastion-protocol` | npm | `protocol/` |
| `journal-bastion-client` | PyPI | `clients/python/` |

## First-time setup

- npm: `npm login --registry=https://registry.npmjs.org`
- PyPI: use Python 3.11+ (`PYTHON=/path/to/python3.11` if `python3` is
  older), configure a token in `~/.pypirc` (or `TWINE_*` env vars), and install
  build tools with `${PYTHON:-python3} -m pip install build twine`
- Docker: authenticate to `ghcr.io/endurancelabs` with permission to push
  `journal-bastion`

## How to release

### 1. Bump every package to the same version

```bash
VERSION=0.8.1 # replace with the release version
./packaging/bump-version.sh "$VERSION"
```

This rewrites the version in all three `package.json` files and
`clients/python/pyproject.toml`, then updates the lockfile.

### 2. Commit the bump

```bash
git add -A && git commit -m "Bump version to $VERSION"
```

Open and merge the version-bump PR before publishing. Then sync `main` and tag
the release commit:

```bash
git checkout main
git pull --ff-only
git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

### 3. Publish npm packages

```bash
./packaging/npm/publish.sh
```

Builds all packages, then publishes `journal-bastion-protocol` first (the others
depend on it), followed by `journal-bastion` and the npm
`journal-bastion-client`.

If npm requires browser-based authentication, run the script from an interactive
terminal and open the URL that npm prints. A non-interactive agent session can
fail with `EOTP` even when the account is valid. If the script stops after one
or more packages publish, do not rerun blindly; npm versions are immutable. Check
which packages are already live and publish only the missing package if needed:

```bash
npm view journal-bastion-protocol@"$VERSION" version
npm view journal-bastion@"$VERSION" version
npm view journal-bastion-client@"$VERSION" version
```

The npm packages were previously published as `@journal.one/bastion`,
`@journal.one/bastion-client`, and `@journal.one/bastion-protocol`. If the old
scoped packages are not already deprecated, deprecate them after the unscoped
packages are published and verified:

```bash
npm deprecate @journal.one/bastion@"<=0.7.0" "Renamed to journal-bastion. Install journal-bastion@0.8.0 or newer."
npm deprecate @journal.one/bastion-client@"<=0.7.0" "Renamed to journal-bastion-client. Install journal-bastion-client@0.8.0 or newer."
npm deprecate @journal.one/bastion-protocol@"<=0.7.0" "Renamed to journal-bastion-protocol. Install journal-bastion-protocol@0.8.0 or newer."
```

### 4. Publish the Python client to PyPI

```bash
./packaging/pypi/publish.sh
```

If your default `python3` is older than 3.11, run it with
`PYTHON=/path/to/python3.11 ./packaging/pypi/publish.sh`.

If Homebrew Python refuses package installs because the environment is externally
managed, create a temporary release venv and point the script at it:

```bash
python3.12 -m venv /tmp/journal-bastion-publish
/tmp/journal-bastion-publish/bin/python -m pip install --upgrade pip build twine
PYTHON=/tmp/journal-bastion-publish/bin/python ./packaging/pypi/publish.sh
```

### 5. Publish the Docker image

```bash
TAG="$VERSION" ./packaging/docker/publish.sh
docker tag "ghcr.io/endurancelabs/journal-bastion:$VERSION" ghcr.io/endurancelabs/journal-bastion:latest
docker push ghcr.io/endurancelabs/journal-bastion:latest
```

### 6. Update the Homebrew formula

```bash
VERSION="$VERSION" ./packaging/homebrew/publish.sh
```

Rewrites `packaging/homebrew/journal-bastion.rb` with the new tarball URL and its
sha256. Commit the updated formula if this repository is meant to track the
current formula.

Important: this script does **not** publish to Homebrew. It only updates the
local formula file. The default tap name in the script is
`EnduranceLabs/homebrew-tap`, but that repository was not visible to `gh` from
this environment on 2026-07-16. Do not keep retrying a tap push when that
happens; get the correct tap repository/path or create/grant access to the tap
first.

### 7. Verify published artifacts

```bash
npm view journal-bastion-protocol@"$VERSION" version
npm view journal-bastion@"$VERSION" version
npm view journal-bastion-client@"$VERSION" version
curl -fsSL "https://pypi.org/pypi/journal-bastion-client/$VERSION/json" | jq -r '.info.version'
docker buildx imagetools inspect "ghcr.io/endurancelabs/journal-bastion:$VERSION"
docker buildx imagetools inspect ghcr.io/endurancelabs/journal-bastion:latest
```
