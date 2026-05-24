# Ship Nontechnical Desktop Installers


## Living Document Note


This plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Change Notes` current as the work evolves. This file must remain consistent with `PLANS.md`, `.agent/PLANS.md` if present in a future checkout, and the repository planning rules.


## Overall Goal


Ship Second as a normal desktop application that nontechnical users can install and run on macOS, Windows, and Linux without learning Node.js, npm, WSL, Docker, MongoDB, Redis, or terminal commands.

The user-visible goal is simple:

- Mac users download and open a signed/notarized app installer, then launch Second from Applications.
- Windows users download and run a signed installer, then launch Second from the Start menu or desktop.
- Linux users download an AppImage, `.deb`, or `.rpm`, then launch Second from the desktop menu or terminal.
- In every case, the app starts the local Second stack, opens the Second UI inside an app window, reports progress clearly, can stop/reset/update itself, and gives useful recovery instructions when the host machine blocks a prerequisite.


## Goal Description / Sub-goals


The work is complete when all of these are true:

1. There is a desktop application package source in the monorepo, tentatively `apps/desktop`, with a small native shell around the existing Second local runtime.
2. The desktop app does not require the user to install Node.js, npm, Docker, MongoDB, Redis, Homebrew, WSL manually, or any CLI runtime before the app can open.
3. macOS installers are signed and notarized, with one universal app or two architecture-specific builds for Apple Silicon and Intel Macs.
4. Windows installers are signed and work for nontechnical Windows users through exactly one v1 runtime path: a Second-managed WSL2 runtime hidden behind the Windows app.
5. Linux packages are built for the same Linux runtime targets used by the CLI, with desktop integration where practical.
6. The existing CLI remains useful for developers and power users, but it is no longer the only local-install path.
7. The desktop app and CLI share one core local supervisor implementation so process management, runtime setup, ports, stop/reset, update status, telemetry flags, secrets, and logs do not fork into two independent systems.
8. MongoDB and Redis runtime behavior is validated on macOS, Linux, and the Windows-managed WSL2 runtime.
9. Agent provider detection and onboarding work from the desktop app. A user can choose Claude Code, Codex, OpenCode, or API-key based providers according to what the local runtime can actually access.
10. CI builds release artifacts for macOS, Windows, and Linux, signs them where required, and publishes artifacts in a repeatable release workflow.
11. QA guides and release checklists exist for clean-machine tests on all supported OSes.


## Motivation


The current product promise is that Second is local and easy to try. The current public path is `npx --yes @second-inc/cli`, which is acceptable for technical users but not for most nontechnical users. Nontechnical users do not know what `npx` is, often do not have Node installed, and will not debug Redis, WSL, or shell setup.

The requested product outcome is an app install experience: download, install, open. The user should not need to understand the implementation detail that Second runs a local Next.js web server, a worker process, MongoDB, Redis, and agent CLIs. The app should hide that complexity while preserving the security model already present in the web and worker architecture.

This is especially important for Windows. A WSL2 setup guide is not enough for nontechnical users. For this plan, Windows has one product architecture: the signed Windows app manages WSL2 internally and treats it as an implementation detail.


## State Before


The current repository is a monorepo with:

- `apps/web`: the Next.js app and API layer.
- `apps/worker`: the agent worker that runs Claude Code, Codex CLI, and OpenCode adapters.
- `packages/cli`: the tiny `@second-inc/cli` launcher users run through `npx`.
- `packages/cli-local-darwin-arm64`: the current large local payload package, containing the local runtime supervisor in `bin/second-local.js`.
- `packages/runtime-*`: runtime package stubs for macOS and Linux.
- `plans/cli-multi-platform-distribution.md`: an existing plan for making the `npx` CLI work across more platforms.

The current local runtime model is:

1. A launcher starts the local payload.
2. The payload supervisor starts MongoDB on loopback.
3. The payload supervisor starts Redis on loopback.
4. The payload supervisor starts the packaged Next.js standalone server.
5. The payload supervisor starts the worker process.
6. The worker talks to local agent runtimes such as `claude`, `codex`, or `opencode`.
7. The app opens in the user browser at `http://localhost:<port>`.

The key current implementation is `packages/cli-local-darwin-arm64/bin/second-local.js`. It already handles many desktop-app concerns:

- local data paths under `~/.second`;
- generated secrets under `~/.second/secrets`;
- MongoDB replica-set initiation;
- Redis ping checks;
- port selection;
- web and worker process spawning;
- local control server with bearer-token authorization;
- stop/reset/update commands;
- health checks;
- browser handoff;
- log files under `~/.second/logs`.

Important limitations before this work:

- The user must currently have Node/npm to use `npx`.
- The user interacts with terminal output, not an app.
- The published CLI historically supported only Apple Silicon macOS. Recent partial work added experimental `linux-x64` / WSL2 direction, but that is still not a nontechnical desktop install path.
- `packages/cli/scripts/prepare-runtime.mjs` explicitly rejects `win32-*` because a Redis-compatible native Windows runtime has not been chosen.
- The worker detects provider CLIs by looking for commands on the backend host. On Windows via WSL2, this means Linux-side provider setup, not native Windows-side provider setup, unless the desktop app bridges that deliberately.
- Linux Claude Code support currently requires `bubblewrap` when subprocess environment scrubbing is enabled. A managed Linux runtime must include or handle that dependency.
- Docs such as `docs/quickstart.mdx` still describe the packaged CLI as Apple Silicon focused and are not a desktop-app guide.


