---
name: release
description: Publish Journal Bastion release artifacts to npm, GHCR Docker, and Homebrew
disable-model-invocation: true
argument-hint: "[version]"
---

# Release Journal Bastion

Use `packaging/npm/README.md` as the canonical release runbook. This skill is a
guardrail for the parts that are easy to miss during an agent-led release.

## Before publishing

- There is one publishable package, so there is no lockstep to confirm. `packaging/bump-version.sh <version>` sets it.
- Publish only from merged `main`, not from an unmerged release branch.
- Tag the release commit as `v<version>` and push the tag before publishing.

```bash
git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

## Artifact order

1. Publish npm packages with `packaging/npm/publish.sh`.
3. Publish the Docker image with `TAG=<version> ./packaging/docker/publish.sh`.
4. Move `ghcr.io/endurancelabs/journal-bastion:latest` to the same image digest.
5. Update the Homebrew formula with `VERSION=<version> ./packaging/homebrew/publish.sh`.

## Auth and failure handling

- npm may require browser-based auth. If npm prints an auth URL, the user must
  open it in a browser; a non-interactive agent session can fail with `EOTP`.
- npm versions are immutable. If a publish script stops partway through, verify
  which packages are live before retrying anything.
  Python blocks package installs as externally managed, create a temporary venv

## Homebrew caveat

`packaging/homebrew/publish.sh` only rewrites the local formula file. It does not
push a tap. The script defaults to `EnduranceLabs/homebrew-tap`, but that repo
was not visible to `gh` from this environment on 2026-07-16. Do not keep trying
to push that tap when it fails; ask for the correct tap repository/path or for
access first.

Commit the local formula update only if this repository is meant to track the
current formula.
