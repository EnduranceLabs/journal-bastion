# Publishing

One publishable package: **`@journal/journal-bastion`**.

The CLI (`bin: journal-bastion`), the hub library and the wire schemas all ship
inside it as subpath exports:

| Import | What |
|---|---|
| `@journal/journal-bastion` | the CLI entry point |
| `@journal/journal-bastion/hub` | `BastionServer`, for the Journal side of the socket |
| `@journal/journal-bastion/protocol` | the shared Zod wire schemas |

There is nothing to keep in version lockstep, and the Python client in
`clients/python` is not published — install it from source if you need it.

## Release

```bash
packaging/bump-version.sh 0.9.0   # sets package.json + the python client
pnpm test && pnpm run typecheck
packaging/npm/publish.sh          # builds, then pnpm publish --access public
```

`@journal` is a scoped package, so `publishConfig.access` is `public` in
`package.json`. Without it npm would default a scoped package to private and the
publish would fail on a free account.

## Verify

```bash
VERSION=$(node -p "require('../../package.json').version")
curl -fsSL "https://registry.npmjs.org/@journal%2Fjournal-bastion/$VERSION" | jq -r '.version'
npm view @journal/journal-bastion dist-tags
```

A customer installs it with:

```bash
npm install -g @journal/journal-bastion
journal-bastion --version
```