## State After


After this work, Second has a desktop distribution layer in addition to the CLI.

The desktop app is a shell around the same local stack. It starts and manages local backend processes, shows setup/progress/errors in a native window, and loads the local Second web UI in an embedded browser view.

The target user flows are:

### macOS

1. User downloads `Second.dmg` or `Second.pkg`.
2. User installs or drags Second into Applications.
3. User opens Second.
4. macOS Gatekeeper accepts the app because it is signed and notarized.
5. The app starts the local runtime.
6. The app window displays the Second UI.
7. Stop, reset, logs, and update actions are available from app menus or settings.

### Windows

1. User downloads `SecondSetup.exe` or `Second.msi`.
2. User runs the signed installer.
3. User opens Second from Start menu or desktop.
4. The app checks for a Second-managed WSL2 runtime.
5. If WSL2 is missing or disabled, the app explains the requirement in plain language, triggers the Windows-supported install/elevation flow, and resumes after reboot when possible.
6. The app imports or repairs only Second's own managed Linux runtime.
7. The user does not type WSL commands, open Ubuntu, install Node, or run `npx`.
8. The app window displays the Second UI.

### Linux

1. User downloads `Second.AppImage`, `.deb`, or `.rpm`.
2. User installs or runs it.
3. The app starts the local runtime using packaged Linux binaries.
4. The app window displays the Second UI.

The CLI still exists. Technical users can continue to run `npx --yes @second-inc/cli`. The desktop app is the default path for nontechnical users.


## Context and Orientation


Second is not a traditional single-process desktop app. It is a local platform made of several cooperating services:

- the web app, implemented in `apps/web`, provides the UI, API routes, persistence, auth/onboarding, guard checks, app data, governance, streaming bridge, and settings;
- the worker, implemented in `apps/worker`, runs agent sessions and normalizes provider events;
- MongoDB stores durable workspaces, apps, runs, messages, source snapshots, app data, audit logs, members, and integrations;
- Redis stores live/replay coordination such as run replay chunks, pub/sub events, OAuth state, short locks, and workspace realtime invalidation hints;
- local agent runtimes such as Claude Code, Codex CLI, and OpenCode are separate executables that the worker may launch.

The local CLI already packages most of this. It is effectively a terminal-based desktop supervisor. A real desktop app should not rebuild the whole stack from scratch. It should extract the local supervisor logic into a reusable module and then provide a desktop-specific frontend around it.

Important plain-language terms:

- **Desktop shell**: the installed app window and native menus. It can be Electron, Tauri, or another desktop framework.
- **Local supervisor**: the backend process manager that starts MongoDB, Redis, web, and worker, checks health, and stops them safely.
- **Payload**: packaged app files and runtime binaries needed to run Second locally.
- **WSL2**: Windows Subsystem for Linux 2. It lets Windows run Linux programs. For this plan, WSL2 is the only Windows v1 runtime path and must be hidden behind the installer and app.
- **Native Windows runtime**: a future possible implementation that would run directly from Windows without WSL2. It is not part of this plan because adding it now creates an extra architecture branch and a Redis-compatible Windows runtime decision.
- **Managed WSL distro**: a custom Linux filesystem imported and controlled by Second, not a user-managed Ubuntu terminal.


## Relevant Files and Code Areas


- `apps/web`
  - The web UI and API routes loaded inside the desktop app window.
  - Must continue to treat workspace authorization, app data, audit logs, and streaming as server-side responsibilities.

- `apps/worker`
  - The local agent worker.
  - Important files include `apps/worker/src/index.ts`, runtime adapters under `apps/worker/src/runtimes/`, and provider detection in `/detect-provider`.
  - Must work when launched by the desktop supervisor instead of the CLI supervisor.

- `apps/web/src/lib/redis.ts`
  - Creates the Redis client used by replay buffers and workspace events.
  - The managed WSL2 Redis runtime must support the commands used by this code and adjacent streaming code.

- `apps/web/src/lib/streams/run-replay.ts`
  - Uses Redis `INCR`, `RPUSH`, `LTRIM`, `PUBLISH`, `SUBSCRIBE`, `LRANGE`, `GET`, `SET EX`, `EXPIRE`, and `DEL`.
  - This file is a concrete compatibility checklist for Redis alternatives.

- `apps/web/src/lib/events/workspace-events.ts`
  - Publishes workspace invalidation events through Redis pub/sub.
  - The managed WSL2 Redis runtime must preserve pub/sub behavior.

- `packages/cli/bin/second.js`
  - Tiny `npx` launcher.
  - Useful reference, but the desktop app should not depend on users having `npx`.

- `packages/cli-local-darwin-arm64/bin/second-local.js`
  - Current local runtime supervisor.
  - The implementation should extract reusable supervisor code from this file instead of duplicating process management in a desktop app.

- `packages/cli/scripts/bundle-worker.mjs`
  - Builds the worker bundle, Next standalone web output, static assets, and runtime binaries.
  - Desktop packaging should either reuse this or replace it with a shared payload build script.

- `packages/cli/scripts/prepare-runtime.mjs`
  - Prepares MongoDB and Redis binaries for a target runtime.
  - Currently supports macOS and Linux targets and rejects native Windows.

- `packages/runtime-*`
  - Existing package stubs for runtime binaries.
  - These can become shared runtime payloads consumed by both CLI and desktop installers.

