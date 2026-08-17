# Publishing

One publishable package: **`@journal-labs/bastion`**.

The CLI (`bin: journal-bastion`), the hub library and the wire schemas all ship
inside it as subpath exports:

| Import | What |
|---|---|
| `@journal-labs/bastion` | the CLI entry point |
| `@journal-labs/bastion/hub` | `BastionServer`, for the Journal side of the socket |
| `@journal-labs/bastion/protocol` | the shared Zod wire schemas |

There is nothing to keep in version lockstep, and the Python client in
`clients/python` is not published — install it from source if you need it.

## npm release

```bash
packaging/bump-version.sh 0.1.0   # sets package.json + the python client
pnpm test && pnpm run typecheck
packaging/npm/publish.sh          # builds, then pnpm publish --access public
```

`@journal` is a scoped package, so `publishConfig.access` is `public` in
`package.json`. Without it npm would default a scoped package to private and the
publish would fail on a free account.

## Verify

```bash
VERSION=$(node -p "require('../../package.json').version")
curl -fsSL "https://registry.npmjs.org/@journal-labs%2Fbastion/$VERSION" | jq -r '.version'
npm view @journal-labs/bastion dist-tags
```

A customer installs it with:

```bash
npm install -g @journal-labs/bastion
journal-bastion --version
```

## Container release

Container images are published only by GitHub Actions. Direct registry pushes
from developer machines are intentionally unsupported.

Before tagging, bump the source version and merge the change to `main`:

```bash
packaging/bump-version.sh 0.2.0
```

Create the matching tag from the merged `main` commit:

```bash
git tag -a v0.2.0 -m "Journal Bastion 0.2.0"
git push origin v0.2.0
```

The release workflow validates the source version, tests and scans native
Linux amd64 and arm64 images, publishes a multi-platform manifest to GHCR, and
creates the GitHub release. It publishes immutable `0.2.0` and commit tags plus
the movable `0.2` and `latest` tags. Never reuse an existing version tag.

For local Docker builds and contract validation, run:

```bash
packaging/docker/publish.sh
```

The GHCR package is public. The workflow verifies anonymous pulls of each native
digest before creating release tags, then verifies the final multi-platform tag
before creating the GitHub release.
