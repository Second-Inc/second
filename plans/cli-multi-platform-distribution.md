# Add Multi-Platform CLI Distribution


This plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Change Notes` current as the work evolves. This file must remain consistent with `PLANS.md`.


## Overall Goal


Make `npx --yes @second-inc/cli` work on more machines while keeping one user-facing command and a release process that does not require Omer to manually publish from each physical computer.

The first production target should be:

- macOS arm64, already available today.
- macOS x64, for Intel Macs.
- Linux x64, for normal Intel/AMD Linux and Windows users running WSL2.
- Linux arm64, for ARM Linux machines.

Native Windows support should be a later milestone. Windows through WSL2 should come first because WSL2 runs Linux from Node/npm's point of view and can reuse the Linux x64 package.


## Goal Description / Sub-goals


The work is complete when:

1. `@second-inc/cli` still stays tiny and remains the only command users need to run.
2. The launcher maps each supported runtime ID to a matching platform payload package.
3. Every supported payload package contains the packaged web server, worker, MongoDB, Redis, and required runtime libraries for that platform.
4. GitHub Actions builds payloads on the matching operating system and architecture, publishes every payload first, and publishes the tiny launcher last.
5. The human release flow is simple: create a tag such as `v0.1.23`, watch CI, and test `npx --yes @second-inc/cli`.
6. Docs and unsupported-platform messages accurately explain what works now and what is coming next.
7. Windows users have a clear supported path through WSL2 before native Windows exists.


## Motivation


Right now the local CLI is usable only on Apple Silicon Macs. That is enough for Omer's current machine, but not enough for a product that users can try on their own machines.

The product promise is one local command. Users should not need Docker, Homebrew, a manually installed database, or a platform-specific install guide. Supporting more platforms preserves that promise while removing an obvious adoption blocker.

The release process should not depend on Omer cloning the repo on a Windows laptop, Intel Mac, Linux box, or any other physical machine. Local computers are useful for smoke testing, but GitHub Actions should be the release source of truth.


## State Before


The current repository state is:

- `packages/cli/bin/second.js` detects these runtime IDs:
  - `darwin-arm64`
  - `darwin-x64`
  - `linux-arm64`
  - `linux-x64`
  - `win32-x64`
- `packages/cli/bin/second.js` only maps `darwin-arm64` to a real package: `@second-inc/cli-local-darwin-arm64`.
- Unsupported platforms get a launcher screen saying the only supported runtime is `darwin-arm64`.
- `packages/cli-local-darwin-arm64/package.json` is restricted to:
  - `os: ["darwin"]`
  - `cpu: ["arm64"]`
- `.github/workflows/release-cli.yml` has one job named `publish-darwin-arm64`.
- `scripts/publish-cli-darwin-arm64.mjs` publishes exactly two packages:
  - `@second-inc/cli-local-darwin-arm64`
  - `@second-inc/cli`
- `scripts/bump-cli-version.mjs` bumps only:
  - `packages/cli/package.json`
  - `packages/cli/package-lock.json`
  - `packages/cli-local-darwin-arm64/package.json`
- Runtime package stubs already exist for:
  - `packages/runtime-darwin-arm64`
  - `packages/runtime-darwin-x64`
  - `packages/runtime-linux-arm64`
  - `packages/runtime-linux-x64`
- `packages/cli/scripts/prepare-runtime.mjs` supports `darwin-arm64`, `darwin-x64`, `linux-arm64`, and `linux-x64`.
- `packages/cli/scripts/prepare-runtime.mjs` explicitly rejects `win32-*` with this current behavior: Windows is not supported until a Redis-compatible Windows runtime is added.
- `packages/cli-local-darwin-arm64/bin/second-local.js` can load packaged runtime binaries from either:
  - an optional package like `@second-inc/runtime-linux-x64`, or
  - a bundled path like `dist/runtime/linux-x64/manifest.json`.
- `packages/cli/scripts/bundle-worker.mjs` currently bundles runtime files by default into `dist/runtime/<current-runtime-id>`.

So the direct answer to the user's question is: yes, the current CLI distribution supports only Apple Silicon macOS. It is not because of a fundamental product limitation; it is because the currently published launcher maps only Apple Silicon macOS to a real payload package and the release workflow only builds/publishes that payload.


## State After


After implementation, the user-facing command stays:

    npx --yes @second-inc/cli

On each supported machine, the tiny launcher should detect the platform and install the matching payload package:

| Host | Node runtime ID | Payload package |
| --- | --- | --- |
| Apple Silicon Mac | `darwin-arm64` | `@second-inc/cli-local-darwin-arm64` |
| Intel Mac | `darwin-x64` | `@second-inc/cli-local-darwin-x64` |
| Linux x64 / WSL2 x64 | `linux-x64` | `@second-inc/cli-local-linux-x64` |
| Linux arm64 | `linux-arm64` | `@second-inc/cli-local-linux-arm64` |

Native Windows should still show a clear unsupported message until a real native Windows Redis/runtime strategy exists. Windows users should be directed to WSL2 as the supported path for now.

Release should be tag-driven:

    git tag v0.1.23
    git push origin v0.1.23

The GitHub Actions workflow should:

1. derive `0.1.23` from the tag,
2. set the package versions inside CI,
3. build each payload on its matching runner,
4. pack-check each payload,
5. publish every payload,
6. publish `@second-inc/cli` only after all payloads for that version are available.


## Context and Orientation


The CLI distribution has two layers:

1. `@second-inc/cli` is the tiny public launcher. It is the package users run through `npx`.
2. `@second-inc/cli-local-<runtime-id>` is the large payload package. It contains the standalone local app: Next.js web server, worker bundle, MongoDB, Redis, and required runtime libraries.

The launcher exists so the command stays stable while payloads can be platform-specific. The user should not need to know whether they need a macOS, Linux, Intel, or ARM package. The launcher detects that.

The runtime ID is derived from Node:

- `process.platform`
- `process.arch`

Examples:

- Apple Silicon macOS: `darwin-arm64`
- Intel macOS: `darwin-x64`
- Ubuntu on Intel/AMD: `linux-x64`
- Ubuntu on ARM: `linux-arm64`
- native Windows x64: `win32-x64`

There are two separate packaging questions:

1. Can we obtain MongoDB/Redis binaries for that target platform?
2. Can the packaged web/worker payload run correctly on that target platform?

The safe answer is to build each platform payload on its target OS/architecture. Even if a script can download Linux MongoDB/Redis binaries from a Mac, the Next.js standalone payload may contain platform-specific native optional dependencies. For release quality, Linux payloads should be built on Linux runners, macOS Intel payloads on Intel macOS runners, and macOS ARM payloads on ARM macOS runners.

Current GitHub-hosted runner availability is good enough for this plan. GitHub's hosted runner reference lists `macos-15`, `macos-15-intel`, `ubuntu-24.04`, and `ubuntu-24.04-arm` style labels for the platforms needed here. GitHub's changelog also says Linux and Windows arm64 standard hosted runners are generally available for public repositories, with private-repo caveats. Source references are recorded in `Artifacts and Notes`.


## Relevant Files and Code Areas


- `packages/cli/bin/second.js`
  - Tiny launcher.
  - Detects current runtime ID.
  - Currently maps only `darwin-arm64` to `@second-inc/cli-local-darwin-arm64`.
  - Must be updated to map macOS Intel and Linux payloads.

- `packages/cli-local-darwin-arm64/package.json`
  - Current platform payload package.
  - Currently hardcoded to macOS ARM.
  - Should either become a reusable payload package source or be copied/generated into platform-specific payload package roots.

- `packages/cli-local-darwin-arm64/bin/second-local.js`
  - Local supervisor that starts MongoDB, Redis, web, worker, stop/reset/update behavior, and runtime manifest lookup.
  - It already detects multiple runtime IDs and can look for `@second-inc/runtime-<runtime-id>` or bundled `dist/runtime/<runtime-id>`.
  - This file should remain one source of truth, not forked by platform if avoidable.

- `packages/cli/scripts/bundle-worker.mjs`
  - Builds the worker, Next standalone web server, static assets, and bundled runtime binaries.
  - Uses current host runtime by default through `prepare-runtime.mjs`.
  - Must support explicit target runtime when building platform payloads in CI.

- `packages/cli/scripts/prepare-runtime.mjs`
  - Prepares MongoDB and Redis for a target runtime.
  - Supports `darwin-*` and `linux-*`.
  - Explicitly rejects Windows.
  - Linux Redis linkage must be verified before declaring Linux support production-ready.

- `packages/runtime-darwin-arm64/package.json`
- `packages/runtime-darwin-x64/package.json`
- `packages/runtime-linux-arm64/package.json`
- `packages/runtime-linux-x64/package.json`
  - Existing runtime package stubs.
  - These can be used later if we split the app payload from runtime binaries, but the first simple release should not depend on that split unless a feasibility spike proves it reduces complexity.

- `scripts/bump-cli-version.mjs`
  - Current version bump script.
  - Must include all platform payload package roots if separate package roots are used.

- `scripts/publish-cli-darwin-arm64.mjs`
  - Current local publish script.
  - Should be replaced or complemented with a multi-platform-aware script.
  - Local publish should stay optional. CI should be canonical.

- `.github/workflows/release-cli.yml`
  - Current tag release workflow.
  - Must become a matrix workflow or a multi-job workflow with payload jobs per platform and one final launcher publish job.

- `docs/quickstart.mdx`, `README.md`, `docs/development.mdx`, `docs/local-release-operator-readme.md`
  - Must be updated after platform support changes.
  - Until native Windows exists, docs should clearly say Windows support is through WSL2.

- `scripts/clear-local-cli-state.mjs`
  - Clean-machine test helper.
  - Currently has hardcoded references to `cli-local-darwin-arm64`.
  - Must be generalized if it is expected to clean generated payload artifacts for all platform packages.


## Assumptions and Constraints


- Do not change the user command. It stays `npx --yes @second-inc/cli`.
- Do not require users to install Docker, Homebrew, MongoDB, Redis, OpenSSL, or GHCR images for the packaged CLI.
- Do not rely on Omer's personal machines for official releases.
- Local machines are for smoke testing, not source-of-truth publishing.
- Build each payload on the matching OS/architecture to avoid platform-specific native dependency mistakes.
- Native Windows is out of scope for the first milestone because `prepare-runtime.mjs` explicitly rejects `win32` and Redis support is unresolved.
- Windows through WSL2 is in scope for the first milestone because WSL2 appears as Linux to Node/npm and can use `linux-x64`.
- Use npm trusted publishing for CI once every package is configured. For first-time new package creation, a one-time manual npm setup or short-lived publish token may be required.
- The launcher package must be published last for each version. Publishing launcher first can create a window where users install a launcher that points to payload packages that are not available yet.
- The implementation should keep platform package versions exactly equal to the launcher version.


## Progress


- [x] 2026-05-17 11:55 Asia/Jerusalem: Read `PLANS.md` and current CLI packaging files.
- [x] 2026-05-17 12:05 Asia/Jerusalem: Confirmed current launcher supports only `darwin-arm64` at the package resolution layer.
- [x] 2026-05-17 12:10 Asia/Jerusalem: Confirmed existing runtime prep support for macOS and Linux, and explicit native Windows rejection.
- [x] 2026-05-17 12:20 Asia/Jerusalem: Wrote this implementation plan.
- [ ] Implement the plan in a future session.
- [ ] Validate Linux x64 runtime on a clean Ubuntu/WSL2 machine.
- [ ] Validate Linux arm64 runtime on a real `ubuntu-24.04-arm` runner or ARM Linux machine.
- [ ] Validate macOS Intel runtime on an Intel runner or real Intel Mac.
- [ ] Validate the final tag release workflow.


## Surprises & Discoveries


- The repository already contains `packages/runtime-*` package stubs for macOS and Linux. That suggests an earlier direction toward separate runtime packages, but the current published path still bundles runtime files into `@second-inc/cli-local-darwin-arm64`.
- `packages/cli-local-darwin-arm64/bin/second-local.js` already knows how to load runtime binaries from an optional `@second-inc/runtime-<runtime-id>` package. This is useful later, but it is not wired into the current published launcher flow.
- `packages/cli/scripts/prepare-runtime.mjs` can target Linux runtime IDs, but Linux must still be tested on Linux. A runtime binary can be downloaded cross-platform, but the full Next standalone payload should not be assumed portable across OS/architecture.
- Native Windows is not just missing a package mapping. It is intentionally blocked by `prepare-runtime.mjs` because there is no Redis-compatible native Windows runtime strategy yet.


## Decision Log


- 2026-05-17, Codex: Treat macOS x64 and Linux x64/arm64 as the first multi-platform milestone. Rationale: these are closest to current architecture and mostly supported by existing runtime prep code.
- 2026-05-17, Codex: Treat Windows support as WSL2 first, native Windows later. Rationale: WSL2 can reuse `linux-x64`; native Windows is explicitly unsupported in code and needs a Redis/runtime strategy.
- 2026-05-17, Codex: Official releases should run through GitHub Actions, not Omer's physical machines. Rationale: platform release artifacts must be reproducible, auditable, and not tied to one laptop.
- 2026-05-17, Codex: Build payloads on matching OS/architecture runners. Rationale: Next standalone and native optional dependencies can be platform-specific even if MongoDB/Redis binaries can be downloaded for another platform.
- 2026-05-17, Codex: Publish payload packages before publishing the launcher. Rationale: avoids a version window where `@second-inc/cli@X` points to missing `@second-inc/cli-local-*@X` packages.


## Plan of Work


The simplest robust implementation is a staged rollout.

First, prove Linux runtime packaging actually runs outside the current Mac path. This means building and smoke-testing `linux-x64` and `linux-arm64` on Linux. The biggest unknown is Redis linkage from the Homebrew bottle. On macOS, `prepare-runtime.mjs` explicitly bundles OpenSSL dylibs and rewrites Redis references. On Linux, it currently copies only `redis-server`. If `redis-server` has unresolved shared-library paths on a clean Ubuntu/WSL2 host, Linux support must first bundle the required Linux shared libraries or switch to a different Redis/Valkey build strategy.

Second, generalize the payload build and package naming. There are two reasonable implementation shapes:

1. **Recommended simple shape:** keep one source payload package directory, but make CI set the package name, description, `os`, and `cpu` per matrix target before pack/publish.
2. **Alternative shape:** create separate package directories like `packages/cli-local-linux-x64`, `packages/cli-local-linux-arm64`, and `packages/cli-local-darwin-x64`.

The recommended shape avoids duplicating `second-local.js`, which is a large supervisor file. It also keeps the release workflow simpler once the package metadata override is scripted. The implementation can rename `packages/cli-local-darwin-arm64` to `packages/cli-local` or leave the existing directory as the source root and treat its package metadata as mutable during CI. A clean rename is nicer, but not required.

Third, update the launcher mapping in `packages/cli/bin/second.js`. `resolvePayloadPackage()` should return a package for every supported runtime ID and return `null` only for unsupported hosts. The unsupported message should list supported runtime IDs and say native Windows is coming later, with WSL2 recommended for now.

Fourth, update release automation. The workflow should have payload jobs for each runtime. Each payload job should build and pack-check the payload on a matching runner. The launcher publish job should depend on all payload publish jobs, run once, and publish `@second-inc/cli` last.

Fifth, update docs and local test instructions. The Quickstart and README platform table should move Linux and Intel Mac from "coming soon" to "available" only after the payloads are verified and published. Windows should say "Use WSL2 for now; native Windows is coming later."


## Phased Implementation Plan


### Phase 0: Feasibility Spike for Linux and macOS Intel


Purpose:

Prove that packaged MongoDB and Redis can run on each target before changing the public launcher.

Files and code areas touched:

- No source changes required for the spike unless a bug is discovered.
- Read/run `packages/cli/scripts/prepare-runtime.mjs`.
- Use GitHub Actions temporary/manual jobs or local target machines.

Implementation scope:

- On Linux x64, run `prepare-runtime.mjs --runtime-id linux-x64`.
- On Linux arm64, run `prepare-runtime.mjs --runtime-id linux-arm64`.
- On macOS Intel, run `prepare-runtime.mjs --runtime-id darwin-x64`.
- Inspect `file`, `ldd` or platform equivalent, and run `mongod --version` plus `redis-server --version`.
- If Redis fails due to missing dynamic libraries on Linux, solve that before continuing.

Why this phase is ordered here:

There is no value wiring release automation for Linux if the Redis binary cannot run on a clean Linux/WSL2 machine.

Human verification:

On each target, the runtime prep command should finish and both binaries should print versions without installing MongoDB, Redis, Homebrew, or Docker.

Observable success:

- `manifest.json` exists.
- `bin/mongod --version` exits 0.
- `bin/redis-server --version` exits 0.
- On Linux, `ldd bin/redis-server` shows no `not found` libraries.

Rollback / retry notes:

The spike writes only to a chosen output directory. Delete that directory and retry.


### Phase 1: Generalize Payload Package Metadata


Purpose:

Prepare the repo to publish the same payload source for multiple platform package names without duplicating supervisor code.

Files and code areas touched:

- `packages/cli-local-darwin-arm64/package.json`
- `packages/cli-local-darwin-arm64/bin/second-local.js`
- Possibly rename `packages/cli-local-darwin-arm64` to `packages/cli-local`
- Add or update a packaging helper script under `scripts/` or `packages/cli/scripts/`
- `scripts/bump-cli-version.mjs`
- `scripts/clear-local-cli-state.mjs`

Implementation scope:

- Choose one source package root for the local payload.
- Add a small helper that can set package metadata for a target runtime:
  - package name: `@second-inc/cli-local-<runtime-id>`
  - description: `Second local app payload for <human platform>`
  - `os`
  - `cpu`
  - version
- Ensure the build script can pass an explicit runtime ID into `bundle-worker.mjs`, and `bundle-worker.mjs` passes that ID into `prepare-runtime.mjs`.
- Update bump/version logic so launcher and every payload version remain identical.

Why this phase is ordered here:

The launcher cannot safely point to packages until those packages can be built and packed deterministically.

Human verification:

Run a dry pack for each target. The tarball should contain `bin/second-local.js`, `dist/web`, `dist/worker.mjs`, and the target runtime manifest/binaries.

Observable success:

The package metadata inside each dry-run package shows the expected name, version, `os`, and `cpu`.

Rollback / retry notes:

If the metadata helper mutates `package.json`, it must either restore it afterward or operate in a generated staging directory. A generated staging directory is safer and more repeatable.


### Phase 2: Add Launcher Platform Mapping


Purpose:

Make the public launcher select the correct payload package for every supported runtime ID.

Files and code areas touched:

- `packages/cli/bin/second.js`

Implementation scope:

- Update `resolvePayloadPackage()` to return mappings for:
  - `darwin-arm64`
  - `darwin-x64`
  - `linux-x64`
  - `linux-arm64`
- Keep `win32-x64` unsupported for native Windows.
- Update the unsupported-platform screen to list supported runtimes and say that Windows users should use WSL2 until native Windows support exists.
- Keep `SECOND_CLI_PAYLOAD_PACKAGE` override working for development/testing.

Why this phase is ordered here:

The launcher mapping should happen only after payload packages have a defined package shape.

Human verification:

On each target platform, run the launcher with a local or npm-published test package and confirm it selects the expected payload package.

Observable success:

The launcher banner shows the correct `runtime` and `payload` values.

Rollback / retry notes:

If a platform package is broken, remove only that mapping before publishing a launcher version that includes it. Do not publish launcher support for a platform whose payload is not ready.


### Phase 3: Replace Single-Platform Publish Scripts with Multi-Platform Release Automation


Purpose:

Make one release tag publish all supported payloads and then the launcher.

Files and code areas touched:

- `.github/workflows/release-cli.yml`
- `scripts/publish-cli-darwin-arm64.mjs`
- potentially a new `scripts/publish-cli-platforms.mjs`
- `package.json`

Implementation scope:

- Replace the single `publish-darwin-arm64` workflow with a payload matrix.
- Suggested payload matrix:
  - `darwin-arm64` on `macos-15`
  - `darwin-x64` on `macos-15-intel`
  - `linux-x64` on `ubuntu-24.04`
  - `linux-arm64` on `ubuntu-24.04-arm`
- Each payload job:
  - checks out the repo,
  - sets up Node,
  - derives version from tag,
  - installs dependencies,
  - builds target payload,
  - runs typecheck/build validation,
  - `npm pack --dry-run --ignore-scripts`,
  - publishes the platform payload.
- The launcher job:
  - depends on all payload jobs,
  - sets `packages/cli` version,
  - pack-checks launcher,
  - publishes `@second-inc/cli`.
- Preserve `permissions: id-token: write` for npm trusted publishing.
- Use the same GitHub environment name, `npm-publish`, if npm trusted publishing is configured that way.

Why this phase is ordered here:

CI should be the canonical release path. Local release commands can exist, but they should not be the only way to release Linux/Intel payloads.

Human verification:

Push a test tag to a private or staging package version and inspect Actions. Payload jobs must finish before launcher publish.

Observable success:

- npm shows all platform payload packages at the exact same version.
- npm shows `@second-inc/cli` at that version only after payload publish succeeds.

Rollback / retry notes:

If a payload job fails, the launcher job should not run. Re-run the workflow after fixing the payload. If one payload was already published, npm will reject publishing the same version again; the workflow should detect already-published packages or the release should move to a new patch version.


### Phase 4: First-Time npm Package Setup


Purpose:

Prepare npm permissions/trusted publishing for every new platform package.

Files and code areas touched:

- No repository source changes unless setup docs are updated.
- npm package settings.
- GitHub repository/environment settings.

Implementation scope:

Create or publish these npm packages:

- `@second-inc/cli-local-darwin-x64`
- `@second-inc/cli-local-linux-x64`
- `@second-inc/cli-local-linux-arm64`

Configure npm trusted publishing for each package:

- repo: `Second-Inc/second`
- workflow: `release-cli.yml`
- environment: `npm-publish`

Also confirm existing trusted publishing for:

- `@second-inc/cli`
- `@second-inc/cli-local-darwin-arm64`

Why this phase is ordered here:

npm package names and trusted publishing must exist before the tag workflow can publish them without local authentication.

Human verification:

In npm package settings, each package should show the same GitHub trusted publisher configuration.

Observable success:

The release workflow publishes without `npm login` on Omer's computer and without a long-lived npm token.

Rollback / retry notes:

If trusted publishing is not ready for a new package, use a short-lived granular npm publish token only as a temporary bridge, store it as a GitHub secret, publish once, then migrate that package to trusted publishing.


### Phase 5: Cross-Machine Smoke Tests


Purpose:

Prove that the actual user command works from scratch on every supported platform.

Files and code areas touched:

- No source changes unless bugs are found.
- Use `scripts/clear-local-cli-state.mjs` where a source checkout exists.
- Use manual cleanup commands on machines without a source checkout.

Implementation scope:

Run clean-machine tests on:

- Apple Silicon Mac.
- Intel Mac, if available.
- Ubuntu Linux x64 or Windows WSL2 Ubuntu.
- Linux arm64, either a real machine or `ubuntu-24.04-arm` runner.

For Windows:

- Test WSL2 first.
- Do not claim native Windows support unless `process.platform === "win32"` has a working native payload.

Why this phase is ordered here:

Pack checks prove the tarballs are structurally valid. Fresh `npx` tests prove the user experience works.

Human verification:

Run:

    time npx --yes @second-inc/cli

Then confirm:

- launcher prints quickly after npm finishes installing,
- runtime selection matches the machine,
- MongoDB starts,
- Redis starts,
- web server becomes ready,
- app opens,
- onboarding/provider detection works,
- `npx --yes @second-inc/cli stop` stops services,
- `npx --yes @second-inc/cli reset` deletes local state.

Observable success:

The first startup reaches a usable local Second app without Docker, Homebrew, or manually installed MongoDB/Redis.

Rollback / retry notes:

If a platform fails after publishing, do not unpublish npm packages unless absolutely necessary. Publish a patch version with the fix. If needed, update the launcher in a patch release to temporarily remove the broken platform mapping.


### Phase 6: Docs and UX Cleanup


Purpose:

Make public docs match the real platform support.

Files and code areas touched:

- `README.md`
- `docs/quickstart.mdx`
- `docs/development.mdx`
- `docs/local-release-operator-readme.md`
- `packages/cli/bin/second.js`

Implementation scope:

- Update platform support tables.
- Explain Windows WSL2 as the supported Windows path for now.
- Keep native Windows listed as coming later.
- Update release docs from single-platform commands to tag-based CI.
- Update local test docs for all supported platforms.

Why this phase is ordered here:

Docs should not advertise support until payloads are published and smoke-tested.

Human verification:

Read Quickstart and README from the perspective of a user on Intel Mac, Linux, and Windows. Each should know whether the command works for them and what to do next.

Observable success:

No docs still imply Apple Silicon is the only supported platform after multi-platform release is complete.

Rollback / retry notes:

If a platform is delayed, keep it as "coming soon" until the release is verified.


### Phase 7: Native Windows Follow-Up


Purpose:

Support `npx --yes @second-inc/cli` in native Windows PowerShell/CMD, not only WSL2.

Files and code areas touched:

- `packages/cli/scripts/prepare-runtime.mjs`
- `packages/cli/bin/second.js`
- local supervisor process/port/path handling in `second-local.js`
- a future `@second-inc/cli-local-win32-x64` package
- release workflow Windows job

Implementation scope:

- Choose a Redis-compatible Windows runtime strategy.
- Verify MongoDB Windows binary packaging.
- Verify process management, signals, cleanup, local paths, npm bin resolution, and browser opening under native Windows.
- Add `win32-x64` launcher mapping only after full smoke testing.

Why this phase is separate:

The current code explicitly rejects Windows. Treating Windows as "just another package" would be inaccurate.

Human verification:

On the Windows machine, run from PowerShell:

    npx --yes @second-inc/cli

This should work without WSL2 only after this phase is implemented.

Observable success:

Native Windows reaches the same ready state as macOS/Linux and stop/reset work reliably.

Rollback / retry notes:

Until this phase is done, keep native Windows unsupported and direct users to WSL2.


## Concrete Steps and Commands


These commands are for the future implementation and validation session. Do not run release commands until implementation is complete.

Feasibility on Linux x64:

    cd /Users/omervexler/.codex/worktrees/971a/second
    node packages/cli/scripts/prepare-runtime.mjs --runtime-id linux-x64 --package-root --out /tmp/second-runtime-linux-x64
    /tmp/second-runtime-linux-x64/bin/mongod --version
    /tmp/second-runtime-linux-x64/bin/redis-server --version
    ldd /tmp/second-runtime-linux-x64/bin/redis-server

Feasibility on Linux arm64:

    cd /Users/omervexler/.codex/worktrees/971a/second
    node packages/cli/scripts/prepare-runtime.mjs --runtime-id linux-arm64 --package-root --out /tmp/second-runtime-linux-arm64
    /tmp/second-runtime-linux-arm64/bin/mongod --version
    /tmp/second-runtime-linux-arm64/bin/redis-server --version
    ldd /tmp/second-runtime-linux-arm64/bin/redis-server

Feasibility on macOS Intel:

    cd /Users/omervexler/.codex/worktrees/971a/second
    node packages/cli/scripts/prepare-runtime.mjs --runtime-id darwin-x64 --package-root --out /tmp/second-runtime-darwin-x64
    /tmp/second-runtime-darwin-x64/bin/mongod --version
    /tmp/second-runtime-darwin-x64/bin/redis-server --version
    otool -L /tmp/second-runtime-darwin-x64/bin/redis-server

Expected future dry-run publish command:

    cd /Users/omervexler/.codex/worktrees/971a/second
    npm run publish:cli:all -- patch --dry-run

Expected future tag release:

    cd /Users/omervexler/.codex/worktrees/971a/second
    git tag v0.1.23
    git push origin v0.1.23

Clean-machine test on macOS/Linux/WSL2 after publishing:

    npx --yes @second-inc/cli reset || true
    rm -rf ~/.npm/_npx
    npm cache clean --force
    time npx --yes @second-inc/cli

On a machine with no source checkout, do not use repo scripts. Use the published CLI commands and npm cache cleanup only.


## Validation and Acceptance


Automated validation:

- `npm --prefix packages/cli run build`
- web typecheck
- worker typecheck
- payload build for every runtime target
- `npm pack --dry-run --ignore-scripts` for every payload
- `npm pack --dry-run --ignore-scripts` for launcher
- runtime binary version checks for MongoDB and Redis
- Linux `ldd` check for no missing Redis libraries
- macOS `otool -L` check for expected bundled OpenSSL references on macOS

Manual validation:

- Fresh `npx` startup on each supported platform.
- Stop command.
- Reset command.
- Basic onboarding.
- Provider detection page loads.
- Build one tiny app prompt enough to confirm worker/provider path starts.

Acceptance criteria:

- `npx --yes @second-inc/cli` works on Apple Silicon Mac, Intel Mac, Linux x64/WSL2, and Linux arm64.
- Native Windows shows an honest unsupported message and recommends WSL2.
- npm has all platform payload packages and the launcher at the same version.
- The launcher version is never published before matching payload versions.
- Docs match what is actually released.


## Idempotence and Recovery


Release builds are mostly repeatable, but npm package versions are immutable. Once a package version is published, the same version cannot be published again. Recovery should use a new patch version unless the failure happened before npm publish.

Safe retries:

- Re-run runtime prep into a clean temp directory.
- Re-run local pack checks.
- Re-run failed CI jobs before any npm publish step has succeeded.
- Re-run fresh `npx` tests after clearing npm cache/state.

Unsafe or special-case retries:

- Re-running `npm publish` for the same package version after it already succeeded will fail.
- Publishing launcher after only some payloads succeeded creates a bad user-visible release. The workflow must prevent this.

Rollback:

- If a platform package is published but broken, publish a new patch version.
- If the launcher points to a broken platform, publish a new launcher patch that removes or fixes that mapping.
- Do not rely on npm unpublish as a normal rollback strategy.


## Interfaces and Dependencies


Repository interfaces:

- Launcher payload mapping: `resolvePayloadPackage()` in `packages/cli/bin/second.js`.
- Runtime ID detection: `currentRuntimeId()` in `packages/cli/bin/second.js` and `packages/cli-local-darwin-arm64/bin/second-local.js`.
- Runtime prep interface: `packages/cli/scripts/prepare-runtime.mjs --runtime-id <id> --package-root --out <dir>`.
- Payload bundle interface: `packages/cli/scripts/bundle-worker.mjs --out <dir>`, to be extended with target runtime support.
- npm package metadata: `name`, `version`, `os`, `cpu`, `bin`, `files`.
- GitHub Actions release workflow: `.github/workflows/release-cli.yml`.

External dependencies:

- npm registry and `@second-inc` org package permissions.
- npm trusted publishing / OIDC for each package.
- GitHub Actions runners for target platforms.
- MongoDB binary downloads through `mongodb-memory-server-core`.
- Homebrew formula metadata and bottles for Redis.
- Node.js/npm on user machines.


## Artifacts and Notes


Important current code facts:

- `packages/cli/bin/second.js` currently returns a payload only for `darwin-arm64`.
- `packages/cli/scripts/prepare-runtime.mjs` currently accepts `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, and rejects `win32-x64`.
- `packages/cli-local-darwin-arm64/bin/second-local.js` already searches for optional runtime package manifests before bundled runtime manifests.