- `.github/workflows/ci.yml`
  - Existing code checks.
  - Must eventually include desktop app checks and platform smoke tests.

- `.github/workflows/release-cli.yml`
  - Existing or recent CLI release workflow.
  - Desktop release should be a separate workflow or a clearly separated job group.

- `plans/cli-multi-platform-distribution.md`
  - Existing plan for multi-platform CLI distribution.
  - This desktop plan builds on it but has a different user goal: app installers for nontechnical users.

- `README.md`, `docs/quickstart.mdx`, `docs/development.mdx`
  - Must eventually describe desktop app installation separately from CLI and source development.

- New: `apps/desktop`
  - Proposed location for the desktop shell.
  - Should include main process, preload bridge, renderer startup screens, app menus, tray/menu-bar behavior if needed, packaging config, signing config, and update integration.

- New: `packages/local-supervisor`
  - Proposed shared module extracted from `second-local.js`.
  - Should be used by both `packages/cli-local-*` and `apps/desktop` so the CLI and desktop app do not drift.

- New: `packages/local-runtime`
  - Proposed runtime manifest/schema and helper code for resolving packaged MongoDB, Redis binaries, web server, worker bundle, logs, data directories, and platform-specific paths.


## Assumptions and Constraints


- The user asked for a plan only. Do not implement desktop packaging as part of this planning step.
- The final experience must be suitable for nontechnical users.
- The CLI must remain supported for technical users and release automation. On macOS, `npx --yes @second-inc/cli` can remain a valid technical path, but the nontechnical product path is still a downloadable app.
- The desktop app should not weaken tenant isolation, workspace guards, internal token boundaries, app-data scoping, audit logging, or agent tool security.
- The desktop renderer must not receive internal API tokens, MongoDB URIs, Redis URLs, local control tokens, cookies from other contexts, integration secrets, or raw process environment.
- The desktop app should use loopback-only services by default.
- The local runtime should keep generated secrets in a user-local app data directory with restrictive file permissions where the OS supports them.
- Windows support has one v1 implementation path: managed WSL2 behind the signed Windows app.
- Native Windows runtime support is explicitly out of scope for this plan. It can be revisited in a separate future plan after the desktop app is working and Windows v1 has clean-machine coverage.
- The Windows app must not silently run privileged system changes. If WSL installation or Windows features require elevation, the app must explain why and use a normal Windows elevation flow.
- Corporate-managed Windows machines may block WSL2, virtualization, or unsigned executables. The app must detect this and provide a useful blocked state.
- Mac distribution requires code signing and notarization for a normal nontechnical install experience.
- Windows distribution requires Authenticode signing for a normal nontechnical install experience and fewer SmartScreen warnings over time.
- Linux packaging varies by distro. AppImage is the broadest first artifact, while `.deb` and `.rpm` improve native install feel.
- Official docs confirm that WSL can be installed with `wsl --install`, that WSL can import custom distributions from tar files, and that WSL is available on Windows 10 build 19041+ or Windows 11. This plan restates those facts so a future reader does not need to chase links.
- Official Redis documentation does not provide a simple normal native Windows Redis Open Source packaging path equivalent to macOS/Linux. This is one reason native Windows is not part of this v1 plan.
- Electron is the default recommendation because Second is already a web app and Electron gives a proven cross-platform webview, process control, packaging ecosystem, and auto-update ecosystem. Tauri can be reevaluated later if app size becomes more important than integration speed.


## Progress


- [x] 2026-05-24 21:20 Asia/Jerusalem: Read `PLANS.md` and confirmed a new plan file is required under `plans/`.
- [x] 2026-05-24 21:25 Asia/Jerusalem: Read `plans/cli-multi-platform-distribution.md` and confirmed existing CLI thinking treats WSL2 as the first Windows bridge and native Windows as a later runtime milestone.
- [x] 2026-05-24 21:35 Asia/Jerusalem: Reviewed current CLI launcher, local supervisor, runtime preparation script, and worker provider detection paths.
- [x] 2026-05-24 21:45 Asia/Jerusalem: Created this desktop distribution plan.
- [ ] Implement Phase 0 feasibility probes.
- [ ] Implement shared local supervisor extraction.
- [ ] Implement macOS desktop installer.
- [ ] Implement Linux desktop installer.
- [ ] Implement Windows managed WSL2 installer.
- [ ] Run clean-machine QA and publish desktop artifacts.


## Surprises & Discoveries


- `packages/cli-local-darwin-arm64/bin/second-local.js` is already close to a desktop backend supervisor. It should be extracted and reused rather than replaced.
- `packages/cli/scripts/prepare-runtime.mjs` already knows how to fetch MongoDB for `win32` because it chooses `mongod.exe`, but it rejects Windows before Redis preparation. This confirms native Windows should stay out of the v1 desktop architecture.
- The worker provider detection runs on the backend host. If the Windows desktop app uses WSL2, `claude`, `codex`, and `opencode` must be installed and authenticated inside the managed Linux environment or bridged from Windows intentionally.
- Linux Claude Code support has a `bubblewrap` requirement when subprocess environment scrubbing is enabled. A managed WSL/Linux runtime must include `bubblewrap` or the app must explain that Claude Code is unavailable until the dependency is present. Disabling env scrubbing is not acceptable as the default for nontechnical users.
- The desktop app must be careful not to expose local control tokens to the renderer. The current CLI already treats `SECOND_LOCAL_CLI_TOKEN` as server-side only.
- The recent README WSL2 instructions are useful as a temporary technical-user bridge but do not satisfy the user’s nontechnical installer goal.


