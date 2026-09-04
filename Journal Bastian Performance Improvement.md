# Journal Bastian Performance Improvement

Last updated: 2026-09-05

## Goal

Make the tagged container release faster while preserving the current safety checks:

- source validation and tests
- native Linux amd64 and arm64 images
- vulnerability scanning
- SBOM and provenance attestations
- anonymous image-pull and Docker contract checks
- immutable version tags

Do not remove a safety check just to improve the clock time.

## Current status

PR 1 code is implemented locally; the GitHub canary is pending. The code path is intentionally opt-in:
without `BASTION_TOOLS_IMAGE`, releases use the existing Dockerfile unchanged.

Repository: `EnduranceLabs/journal-bastion`

Workflow: [docker-release.yml](https://github.com/EnduranceLabs/journal-bastion/actions/workflows/docker-release.yml)

The local checkout is `main` at commit `bf7f2cd` with the implementation changes
and this plan file not yet committed or pushed.

## Problem in simple English

The release is a chain of jobs. The slowest job controls the total release time.

1. GitHub prepares a runner and validates the source.
2. Two image builds run in parallel, one for amd64 and one for arm64.
3. Each image build compiles three large Go programs inside the Dockerfile.
4. Docker pushes the image and a large `mode=max` BuildKit cache.
5. The workflow scans and verifies both images, creates the manifest, and makes the GitHub release.

The source tests are not the main problem. The current evidence points mainly to the pnpm setup step and the two Docker builds.

## Measured baseline

Evidence comes from GitHub Actions API data for successful runs.

| Run | Result | Total time | Important observations |
|---|---:|---:|---|
| [v0.5.2 / run 33863076699](https://github.com/EnduranceLabs/journal-bastion/actions/runs/33863076699) | success | 29m 07s | validate 7m58s; amd64 build 19m06s; arm64 build 13m50s |
| [v0.5.1 / run 33856307401](https://github.com/EnduranceLabs/journal-bastion/actions/runs/33856307401) | success | 29m 27s | validate 7m58s; amd64 build 20m25s; arm64 build 12m40s |

Detailed v0.5.2 timings:

- `Validate release`: 10:24:30–10:32:28 UTC.
- `pnpm/action-setup`: about 7m04s of that job.
- Install dependencies: about 4s.
- Build, typecheck, and tests after setup: about 40s.
- `Build and push native image`: amd64 about 18m; arm64 about 13m02s.
- Trivy scan: about 13–16s per architecture.
- Digest verification, manifest creation, release verification, and GitHub release: roughly 1–2 minutes on the critical path.

The two architecture jobs already use separate native GitHub runners (`ubuntu-24.04` and `ubuntu-24.04-arm`). Therefore, any Depot benefit here would mainly be faster build compute and persistent Docker cache, not removal of QEMU emulation.

## What the current files show

- `package.json` declares `pnpm@10.15.1`.
- Both GitHub workflows explicitly install pnpm `10.15.1`.
- The Dockerfile runs `corepack prepare pnpm@10.15.1 --activate`.
- `packaging/docker/Dockerfile` compiles `temporal`, `tcld`, and `toolbox` from pinned upstream commits.
- Each release architecture builds those Go stages again.
- Release image builds use `cache-from: type=gha` and `cache-to: type=gha,mode=max` with an architecture-specific scope.
- There is no Depot configuration in this repository today.
- The release uses `push-by-digest`, scans each native digest, then creates and attests the multi-platform manifest. That behavior must remain understood and tested if the build action changes.

Journal was also inspected for ideas. Its production image workflows use a repository-variable feature flag to choose Depot or Buildx and keep a Buildx path available. This is a useful rollout pattern, not proof that Bastion should copy its exact setup.

## Validation of Claude's proposal

### Phase 1: upgrade pnpm 10 to 11

Status: **deferred; removed from the active performance work**.

What is true:

- pnpm 11 exists and is supported by Node 22.
- The official pnpm project now recommends `pnpm/setup` for pnpm 11 and newer; `pnpm/action-setup` remains the action for pnpm 10 and older.
- The current seven-minute delay is real and occurs in the pnpm setup step.

What is not shown:

- The repository is not switching versions on each run. Its workflow, Dockerfile, and `package.json` agree on pnpm 10.15.1.
- There is no evidence yet that pnpm 11 itself will remove the seven-minute delay.
- There is no measured comparison of `pnpm/action-setup` versus `pnpm/setup` on this repository.

Decision: do not pursue the pnpm upgrade as part of this performance project. Reopen only as a separate maintenance task if there is a later security, compatibility, or tooling reason.

### Phase 2: move the Go builds into a separately versioned tools image

Status: **strong hypothesis; likely the largest structural improvement**.

Why it is plausible:

- The slow build step currently contains three heavyweight Go compilations.
- Both architecture builds repeat those compilations.
- A separately built, pinned tools image could let normal releases copy already-built binaries instead of compiling them.

What must be designed and verified:

- whether the tools image is one multi-platform image or separate architecture images
- how `COPY --from` obtains the correct architecture image
- how tool source commits, Go versions, dependency overrides, SBOMs, provenance, and CVE fixes are versioned
- whether the tools image lives in GHCR or Depot Registry
- how a normal release pins the exact tools image digest
- how a deliberate tool-version update is triggered and tested
- whether the existing image contract still sees the exact expected binary versions

Decision: keep this as the primary optimization, but do not claim “18 minutes saved” until a canary release measures it. The current 13–18 minute build times make the direction credible; the exact saving is unknown.

### Phase 3: use Depot for Docker builds

Status: **plausible; not yet proven for this workflow**.

Official Depot documentation confirms:

- `depot/build-push-action` is a drop-in style replacement for `docker/build-push-action`.
- Depot builders use persistent SSD Docker layer cache and support native multi-platform builds.
- GitHub Actions can authenticate with OIDC using `id-token: write` and a configured Depot trust relationship; a static token is not necessarily required.
- `buildx-fallback` exists, but its default is `false`. Setting it to `true` requires the Docker Buildx action and falls back to the GitHub runner if Depot cannot acquire a builder.
- External registries such as GHCR are supported when the workflow logs into that registry and pushes there.

Important limits on the proposal:

- Current amd64 and arm64 jobs are already native, so “no emulation” is not the main gain.
- Depot’s advertised speed is not a guarantee for this Dockerfile or this registry path.
- The current digest-by-architecture, scan, manifest, and attestation flow may need to stay split. Do not assume that one Depot multi-platform call has the same digest/output behavior.
- A fallback protects availability but may reintroduce the slow path. It is not a performance improvement by itself.

Decision: test Depot after or alongside the tools-image experiment, using OIDC if the organization trust setup permits it. Keep the fallback explicit and test it separately.

## Follow-up decision guidance: pnpm, prebuilt tools, and fallback

### Should Bastion move to pnpm 11?

Decision: **deferred and out of scope for this performance project**. Consider it only as a separate, controlled maintenance upgrade later.

Benefits are real but probably small for this repository:

- pnpm 11 uses a newer standalone/pure-ESM implementation and a SQLite-backed store index.
- pnpm 11 has stronger supply-chain defaults such as `minimumReleaseAge`, `strictDepBuilds`, and `blockExoticSubdeps`.
- pnpm's official GitHub Actions successor, `pnpm/setup`, is designed for pnpm 11+ and can install pnpm and Node together.

The current dependency install itself takes only a few seconds. The seven-minute observation is in the pnpm setup action, so pnpm 11 is not yet proven to fix it.

Risks to check before upgrading:

- Node 22 is compatible, so the runtime requirement is already satisfied.
- pnpm 11 changes security/build defaults. A dependency with an install/build script may need an explicit `allowBuilds` policy.
- pnpm 11 no longer reads non-auth settings from `.npmrc`; this repo currently has no `.npmrc`, and its `overrides` are already in `pnpm-workspace.yaml`, so those specific risks look low.
- pnpm 11 changes publishing behavior to a native implementation. `packaging/npm/publish.sh` calls `pnpm publish`, so npm publishing must be tested separately.
- The lockfile is version 9.0. It must be regenerated or verified with pnpm 11, then checked in only if the result is intentional and stable.

The current plan will keep pnpm 10.15.1 unchanged. If this is reopened later, benchmark the official pnpm 11 setup first and require all install, build, test, Docker, and npm-publish checks to pass.

### Risks of a prebuilt Go tools image

Recommendation: **still worth pursuing**, with the following controls.

- Pin the consumed tools image by digest, never by a movable tag.
- Keep the three binaries tied to their upstream commit, version, Go base image, and dependency overrides.
- Publish SBOM and provenance for the tools image and keep enough metadata to trace every binary back to source.
- Rebuild the tools image on Go, dependency, or upstream security fixes—not only when a Bastion release happens.
- Test both architectures. The `toolbox` binary is built with CGO enabled, so its libc/runtime compatibility with `node:22-slim` must be verified.
- Test registry availability and authentication from the actual build path, especially if the tools image is private GHCR or Depot Registry.
- Verify the binary versions and the existing Docker contract after copying from the external image.
- Keep a rollback digest for the previous tools image.

The main new risk is release process and supply-chain drift: a slow build becomes faster, but the release now depends on a separately maintained artifact. Pinning, provenance, scanning, and a rebuild policy address that risk.

### Depot selection and fallback

Use an opt-in repository variable named `DEPOT_PROJECT_ID` (or the final agreed name):

- If the variable is absent or empty, use the existing GitHub Buildx path.
- If the variable is present, use Depot and require a valid Depot project/authentication setup.
- Do not silently treat a malformed present value as “Depot disabled”; fail clearly so configuration mistakes are visible.

The variable alone is not enough. Depot's GitHub Actions path also needs either a configured OIDC trust relationship with `id-token: write` or a Depot token. OIDC is preferred because it avoids a long-lived secret.

Depot's `buildx-fallback` is **not enabled by default**. If used, set it explicitly and keep Docker Buildx setup available. Test what kinds of Depot failures trigger the fallback; a fallback can hide a Depot configuration problem or cause a slow second build.

The safer rollout is therefore two layers of fallback:

1. Variable absent: do not call Depot at all; use the known GitHub Buildx workflow.
2. Variable present but Depot temporarily cannot obtain a builder: optionally allow Depot's explicit Buildx fallback, after testing its failure behavior.

### Additional items to brainstorm before implementation

- Fix Dockerfile cache ordering: copy package manifests and lockfile before application source so source-only changes do not invalidate dependency installation. Measure this independently.
- Decide whether release image builds should keep GHA cache export, switch from `mode=max`, or remove it after the Go stages leave the release Dockerfile.
- Keep the per-architecture digest and scan flow initially. A single Depot multi-platform build may be faster, but it changes the current verification shape and should be a later experiment.
- Define a canary that cannot accidentally publish a real version tag or GitHub release.
- Record build duration, cache hit rate, cache export duration, Depot cost, and fallback frequency so “faster” is measured rather than assumed.
- Decide who owns the tools-image update and what happens when Trivy finds a vulnerability in an old tool binary.
- Keep a simple kill switch: removing the Depot project variable must restore the GitHub Buildx path without another code change.

## Suggested PR structure

Recommendation: use **two implementation PRs**, followed by an operational configuration change.

### PR 1 — Prebuild and pin the Go tools

- Add the tools-image build/publish path.
- Move the three Go compiles out of the normal release Dockerfile.
- Consume an exact tools-image digest.
- Preserve the existing GitHub Buildx release path.
- Add binary-version, architecture, contract, SBOM, provenance, and rollback checks.
- Measure the release after merge.

This is an independent architectural change. Keeping it separate lets us measure its benefit and roll it back without involving Depot authentication or runner behavior.

### PR 1 readiness and safety conclusion

No user secrets are required to start the implementation. The tools image can use GitHub Actions and GHCR permissions already used by the release workflow, unless we choose a different registry.

The change is not workflow-only: the Dockerfile will change from compiling the tools locally to copying them from an external, pinned image. Docker supports this pattern, and the final runtime image can remain functionally equivalent if the same binaries are copied. However, research alone cannot prove that production will not break. We need one successful canary before treating it as production-safe.

Before publishing the tools image, confirm:

- tools-image registry: default proposal is GHCR alongside the Bastion image
- visibility/authentication: public or private, and whether the actual build service can pull it
- tag/digest naming and rollback digest
- update policy for upstream commits, Go, dependencies, and security fixes
- whether the image is one multi-platform image or two architecture-specific images

PR 1 must fail closed if the tools image is missing, has the wrong digest, or has the wrong architecture. It must not silently compile a different binary or use a movable tag.

Required validation before enabling the new Dockerfile in a real release:

- build and inspect both amd64 and arm64 images
- run the existing Docker contract
- verify `temporal`, `tcld`, and `toolbox` versions
- verify `toolbox` libc/runtime compatibility
- scan the final image and the tools image
- verify SBOM/provenance and the source-to-binary record
- run one canary that cannot create a customer-facing version release

Conclusion: PR 1 is reasonable to implement, but “no production risk” should mean “the old GitHub Buildx path and a pinned rollback remain available, and the canary passed,” not “the design was reviewed once.”

### PR 2 — Add opt-in Depot support

- Add the `DEPOT_PROJECT_ID` conditional.
- Keep the current GitHub Buildx path when the variable is empty.
- Add Depot OIDC/project documentation and permissions.
- Keep the current per-architecture digest, scan, manifest, and attestation flow initially.
- Add explicit `buildx-fallback: true` only if the canary confirms its behavior.
- Add a safe canary/test path and timing reporting.

Because the variable remains unset initially, this PR can merge without changing production behavior. After the canary, enable the variable through GitHub configuration rather than another code change.

### Operational rollout — enable Depot

- Create the Depot project and OIDC trust relationship.
- Run cold and warm canaries.
- Test Depot failure and Buildx fallback.
- Set `DEPOT_PROJECT_ID` only after the results are acceptable.
- Remove the variable to return immediately to GitHub Buildx.

Do not combine both implementation PRs unless there is a strong release deadline. A single PR would be possible, but it would make performance attribution, review, and rollback less clear.

### Final estimate: “29 minutes to 3–4 minutes”

Status: **speculative**.

The direction is reasonable, but the exact target is not supported by current measurements. We will use measured cold and warm canary runs, report ranges, and keep the existing checks visible in the timing breakdown.

## Recommended work plan

Work one small, measurable item at a time. Update this file after every item.

### Phase 0 — Baseline and observability

- [x] Confirm the current Dockerfile and release workflow.
- [x] Measure successful v0.5.1 and v0.5.2 release runs.
- [x] Identify the largest current steps.
- [ ] Capture the untruncated BuildKit log for one release and separate build time from cache import/export time.
- [ ] Record cache hit/miss behavior for both architecture scopes.
- [ ] Decide how to run a canary without creating a misleading production release.

### Deferred — pnpm upgrade

- [x] Drop pnpm 11 from the active performance plan.
- [ ] Reopen only if a separate maintenance decision is made.

### Phase 1 — prebuilt tools image

- [x] Define the tools image contents and architecture layout.
- [x] Define the tool update policy: source commit, tool version, Go image, and dependency patches.
- [ ] Build and publish a test tools image with SBOM/provenance.
- [x] Add a main-image path that consumes an exact tools image digest.
- [ ] Verify binary versions and the Docker contract on amd64 and arm64.
- [x] Add a deliberate tool-update path and document rollback.
- [ ] Measure cold and warm release builds.

Implementation notes:

- `packaging/docker/tools.Dockerfile` contains the same pinned Go builds as the
  current release Dockerfile and publishes a scratch, multi-platform tools image.
- `packaging/docker/Dockerfile.prebuilt` copies those binaries from the exact
  digest supplied through `BASTION_TOOLS_IMAGE`.
- `.github/workflows/docker-tools.yml` is manual by design. It publishes an
  immutable version tag, records the manifest digest, scans the tools image, and
  builds the real Bastion image on both architectures before running the existing
  Docker contract.
- `docker-release.yml`, `docker-ci.yml`, and `packaging/docker/publish.sh` use
  the prebuilt path only when `BASTION_TOOLS_IMAGE` is set and valid. Otherwise
  they retain the current in-image compilation path.
- The tools image has not been published yet, so the faster path is not active.
- Local Docker validation is currently blocked because the Docker daemon socket
  was initially unavailable, but Colima BuildKit checks now pass. A real local
  amd64 build reached the unchanged tcld command and hit a Go 1.26.6 runtime
  segmentation fault during module downloads. This is a local Colima/toolchain
  environment failure; the current GitHub release has already built this exact
  command successfully. The GitHub tools workflow remains the authoritative
  architecture and runtime verification.
- The prebuilt Bastion Dockerfile was also assembled successfully in Colima
  using the existing v0.5.2 image as a path-compatible stand-in for the future
  tools image. All external binary copies completed and the tool version probes
  passed. The full local contract later failed at its existing MongoDB policy
  assertion (`connect` not disabled), so the new tools image still requires the
  GitHub amd64/arm64 contract run before activation.

### Phase 2 — Depot canary

- [ ] Create/connect the Depot project.
- [ ] Configure GitHub OIDC trust for this repository/workflow, if approved.
- [ ] Add the project ID as a repository variable or equivalent non-secret configuration.
- [ ] Keep GHCR login and package permissions for the push path.
- [ ] Replace only the canary build action first.
- [ ] Test the current per-architecture digest output, Trivy scan, manifest creation, and attestations.
- [ ] Test `buildx-fallback: true` deliberately and document the expected slow fallback.
- [ ] Compare Depot cold/warm results with the GitHub Buildx baseline.
- [ ] Decide whether to keep GHA cache export, change its mode, or remove it after measuring.

### Phase 3 — production rollout

- [ ] Apply only the measured changes to the release workflow.
- [ ] Keep Docker CI behavior covered; do not optimize release by silently weakening PR checks.
- [ ] Run one real release with a rollback path ready.
- [ ] Update this file with before/after timings, cost, reliability, and remaining bottlenecks.
- [ ] Update the release runbook with the new tool-image and Depot setup requirements.

## Files likely to change later

- `.github/workflows/docker-release.yml`
- `.github/workflows/docker-ci.yml`
- `packaging/docker/Dockerfile`
- `package.json`
- `pnpm-lock.yaml`
- possibly a new tools-image Dockerfile/workflow and the release documentation

Files changed for PR 1 are the two Dockerfiles, the tools workflow, the two
existing workflow selectors, the local publish helper, the release runbook,
and this continuity plan. pnpm and Depot are unchanged.

## Open questions

- Why did `pnpm/action-setup` take about seven minutes in both recent release runs?
- Does the current `mode=max` GHA cache export contain the large Go intermediate stages, and how much time does exporting them cost?
- Should prebuilt binaries be stored in GHCR, Depot Registry, or another artifact store?
- Must the tools image be rebuilt for every Go/dependency security update, even when the Bastion source does not change?
- Can Depot preserve the current per-architecture digest and attestation workflow exactly enough for release safety?
- What Depot plan/cost and concurrency are acceptable?
- Is a temporary canary workflow preferable to a throwaway version tag, since the current release trigger creates real GHCR tags and a GitHub release?

## Sources consulted

- [Current Journal Bastion release workflow](https://github.com/EnduranceLabs/journal-bastion/blob/main/.github/workflows/docker-release.yml)
- [Depot GitHub Actions integration](https://depot.dev/docs/container-builds/integrations/github-actions)
- [Depot build-push-action inputs and fallback behavior](https://github.com/depot/build-push-action#inputs)
- [Depot GitHub Actions overview and persistent cache](https://depot.dev/integrations/github-actions)
- [pnpm continuous integration guidance](https://pnpm.io/continuous-integration)
- [pnpm installation and version compatibility](https://pnpm.io/installation)
- [pnpm/action-setup migration guidance](https://github.com/pnpm/action-setup)
- [Docker cache modes and export behavior](https://docs.docker.com/build/cache/backends/)
- [Docker GitHub Actions cache backend](https://docs.docker.com/build/cache/backends/gha/)

## How to continue in a new session

Start with: “Read `Journal Bastian Performance Improvement.md`, inspect the current git status, and continue from the first unchecked item. Do not implement anything unless I ask for implementation.”