Suggested package names:

| Runtime ID | Package |
| --- | --- |
| `darwin-arm64` | `@second-inc/cli-local-darwin-arm64` |
| `darwin-x64` | `@second-inc/cli-local-darwin-x64` |
| `linux-x64` | `@second-inc/cli-local-linux-x64` |
| `linux-arm64` | `@second-inc/cli-local-linux-arm64` |

GitHub runner references checked during planning:

- GitHub-hosted runner reference lists public/private standard runners including `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, and `macos-15-intel`: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- GitHub changelog says Linux and Windows arm64 standard hosted runners are generally available for public repositories and lists `ubuntu-24.04-arm`, `ubuntu-22.04-arm`, and `windows-11-arm`: https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/
- npm trusted publishing docs explain OIDC-based package publishing from CI without long-lived tokens: https://docs.npmjs.com/trusted-publishers

Suggested implementation prompt for a future agent:

    Implement the plan in plans/cli-multi-platform-distribution.md. Do not add native Windows support yet. Support darwin-arm64, darwin-x64, linux-x64, and linux-arm64 for the packaged CLI. Keep npx --yes @second-inc/cli as the only user command. Build each payload on matching GitHub Actions runners, publish payloads first, and publish the launcher last. Validate runtime binaries on target platforms before changing docs to say the platform is supported.


## Outcomes & Retrospective


No implementation has been done yet. This plan records the current distribution truth and the recommended rollout path.


## Change Notes


- 2026-05-17: Initial plan created from repository inspection and current distribution question.


## Captured User Intent (Verbatim)


Codex, I have a crucial question. It's regarding distribution. I'm talking specifically about the CLI distribution. Is it true that right now we are only supporting ARM Mac OS because this is my machine? What if I'd like it to support Linux and also Windows? How would you go about it? I have a Windows machine, by the way, here at my home so maybe I can release from there, like clone the repo and run the release command to release from there or something. It should all be set for me to do it.

Regarding Linux, honestly I don't know what to do. Maybe we can compile for Linux from my machine, maybe not. Also what about non-ARM macOS machines? Please help.

Please do not actually implement anything. I just need a full plan file on what to do and remember that the plan should be extremely simple, straightforward to implement, to use with uninstructions if needed and agent instructions if needed, etc.