## Decision Log


- 2026-05-24, Codex: Use a desktop app installer as the primary nontechnical distribution path. Rationale: `npx` and WSL instructions are not appropriate for nontechnical users.
- 2026-05-24, Codex: Prefer Electron for the first desktop implementation. Rationale: Second is already a web app, Electron can host the existing UI with minimal product rewrite, and its ecosystem supports macOS, Windows, and Linux packaging.
- 2026-05-24, Codex: Extract the local supervisor from `second-local.js` before building desktop-specific process management. Rationale: forking process startup logic would create drift in security, logs, ports, update, and cleanup behavior.
- 2026-05-24, Codex: Treat Windows v1 as exactly one path: a signed Windows app that manages WSL2 internally. Rationale: one Windows architecture is easier to build, test, explain, and support; native Windows can be a future project after the app path is proven.
- 2026-05-24, Codex: Do not expose privileged WSL installation as a silent side effect. Rationale: Windows feature installation can require admin elevation and restart; the user must understand and approve OS-level changes.
- 2026-05-24, Codex: Do not present native Windows as a parallel option in this plan. Rationale: multiple Windows runtime choices create unnecessary architecture branches and more places for the product to fail.
- 2026-05-24, Codex: Keep the CLI as a separate supported path. Rationale: it remains useful for developers, CI, and debugging, and can share the same supervisor module.


## Plan of Work


The correct plan is not “Electron runs `npx`.” That would still require Node/npm, npm cache behavior, and platform package resolution on the user’s machine. For nontechnical users, the desktop app should own the runtime.

The implementation should introduce three layers:

1. **Shared local supervisor**: reusable Node module extracted from `packages/cli-local-darwin-arm64/bin/second-local.js`. It owns process startup, health checks, stop/reset, logs, update hooks, data directories, ports, secrets, and runtime manifest resolution.
2. **Platform payload builder**: shared build scripts that produce platform-specific runtime payloads containing the Next.js standalone server, worker bundle, MongoDB, Redis or Redis-compatible binary, and runtime manifest.
3. **Desktop shell**: Electron app in `apps/desktop` that displays local setup progress and embeds the Second web UI after the supervisor is ready.

The desktop app should not call `npx --yes @second-inc/cli` in production. It may call the shared supervisor directly or spawn a bundled supervisor entrypoint. This removes user dependency on Node/npm and avoids npm being part of app launch.

### macOS Runtime Strategy

macOS should use a native packaged runtime:

- packaged Node runtime or Electron’s Node runtime for supervisor execution;
- packaged MongoDB binary;
- packaged Redis binary and required OpenSSL libraries;
- packaged Next.js standalone server;
- packaged worker bundle.

The current CLI payload already proves this direction on Apple Silicon. The desktop work should make this a signed app instead of an `npx` command.

macOS deliverables:

- `Second.dmg` for drag-to-Applications installation;
- optionally `Second.pkg` if a more guided installer is needed;
- signed and notarized app bundle;
- universal binary if practical, otherwise separate arm64 and x64 downloads.

### Linux Runtime Strategy

Linux should use the same native packaged runtime direction as CLI Linux:

- packaged Node runtime or Electron’s Node runtime;
- packaged MongoDB binary;
- packaged Redis binary and required shared libraries;
- packaged Next.js standalone server;
- packaged worker bundle;
- packaged `bubblewrap` guidance or dependency handling for Claude Code if needed.

Linux deliverables:

- AppImage first for broad testability;
- `.deb` and `.rpm` after the AppImage path is stable;
- desktop file, icon, and MIME/menu integration where useful.

### Windows Runtime Strategy

Windows v1 has one architecture: the signed Windows app manages WSL2 behind the scenes.

The user must not choose between native Windows and WSL2. The user should see only the Second installer and the Second app. WSL2 is an internal runtime detail, similar to how MongoDB and Redis are internal runtime details.

The Windows app flow is:

- Windows Electron app is installed normally.
- On first launch, it checks for WSL2 availability.
- If WSL2 is missing, it guides the user through installing the Windows feature with a clear elevation/restart flow.
- It imports a Second-owned Linux filesystem using `wsl --import`.
- That imported distro includes the dependencies Second needs, such as Node/runtime dependencies, MongoDB/Redis runtime support, CA certificates, and `bubblewrap`.
- The Windows app starts the Linux supervisor through `wsl.exe -d Second`.
- The Electron window loads the web UI through `localhost`.

This path has known limitations:

- some machines do not allow WSL;
- first install can require admin and restart;
- provider auth inside WSL is separate from Windows provider auth;
- filesystem and process cleanup must be handled carefully;
- enterprise IT may block WSL.

Managed WSL2 can still satisfy the nontechnical user goal if the installer/app owns the complexity and surfaces clear states:

- “Setting up Second runtime” instead of “installing WSL” jargon;
- “Windows needs to enable a built-in Linux runtime. This may require administrator approval and a restart.”;
- “Your organization blocks the required Windows runtime. Contact IT or use cloud/on-prem deployment.”

Native Windows is intentionally not part of this plan. A future native Windows plan may be useful later, but it should not be implemented in parallel with Windows v1.

### Desktop App UX

The first screen should be the actual app shell, not a marketing landing page. Before the local web server is ready, the app should show a compact startup status surface:

- Checking local runtime
- Starting database
- Starting realtime service
- Starting Second
- Opening workspace

