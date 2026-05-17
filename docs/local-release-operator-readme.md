# Local Release Operator Runbook

This runbook is for private rehearsal of the no-Docker local install path.

## Package shape

The user-facing command is:

```bash
npx --yes @second-inc/cli
```

`@second-inc/cli` is a tiny launcher. It detects the host platform and invokes
the matching payload package, such as `@second-inc/cli-local-darwin-arm64`.
Today, the only published payload is `darwin-arm64` for Apple Silicon Macs.
Intel Mac, Linux, and Windows support are coming soon.

The payload package contains the local runtime:

- Next.js standalone web server
- bundled worker
- MongoDB binary
- Redis binary
- runtime libraries required by those binaries, including OpenSSL libraries on macOS

The CLI does not require Docker, Docker Compose, GHCR, Homebrew, MongoDB, Redis,
or OpenSSL to be installed by the user. The first `npx` run may wait on npm to
download/install the payload package, but the app startup path does not perform
separate MongoDB/Redis/OpenSSL downloads.

## Private npm prerequisites

Use an npm account with access to the `@second-inc` scope:

```bash
npm login
npm whoami
npm access list packages @second-inc
```

If npm opens a browser authentication flow during publish, press Enter in the
terminal, complete the browser approval, and return to the terminal. If npm
reports an OTP error after the browser flow, rerun the same publish command.

## Publish order

Publish the payload first, then the tiny launcher for the same version:

```bash
cd /Users/omervexler/.codex/worktrees/971a/second/packages/cli-local-darwin-arm64
npm publish --access restricted

cd /Users/omervexler/.codex/worktrees/971a/second/packages/cli
npm publish --access restricted
```

Use `--access restricted` for private rehearsal. Switch to public access only
when the public package decision is made.

## Clean-machine rehearsal

This removes local npm `npx` installs, npm tarball cache, old runtime caches,
generated payload builds, and Second local data. It does not remove npm auth:

```bash
node scripts/clear-local-cli-state.mjs --yes
```

Then test the exact user command:

```bash
time npx --yes @second-inc/cli
```

Expected behavior:

- npm may spend time fetching the private packages before the launcher starts.
- the launcher should print quickly after it starts.
- no separate MongoDB, Redis, or OpenSSL download progress should appear.
- MongoDB and Redis should start in one combined startup step.
- startup should reach MongoDB ready, Redis ready, web server ready, and worker ready.

## Stop and reset

Use these commands after startup works:

```bash
npx --yes @second-inc/cli stop
npx --yes @second-inc/cli reset
```

If `stop` itself is slow because npm is fetching the package before it can run,
it is safe to interrupt it and remove local state manually only when no local
Second ports are listening.