Each step should have a clear failure state:

- View logs
- Retry
- Reset local runtime
- Open troubleshooting instructions
- Contact support link

The desktop app should expose:

- Stop Second
- Restart Second
- Reset local data
- Open logs folder
- Copy diagnostics
- Check for updates
- Quit

For Windows WSL2, it should also expose:

- Repair Second runtime
- Reinstall Second runtime
- Export diagnostics

### Security Design

The desktop app must preserve current security boundaries:

- The web layer remains the source of truth for workspace authorization, app-data scoping, audit logs, integration access, and approval flows.
- The worker must not receive broad secrets beyond what it needs.
- The renderer must not receive internal tokens.
- Local control APIs must remain loopback-only and bearer-token protected.
- Desktop IPC must use an allowlist of commands, not arbitrary shell execution.
- Logs and diagnostics must redact tokens, headers, cookies, MongoDB URIs, Redis URLs, integration secrets, and provider API keys.
- Runtime files must be verified by checksums or signature as part of packaging.
- Update installation must preserve code signing and not execute unsigned downloaded scripts.

### Release Design

Desktop release should be separate from CLI release:

- CLI release publishes npm packages.
- Desktop release publishes OS installers.
- Both may share the same version number, but each release workflow should be independently understandable.

Recommended artifacts:

| Platform | Artifact | Notes |
| --- | --- | --- |
| macOS arm64/x64 | `.dmg` plus optional `.zip` for auto-update | signed and notarized |
| Windows x64 | `.exe` installer or `.msi` | signed; manages WSL2 internally |
| Linux x64 | `.AppImage` first, `.deb` and `.rpm` later | signing/checksums required |
| Linux arm64 | later phase | depends on runtime validation |


## Phased Implementation Plan


### Phase 0: Feasibility Decisions and Runtime Tests

Purpose:

Answer the platform feasibility questions before building UI around them.

Files and code areas touched:

- `packages/cli/scripts/prepare-runtime.mjs`
- `apps/web/src/lib/streams/run-replay.ts`
- `apps/web/src/lib/events/workspace-events.ts`
- `apps/web/src/lib/redis.ts`
- temporary prototype scripts under `scripts/` or `packages/local-runtime/scripts/`

Implementation scope:

- Test macOS packaged runtime as currently done by CLI.
- Test Linux packaged runtime on clean Linux x64.
- Test managed WSL2 import using a small custom rootfs named `SecondDevRuntime`.
- Test Windows-to-WSL localhost access to the local web server.
- Test whether agent provider setup works acceptably inside managed WSL2.

Why this phase is ordered here:

The desktop app architecture depends on proving that the managed WSL2 path can be made reliable enough for nontechnical Windows users.

Human verification:

- On macOS, run the packaged runtime and confirm web, worker, MongoDB, Redis, stop, and reset.
- On Linux, run the packaged runtime and confirm `ldd` shows no missing Redis libraries.
- On Windows WSL2, import a test distro, start a web server inside it, and open it from Windows.

Observable success:

- A written feasibility result is added to this plan under `Surprises & Discoveries`.
- The plan records whether managed WSL2 is viable for Windows v1 and what blocked states the app must handle.

Rollback / retry notes:

- All prototype data should use temporary directories and a temporary WSL distro name.
- Remove prototype WSL distro with `wsl --unregister SecondDevRuntime` if needed.


### Phase 1: Extract Shared Local Supervisor

Purpose:

Make CLI and desktop use the same backend startup logic.

Files and code areas touched:

- `packages/cli-local-darwin-arm64/bin/second-local.js`
- new `packages/local-supervisor`
- new or updated `packages/local-runtime`
- `packages/cli-local-*`
- `docs/development.mdx`

Implementation scope:

- Move reusable supervisor functions out of `second-local.js`.
- Keep a CLI-specific entrypoint that renders terminal UI.
- Add a programmatic API for desktop:
  - `start()`
  - `stop()`
  - `reset()`
  - `status()`
  - `logs()`
  - `checkForUpdate()`
  - `installUpdate()`
- Emit structured progress events instead of only terminal text.
- Preserve data paths, secrets, port selection, health checks, local control server, and process cleanup behavior.

Why this phase is ordered here:

Without this extraction, desktop and CLI would fork core runtime behavior and eventually diverge.

Human verification:

- Run CLI after extraction and confirm behavior is unchanged.
- Run a small test script that imports the supervisor API and starts/stops the stack without terminal UI.

Observable success:

- `npx --yes @second-inc/cli` still starts Second.
- Programmatic supervisor smoke test starts Second and reports structured progress.

Rollback / retry notes:

- Keep the old CLI entrypoint behavior available until the shared supervisor is proven.
- If extraction breaks CLI, restore `second-local.js` behavior before continuing.


### Phase 2: Build Desktop Shell Skeleton

Purpose:

Create the desktop app without platform-specific installer complexity yet.

Files and code areas touched:

- new `apps/desktop`
- root `package.json` if workspace scripts are needed
- `.github/workflows/ci.yml`
- shared supervisor package

Implementation scope:

- Add Electron app with main process, preload bridge, and renderer.
- Main process starts the shared supervisor.
- Renderer displays structured startup progress.
- Once ready, renderer loads the local web UI.
- Add app menu actions for stop, restart, reset, open logs, copy diagnostics, and quit.
- Ensure renderer IPC is strictly allowlisted.

Why this phase is ordered here:

It proves the desktop interaction model before signing, installers, and Windows runtime complexity.

Human verification:

- Run the desktop app in development mode.
- Confirm startup progress appears.
- Confirm the Second UI loads.
- Confirm stop/restart/reset buttons work.
- Confirm logs can be opened.

Observable success:

- A local developer can use Second through the desktop app instead of a browser opened by CLI.

Rollback / retry notes:

- Keep CLI as the fallback local runtime during this phase.


### Phase 3: Build macOS Installer

Purpose:

Ship the first production-quality app installer on the platform closest to the existing CLI support.

Files and code areas touched:

- `apps/desktop`
- desktop packaging config
- `.github/workflows/release-desktop.yml`
- runtime payload scripts
- signing/notarization secrets configuration

Implementation scope:

- Build macOS desktop app for arm64 and x64 or a universal app.
- Include platform runtime payload.
- Sign the app.
- Notarize the app.
- Produce `.dmg`.
- Add auto-update support only after signed installs are stable.

Why this phase is ordered here:

macOS is the current strongest packaged runtime path, so it is the best first desktop release.

Human verification:

- Download artifact on a clean Mac.
- Install app.
- Launch from Applications.
- Confirm no Gatekeeper block.
- Complete onboarding.
- Build a tiny app.
- Stop, quit, reopen, and confirm data persists.
- Reset local data and confirm fresh onboarding.

Observable success:

- A nontechnical Mac user can install and run Second without terminal commands.

Rollback / retry notes:

- If notarization fails, do not publish the installer.
- If runtime fails after installation, fix and produce a new signed build.


### Phase 4: Build Linux Desktop Packages

Purpose:

Support Linux users with a normal app artifact.

Files and code areas touched:

- `apps/desktop`
- desktop packaging config
- Linux runtime payload scripts
- `.github/workflows/release-desktop.yml`

Implementation scope:

- Produce AppImage for Linux x64.
- Add `.deb` and `.rpm` after AppImage smoke tests pass.
- Bundle runtime dependencies or validate system dependencies clearly.
- Include desktop icon and `.desktop` metadata.

Why this phase is ordered here:

Linux runtime support is close to the CLI Linux direction and uses the same Linux runtime family that Windows v1 will run inside managed WSL2.

Human verification:

- Run AppImage on clean Ubuntu.
- Confirm app starts without Docker, MongoDB, Redis, Node, or npm installed by the user.
- Confirm provider detection and onboarding.
- Confirm app menu reset/stop/logs.

Observable success:

- Linux user can launch Second as a desktop app.

Rollback / retry notes:

- If AppImage works but `.deb` or `.rpm` packaging has issues, ship AppImage first and keep distro packages experimental.


### Phase 5: Build Windows Managed WSL2 Installer

Purpose:

Provide the Windows v1 install path.

Files and code areas touched:

- `apps/desktop`
- Windows installer config
- new managed WSL runtime build scripts
- `packages/local-runtime`
- `.github/workflows/release-desktop.yml`
- docs and QA guides

Implementation scope:

- Add Windows app that checks WSL status using `wsl.exe --status` / `wsl.exe -l -v`.
- Add clear setup states:
  - WSL available
  - WSL missing
  - admin required
  - restart required
  - organization blocked WSL
  - runtime import failed
- Build or download a Second-managed WSL rootfs tar.
- Import the distro as `Second`.
- Install it under a Second-owned app data directory.
- Start the supervisor inside WSL.
- Load the local web UI from the Windows Electron app.
- Add repair/reinstall runtime actions.
- Add uninstall cleanup guidance and optional runtime removal.

Why this phase is ordered here:

It gives Windows users a clickable app using the single supported Windows v1 architecture.

Human verification:

- Clean Windows machine with WSL absent:
  - install app;
  - app requests WSL setup;
  - restart if needed;
  - app resumes and imports runtime;
  - app starts Second.
- Windows machine with WSL already present:
  - install app;
  - app imports Second runtime without touching existing user distros;
  - app starts Second.
- Corporate-blocked machine:
  - app shows blocked state and does not loop or fail silently.

Observable success:

- A nontechnical Windows user can install and open Second without typing WSL commands.

Rollback / retry notes:

- Use a unique WSL distro name such as `Second` or `SecondRuntime`.
- Never unregister user distros.
- Runtime repair should affect only the Second-managed distro.


### Phase 6: Harden Windows Managed WSL2 Runtime

Purpose:

Make the one Windows v1 path reliable enough for nontechnical users and supportable enough for release.

Files and code areas touched:

- `packages/local-runtime`
- `packages/local-supervisor`
- `apps/desktop`
- Windows CI jobs
- managed WSL runtime build scripts
- QA guides

Implementation scope:

- Test Windows install when WSL is absent.
- Test Windows install when WSL exists but no Second distro exists.
- Test Windows install when the Second distro exists but is corrupted.
- Test repair, reinstall, reset, stop, and uninstall behavior.
- Test restart-resume after WSL installation requires reboot.
- Test blocked states for machines where WSL is disabled by policy or virtualization is unavailable.
- Test provider onboarding inside the managed WSL runtime.
- Test logs and diagnostics redaction from both Windows and WSL sides.

Why this phase is ordered here:

The Windows architecture is intentionally one path, so its failure states need strong coverage before release.

Human verification:

- On a clean Windows machine, install and launch Second.
- On a Windows machine with WSL already installed, install and launch Second without modifying user distros.
- Simulate corrupted Second runtime and confirm repair works.
- Simulate blocked WSL and confirm the app shows a clear blocked state.

Observable success:

- Windows users can install and open Second without typing WSL commands, and support can diagnose failures through app-generated diagnostics.

Rollback / retry notes:

- If managed WSL2 reliability is not good enough, do not ship Windows desktop yet. Do not introduce a second native Windows runtime path as a shortcut inside this plan.


### Phase 7: Updates, Diagnostics, and Supportability

Purpose:

Make the desktop app maintainable after release.

Files and code areas touched:

- `apps/desktop`
- shared supervisor
- release workflow
- docs
- QA guides

Implementation scope:

- Implement signed auto-update or guided update flow.
- Add diagnostics export.
- Add log redaction.
- Add version reporting:
  - desktop app version;
  - web/worker payload version;
  - runtime ID;
  - MongoDB/Redis runtime versions;
  - OS version;
  - WSL status on Windows.
- Add support bundle export that excludes secrets.

Why this phase is ordered here:

Nontechnical users need recovery paths when local services fail.

Human verification:

- Force a broken runtime and confirm diagnostics can be exported.
- Trigger update check and confirm signed update path.
- Confirm exported diagnostics contain useful logs but no secrets.

Observable success:

- Support can diagnose common startup failures without asking users to run terminal commands.

Rollback / retry notes:

- If auto-update is risky, ship manual update downloads first.


### Phase 8: Documentation, Website, and QA

Purpose:

Make the install paths understandable and testable.

Files and code areas touched:

- `README.md`
- `docs/quickstart.mdx`
- `docs/development.mdx`
- `docs/self-hosting.mdx`
- `QA/`
- release checklist docs

Implementation scope:

- Separate docs into:
  - Desktop app install
  - CLI install
  - Development from source
  - Self-hosting
- Create clean-machine QA guides for macOS, Windows, and Linux.
- Document that Windows support means the signed Second app manages WSL2 internally.
- Add troubleshooting pages for blocked WSL, port conflicts, provider CLI missing, reset, logs, and updates.

Why this phase is ordered here:

Docs should match what actually shipped.

Human verification:

- Give the docs to someone unfamiliar with the repo.
- They should be able to install and run Second on each supported OS.

Observable success:

- No docs imply users need terminal commands for the desktop install path.

Rollback / retry notes:

- Do not call the Windows v1 runtime native Windows.


## Concrete Steps and Commands


These commands are for future implementation sessions. They should be run from the repository root unless noted.

Read the current local runtime files:

    sed -n '1,260p' packages/cli-local-darwin-arm64/bin/second-local.js
    sed -n '1,220p' packages/cli/scripts/prepare-runtime.mjs
    sed -n '1,140p' packages/cli/scripts/bundle-worker.mjs

Inspect Redis usage to build compatibility tests:

    rg -n "getRedisClient|\\.publish\\(|\\.subscribe\\(|\\.rpush\\(|\\.lrange\\(|\\.set\\(|\\.expire\\(|\\.incr\\(" apps/web apps/worker

Validate current code before extraction:

    npm run typecheck
    npm --prefix packages/cli run build

Linux runtime feasibility:

    node packages/cli/scripts/prepare-runtime.mjs --runtime-id linux-x64 --package-root --out /tmp/second-runtime-linux-x64
    /tmp/second-runtime-linux-x64/bin/mongod --version
    /tmp/second-runtime-linux-x64/bin/redis-server --version
    ldd /tmp/second-runtime-linux-x64/bin/redis-server

Windows managed WSL2 prototype commands, to be run from PowerShell by a developer or CI-like Windows test machine:

    wsl --status
    wsl -l -v
    wsl --import SecondDevRuntime C:\SecondDevRuntime .\second-runtime-rootfs.tar --version 2
    wsl -d SecondDevRuntime -- uname -a
    wsl --unregister SecondDevRuntime

Desktop development commands will be defined when `apps/desktop` is introduced. Expected shape:

    npm --prefix apps/desktop install
    npm --prefix apps/desktop run dev
    npm --prefix apps/desktop run package
    npm --prefix apps/desktop run make

Release workflow expectations:

    # Future desktop release, exact command depends on CI design.
    git tag desktop-v0.2.0
    git push origin desktop-v0.2.0


## Validation and Acceptance


Validation must prove the user experience, not just package creation.

Automated validation:

- web typecheck;
- worker typecheck;
- CLI launcher syntax check;
- shared supervisor unit tests;
- Redis compatibility test suite;
- desktop main/preload typecheck;
- desktop packaging dry run for each OS;
- runtime binary version checks;
- installer signing/notarization checks;
- secret redaction tests for diagnostics export.

Manual clean-machine validation:

### macOS acceptance

- Install app from downloaded `.dmg`.
- Launch from Applications.
- Confirm no Gatekeeper warning beyond normal first-open prompts.
- Confirm startup reaches onboarding.
- Create identity and workspace.
- Configure or skip provider according to available credentials.
- Build a tiny app.
- Quit and reopen; data persists.
- Reset; fresh onboarding appears.

### Windows acceptance

- Install on Windows with WSL missing.
- App explains runtime setup and elevation/restart if required.
- After setup, app imports only Second’s managed distro.
- App starts Second and reaches onboarding.
- Existing user WSL distros are untouched.
- App can repair/remove only the Second runtime.
- Streaming/replay works after refresh.
- Stop/restart/reset work.

### Linux acceptance

- Run AppImage or installed package on clean Ubuntu.
- App starts Second without Docker, MongoDB, Redis, Node, or npm installed by the user.
- Provider detection is accurate.
- Stop/restart/reset/logs work.

Cross-platform acceptance:

- Local services bind only to loopback.
- Renderer cannot access internal tokens.
- Diagnostics export contains no secrets.
- Workspace isolation tests still pass.
- App can recover from port conflict with a readable message.
- App can recover from stale process state with repair/reset.


## Idempotence and Recovery


The implementation must be safe to retry.

- Starting the desktop app twice should detect an existing local runtime and attach to it or focus the existing window.
- Stop should be safe even if some child processes already exited.
- Reset should clearly state it deletes local Second data, then delete only Second-owned data.
- Windows managed WSL repair should affect only the Second-managed distro name and install location.
- Windows managed WSL uninstall should never unregister arbitrary user distros.
- Runtime import should be resumable after restart or failed first setup.
- Installer updates should be atomic: failed update leaves the old app usable.
- Logs and local control state should be regenerated if corrupted.
- Port conflicts should trigger choosing another port or a clear message.
- If a packaged runtime binary is missing or corrupt, app should offer repair rather than showing raw stack traces.


## Interfaces and Dependencies


Interfaces that must exist by the end:

- `packages/local-supervisor` programmatic API:
  - `start(options)`
  - `stop(options)`
  - `reset(options)`
  - `status()`
  - `onProgress(listener)`
  - `getDiagnostics()`
  - `checkForUpdate()`
  - `installUpdate()`

- Runtime manifest schema:
  - runtime ID;
  - web server path;
  - worker bundle path;
  - MongoDB binary path and version;
  - Redis or Redis-compatible binary path and version;
  - required runtime libraries;
  - checksum metadata.

- Desktop IPC allowlist:
  - start runtime;
  - stop runtime;
  - reset runtime;
  - open logs folder;
  - copy diagnostics;
  - check/update;
  - repair managed runtime.

- Windows managed WSL interface:
  - detect WSL availability;
  - detect Second distro;
  - import distro;
  - run command in distro;
  - remove/repair Second distro;
  - report blocked/admin/restart states.

External dependencies and services:

- Electron or an equivalent desktop framework.
- Desktop packaging tooling, likely Electron Forge or electron-builder.
- macOS Developer ID certificate and notarization credentials.
- Windows code signing certificate.
- Linux packaging/signing/checksum process.
- GitHub Actions runners for macOS, Windows, and Linux.
- npm packages for CLI path remain separate.
- Microsoft WSL commands if managed WSL2 is used.


## Artifacts and Notes


Relevant current behavior:

    packages/cli-local-darwin-arm64/bin/second-local.js starts:
      MongoDB -> Redis -> Next.js web server -> worker -> health check -> browser handoff

Redis commands currently visible from app code include:

    INCR
    RPUSH
    LTRIM
    LRANGE
    PUBLISH
    SUBSCRIBE
    GET
    SET with expiry
    EXPIRE
    DEL

Important external references checked while writing this plan:

- Microsoft WSL install docs: `https://learn.microsoft.com/en-us/windows/wsl/install`
  - WSL is available on Windows 10 version 2004 / build 19041+ and Windows 11.
  - `wsl --install` can install WSL but may require administrator mode and restart.
- Microsoft WSL custom distro docs: `https://learn.microsoft.com/en-us/windows/wsl/use-custom-distro`
  - `wsl --import <Distro> <InstallLocation> <FileName> [Options]` can import a tar-based Linux distribution.
- Electron packaging/signing docs:
  - `https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging`
  - `https://www.electronjs.org/docs/latest/tutorial/code-signing`
  - `https://www.electronforge.io/guides/code-signing`
- Existing repo plan:
  - `plans/cli-multi-platform-distribution.md`

Plain-language Windows conclusion:

    Windows v1 has one path: install the signed Second app, and the app manages
    WSL2 internally. If WSL2 is blocked by policy or unavailable, the app should
    show a clear blocked state instead of falling back to another backend.


## Outcomes & Retrospective


Not yet implemented. The expected outcome is a desktop installer system that makes Second feel like a normal app on macOS, Windows, and Linux while preserving the existing local/on-prem architecture, security boundaries, and CLI developer path.

After each major phase, update this section with:

- what shipped;
- which platforms passed clean-machine QA;
- how reliable the managed WSL2 Windows path proved to be;
- what remains risky;
- what should be improved before public launch.


## Change Notes


- 2026-05-24, Codex: Created the initial desktop distribution plan in response to the request for a full plan that works for nontechnical Mac, Windows, and Linux users.
- 2026-05-24, Codex: Revised the Windows architecture to one v1 path only: the signed Windows app manages WSL2 internally. Native Windows is now explicitly out of scope for this plan.


## Captured User Intent (Verbatim)


The user wrote:

> Hey, I basically didn't understand anything from your answer. I'm sorry. 
> You need to create a full document plan that will just work for:
> - Mac users to just install an app
> - Windows users to just install an app
> - even if they are non-technical
> - and for Linux obviously

The user later clarified:

> okay so regarding Windows why do we need two options? Why can't we just use, or have, one option, which is the WSL? I mean from my experience whenever there are multiple choices there are more places for things to go wrong in terms of the architecture.

The user also asked whether the plan is self-contained enough to survive context compaction/reset and be used as the source of truth for implementation.
