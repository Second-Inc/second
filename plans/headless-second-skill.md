# Build Headless Second Skill


This plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Change Notes` current as the work evolves. This file must remain consistent with `PLANS.md`.


## Overall Goal


Create a releaseable Second "headless app builder" experience for Claude Code and Codex. A user should be able to tell their own Claude or Codex CLI to build a local visual app around a task, and the agent should use Second's local runtime, app preview, app data, integrations, and app-agent infrastructure without showing the normal Second workspace sidebar or builder chat.

The intended product outcome is: "I gave Claude/Codex a skill that lets it build a live Second app locally. The user still talks to their own Claude/Codex. Second provides the visual app surface and the internal app-agent runtime."


## Goal Description / Sub-goals


The work is complete when all of these are true:

- A local headless runtime command exists for public use, preferably through the existing packaged CLI command:

      npx --yes @second-inc/cli headless start

- A repo development alias exists, likely:

      npm run headless

  but this is only for source-checkout development. Public skill instructions should not require cloning the repository unless the packaged CLI does not support the user's platform yet.

- Headless mode opens a Second app page that keeps the app top bar but hides the workspace sidebar and the builder chat. The main first-screen experience is the generated app preview.

- A deterministic local command/API flow lets the external Claude/Codex create or reuse a headless app, locate the app's editable workspace directory, update files, run the preview build, and get the app URL back.

- The preview/build flow reuses Second's real Vite build and artifact preview model. The agent must call a headless preview/build command after edits; it should not rely on in-browser bundling or a separate ad hoc dev server.

- `agents.json` can be created by the external Claude/Codex and approved for local headless use without the user clicking an "Approve Agents" card. This must preserve the security invariant: approved runtime policy is still a validated, canonical, audited hash. Headless mode removes the UI click in local-only mode; it must not remove governance checks.

- `integration-setup.json` can be created/synced without chat. The external agent can tell the user the exact local URL to open for setup, and the headless top bar can expose a compact integrations entry point when setup is needed.

- App agents inside the generated app still work through the existing iframe SDK bridges (`useAgent`, `useCollection`, `callIntegrationTool`) and can run multiple internal agents from the app UI.

- A releaseable skill/plugin package exists for Codex and a Claude-compatible skill package exists. The skill should tell agents exactly how to start Second headless, build the app, call preview, handle agents/integrations, and recover from errors.

- Docs, QA notes, automated tests, and manual browser QA prove that the normal Second app still works and that headless mode does not regress tenant isolation, streaming, preview persistence, or app-agent tool governance.


## Motivation


This is a growth surface. The tweetable story is that a user can keep talking to their own Claude or Codex CLI, but that agent can create a visual GUI around the task using Second. Second becomes the local app runtime and governed agent platform, not another chat surface the user has to talk to.

The product distinction matters:

- The external Claude/Codex is the builder the user is already using.
- Second is the live local app shell, preview runtime, app data layer, integration broker, and internal app-agent execution platform.
- The generated app can run one or more Second app agents inside itself, so the user can ask their external agent to create a UI that orchestrates specialized internal agents.

This should feel lightweight enough for a public skill. Requiring users to clone the repo, install Docker, configure Mongo/Redis, and learn the normal Second workspace UI would weaken the story.


## State Before


Second currently has:

- A normal local development command, `npm run dev`, that starts the web app and worker on the host and starts MongoDB and Redis through Docker Compose. It writes `.second-dev.txt` with the actual local URL.
- A packaged local CLI, `npx --yes @second-inc/cli`, that starts a local runtime without requiring Docker. The current published launcher maps only Apple Silicon macOS to `@second-inc/cli-local-darwin-arm64`.
- A normal workspace route at `apps/web/src/app/w/[workspaceId]/layout.tsx` that always renders `WorkspaceSidebar`, wraps children in `SidebarInset`, and subscribes to `WorkspaceRealtimeProvider`.
- A normal app page at `apps/web/src/app/w/[workspaceId]/apps/[appId]/page.tsx` that loads workspace/app/run/integration state and renders `AppWorkspace`.
- `AppWorkspace` in `apps/web/src/components/app-workspace.tsx`, which already renders the top bar, app preview, file explorer, data explorer, app-agent bridge, app-data bridge, app-integration bridge, agent-run viewer, publish controls, and a hideable builder chat panel.
- Artifact-first preview. `docs/app-preview.mdx` explains that `done_building` runs a real build and the frontend renders `dist/index.html` plus built assets in a sandboxed iframe. There is no Sandpack and no in-browser bundling.
- App-agent governance. `agents.json` is draft source and runtime policy. `present_agents` validates it, the UI stores a canonical hash on approval, and custom tools/app-data tools require the approved hash.
- Integration governance. `integration-setup.json` syncs setup requirements through `present_integration_setup`; custom HTTP tools execute only through server-side approved tool specs and app-scoped grants.
- A public skill/package shape in the broader ecosystem. Official Codex docs say a skill is a directory with `SKILL.md` plus optional scripts/references/assets, and a reusable skill should be distributed as a Codex plugin. Official Claude Code docs support `.claude/skills/` project/personal skills and plugin-distributed skills.

Second does not currently have:

- A first-class headless route without the workspace sidebar.
- A public `headless` CLI command.
- A deterministic local API for an external agent to create a Second app, write into its workspace, build the preview, approve local `agents.json`, or sync integration setup without using the builder chat UI.
- A releaseable public skill that teaches Claude/Codex to use Second in this headless mode.


## State After


After implementation, a user flow should look like this:

1. User installs or invokes the skill in their own Claude/Codex.
2. User asks: "Build me a visual lead triage app with two agents."
3. The external agent runs:

       npx --yes @second-inc/cli headless start --json

4. Second starts locally if needed, creates or reuses a local headless workspace/app, and returns JSON like:

       {
         "workspaceId": "...",
         "appId": "...",
         "appName": "Lead Triage",
         "appDir": "/Users/name/.second/data/workspaces/<appId>",
         "appUrl": "http://localhost:3030/headless/w/<workspaceId>/apps/<appId>",
         "previewCommand": "npx --yes @second-inc/cli headless preview --app <appId> --json",
         "integrationsUrl": "http://localhost:3030/w/<workspaceId>/settings/integrations?appId=<appId>&returnTo=..."
       }

5. The external agent edits the app files under `appDir`, including `src/App.tsx`, `src/lib/second-sdk.ts` usage, optional `agents.json`, and optional `integration-setup.json`.
6. The external agent runs:

       npx --yes @second-inc/cli headless preview --app <appId> --json

7. Second runs the real build, persists the source/artifact snapshot, validates and locally approves `agents.json` if present and safe for local headless mode, syncs integration requirements if present, and returns the updated app URL plus any setup URLs.
8. The browser shows only the headless app surface: top app bar plus generated app preview. No workspace sidebar. No builder chat.
9. If integrations need setup, the external agent tells the user to open the returned URL. The headless top bar also shows a compact integrations button while setup is pending.
10. The generated app can trigger internal Second app agents through the existing SDK and bridges. Agent runs remain visible through the top bar/drawer.


## Context and Orientation


The current Second architecture has four pieces relevant to this plan:

1. Web app (`apps/web`) - Next.js routes, UI, authorization, source snapshot persistence, app preview, app-agent bridges, integration settings, audit events, and workspace realtime.
2. Worker (`apps/worker`) - app workspaces, builder/runtime execution, `done_building`, dependency warmup, scoped MCP broker, app-agent runs, custom tools, and app-data tools.
3. Database/Redis - MongoDB stores workspace/app/run/source/integration/audit state; Redis coordinates workspace realtime, resumable streams, OAuth state, and locks.
4. Local CLI (`packages/cli` and `packages/cli-local-darwin-arm64`) - public `npx` launcher and local supervisor that starts packaged MongoDB, Redis, web, and worker.

The key design choice is to make headless mode a local CLI/API workflow over the same infrastructure, not a new mini app server.

The external Claude/Codex should not talk to the Second builder chat. It should operate directly on an editable local app workspace and call deterministic Second commands. Those commands should call local-only web/worker APIs that reuse the same persistence, build, approval, integration, and audit code as the normal UI.

High-level architecture:

    User
      |
      | prompt
      v
    Own Claude/Codex CLI + Second skill
      |
      | runs deterministic commands
      v
    npx --yes @second-inc/cli headless ...
      |
      | local-control token / loopback-only API
      v
    Second local web API ----------------------------+
      |                                              |
      | create app, persist snapshots, approve policy |
      | sync integration requirements, audit events   |
      v                                              |
    Second worker API                                |
      |                                              |
      | scaffold/restore appDir, install deps,        |
      | run typecheck/build, collect files            |
      v                                              |
    ~/.second/data/workspaces/<appId>                |
      ^                                              |
      | external agent edits React/Vite files         |
      +----------------------------------------------+

    Browser
      |
      v
    /headless/w/<workspaceId>/apps/<appId>
      |
      | top bar remains; sidebar/chat hidden
      v
    AppWorkspace(headlessMode)
      |
      +--> AppPreview sandboxed iframe
      +--> AppDataBridge / AppIntegrationBridge
      +--> AppAgentBridge / AgentRun drawer
      +--> compact integrations link when setup needed

Headless local command sequence:

    headless start
      -> ensure packaged local runtime is running
      -> ensure local no-auth user/workspace exists
      -> create/reuse app
      -> scaffold/return appDir
      -> open headless app URL

    external agent edits appDir

    headless preview --app <appId>
      -> validate local token and app access
      -> ask worker to run real preview build
      -> fetch files from worker
      -> persist draft snapshot
      -> validate and locally approve agents.json if present
      -> sync integration-setup.json if present
      -> publish compact workspace invalidation events
      -> return app URL and setup URLs


## Relevant Files and Code Areas


- `package.json`
  - Add a development-only `headless` script after implementation, likely delegating to a new source-checkout CLI script.

- `scripts/dev.sh`
  - Current source-checkout local dev script. It starts Docker Compose Mongo/Redis and writes `.second-dev.txt`.
  - Do not make public skill users depend on this path.

- `packages/cli/bin/second.js`
  - Tiny public `npx` launcher. It forwards commands to the platform-specific local payload.
  - The public skill should use this command rather than clone the repo.

- `packages/cli-local-darwin-arm64/bin/second-local.js`
  - Local runtime supervisor. Add `headless` subcommands here or factor command handling into reusable modules first if this file becomes too large.
  - It already has local control token/state files, local runtime state, process supervision, packaged Mongo/Redis/web/worker startup, and browser opening.

- `packages/cli/README.md`
  - Update once the public headless flow exists.

- `plans/cli-multi-platform-distribution.md`
  - Existing plan for multi-platform CLI packaging. This plan depends on the same public CLI story. Headless can ship first on supported platforms, but public skill docs must be honest about platform support.

- `apps/web/src/app/w/[workspaceId]/layout.tsx`
  - Current workspace layout always renders the sidebar. Headless route should avoid this layout rather than trying to hide the sidebar inside it.

- `apps/web/src/app/w/[workspaceId]/apps/[appId]/page.tsx`
  - Current app server page. Extract its data-loading logic into a reusable helper so both normal and headless pages render from the same authorization and state model.

- `apps/web/src/components/app-workspace.tsx`
  - Main component to extend with `headlessMode`.
  - Headless mode should keep the top bar and preview/app-agent bridges, initialize the builder panel hidden, and remove the ability to show the builder chat.

- `apps/web/src/components/app-preview.tsx`
  - Artifact-first sandbox iframe renderer. Reuse unchanged where possible.

- `apps/web/src/components/app-agent-bridge.tsx`
  - Existing iframe bridge for app-triggered agents. Must remain enabled in headless mode.

- `apps/web/src/components/app-integration-bridge.tsx`
  - Existing iframe bridge for app-callable integration actions. Must remain enabled in headless mode.

- `apps/web/src/components/app-data-bridge.tsx`
  - Existing iframe bridge for app data. Must remain enabled in headless mode.

- `apps/web/src/app/api/workspaces/[workspaceId]/apps/route.ts`
  - Existing authenticated app creation route. Do not overload it with token-based local automation unless the guard model remains clear.

- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/files/route.ts`
  - Current files read route. Read paths must stay read-only. Do not put build/repair/approval side effects here.

- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/agents/approval/route.ts`
  - Existing browser-session approval route. Headless approval should reuse lower-level approval functions and audit shape, but should not make this normal route silently auto-approve.

- `apps/web/src/app/api/internal/tool-execute/route.ts`
  - Enforces approved `agents.json`, app-scoped grants, OAuth user lookup, secret injection, and network guards. Headless mode must not bypass this route for live tool execution.

- `apps/web/src/app/api/internal/integration-requirements/route.ts`
  - Existing sync path for integration setup metadata. Headless setup sync should reuse its validation/persistence logic through a local-safe path or a shared function.

- `apps/web/src/lib/db/repositories/apps.ts`
  - Source snapshot persistence, approval hash clearing, publishing state, and app metadata. New headless writes should use existing repository helpers and keep workspace scoping.

- `apps/web/src/lib/agents/agents-governance.ts`
  - Canonical validation/hash behavior for `agents.json`. Headless auto-approval depends on this staying the source of truth.

- `apps/worker/src/runner.ts`
  - Current `done_building`, `present_agents`, `present_integration_setup`, custom tools, and app-agent runtime helpers live here.
  - Extract build/snapshot and setup validation pieces as needed so a headless worker endpoint can reuse them without pretending to be a chat tool call.

- `apps/worker/src/index.ts`
  - Worker HTTP routes. Add a local/internal build-preview endpoint only if it can be authenticated through the same worker internal token path and scoped to one app workspace.

- `apps/worker/src/workspace-template.ts`
  - Vite + React + TypeScript + shadcn starter with `src/lib/second-sdk.ts`. Headless app creation should use this same template.

- `.agents/skills/`
  - Existing repo-scoped Codex skill location. Good place for local development/testing of the skill if desired.

- `.claude/skills/`
  - Existing repo-scoped Claude skill location. Good place for Claude compatibility testing if desired.

- A future plugin/skill package directory, recommended:
  - `.agents/plugins/second-headless-app-builder/.codex-plugin/plugin.json`
  - `.agents/plugins/second-headless-app-builder/skills/second-app-builder/SKILL.md`
  - `.agents/plugins/second-headless-app-builder/skills/second-app-builder/scripts/`
  - `.agents/plugins/marketplace.json`


## Assumptions and Constraints


- Public users should not be required to clone the Second repository for the normal flow.
- Public users should not be required to install Docker for the packaged CLI flow.
- The public command should use the existing `@second-inc/cli` release path.
- The repo development command can be `npm run headless`, but that path is for contributors and QA.
- Headless auto-approval is local-only. It must require `SECOND_AUTH_MODE=none`, a loopback request, and a local control/headless token. It must not work in external/on-prem production mode.
- `agents.json` approval must remain hash-based, validated, and audited. The plan removes only the UI click in local headless mode.
- Headless mode must not expose `INTERNAL_API_TOKEN`, MongoDB URLs, Redis URLs, OAuth secrets, access tokens, cookies, headers, or full source snapshots to external agents.
- The editable `appDir` is intentionally exposed to the external agent. This is local single-user workspace content, not platform infrastructure secrets.
- The external agent can use shell/file tools to edit files under `appDir`.
- Read routes remain read-only. Build, approval, setup sync, app creation, and source persistence must live behind explicit write routes/commands.
- Workspace realtime events remain compact invalidation hints. Do not include source files, prompts, secrets, headers, cookies, full documents, or tool outputs in events.
- Normal workspace UI must continue to work unchanged.
- Broad browser QA/dev-server execution requires explicit permission. Implementation sessions should follow the repo QA rules.


## Progress


- [x] 2026-06-03 Asia/Jerusalem: Read `PLANS.md` and confirmed this request requires a new plan file only, not implementation.
- [x] 2026-06-03 Asia/Jerusalem: Read `docs/architecture.mdx`, `docs/streaming.mdx`, `docs/guard-and-tenancy.mdx`, `docs/app-preview.mdx`, `docs/self-hosting.mdx`, `docs/worker.mdx`, `docs/app-agents.mdx`, and `docs/integrations.mdx`.
- [x] 2026-06-03 Asia/Jerusalem: Inspected current local dev, packaged CLI, workspace layout, app page, app workspace, app creation, files, and agents approval routes.
- [x] 2026-06-03 Asia/Jerusalem: Checked official Codex and Claude skill docs enough to plan the packaging approach.
- [x] 2026-06-03 Asia/Jerusalem: Created this plan file.
- [x] Implement headless local CLI/API command surface.
- [x] Implement headless app route and `AppWorkspace` mode.
- [x] Implement worker/web build-preview command path.
- [x] Implement local-only `agents.json` approval and integration setup sync.
- [x] Build and validate the releaseable Codex plugin and Claude skill package.
- [x] 2026-06-03 Asia/Jerusalem: Added packaged CLI `headless` command family, repo `npm run headless` alias, local token-guarded web APIs, worker workspace/build-preview endpoints, headless app route, `AppWorkspace` headless mode, `headless_cli` approval source, Codex plugin skill, Claude skill, and CLI README docs.
- [ ] Update docs and QA artifacts.
- [ ] Run automated and manual validation.


## Surprises & Discoveries


- `npm run dev` is not a good public skill dependency because it starts MongoDB and Redis through Docker Compose. The packaged CLI is a better public base.
- The current app UI already has most headless pieces inside `AppWorkspace`: top bar, preview, app data bridge, integration bridge, app-agent bridge, and agent-run viewer. The missing piece is a route/mode that removes workspace sidebar and builder chat.
- The normal `/w/[workspaceId]` layout always renders `WorkspaceSidebar`, so a headless app route should live outside that layout tree.
- Current approval is both a UI pause and a security gate. Headless mode must replace the UI pause with a local command while preserving validation/hash/audit enforcement.
- Codex's official docs separate skill authoring from plugin distribution: skill for workflow, plugin for installable sharing. Claude supports project/personal/plugin-distributed skills with the same `SKILL.md` shape.


## Decision Log


- 2026-06-03, Codex: Use the packaged `npx --yes @second-inc/cli` as the public entry point instead of requiring users to clone Second. Rationale: the growth story needs one command and should avoid Docker/source setup.
- 2026-06-03, Codex: Implement headless as a first-class local mode over existing Second web/worker infrastructure, not a separate preview server. Rationale: this preserves app data, agents, integrations, governance, audit, and preview behavior.
- 2026-06-03, Codex: Create a route outside `/w/[workspaceId]/layout.tsx` for headless app viewing. Rationale: the normal layout owns the sidebar, and hiding it with CSS would keep unnecessary sidebar data loading on the hot path.
- 2026-06-03, Codex: Let the external agent edit the local app workspace directory and call a deterministic preview command. Rationale: this is the simplest way for the user's own Claude/Codex to build without talking to Second's builder chat.
- 2026-06-03, Codex: Preserve `agents.json` approval by local CLI/API auto-approval only under local `none` auth with a loopback token. Rationale: this removes the click for headless demos while preserving tenant/security invariants.
- 2026-06-03, Codex: Use a Codex plugin as the releaseable Codex distribution unit and keep a Claude-compatible `SKILL.md` package. Rationale: official Codex docs identify plugins as the installable unit for reusable skills, while Claude supports skills in `.claude/skills/` and plugins.


## Plan of Work


The implementation should build three layers.

Layer 1: Headless local control surface.

Add a `headless` command family to the local CLI payload. The command should start/reuse the packaged local runtime, create or reuse a local app, expose an editable app workspace path, and open/return the headless app URL. It should support JSON output because Claude/Codex should parse command results without scraping human terminal art.

Recommended commands:

    npx --yes @second-inc/cli headless start --json
    npx --yes @second-inc/cli headless start --name "Lead Triage" --json
    npx --yes @second-inc/cli headless status --app <appId> --json
    npx --yes @second-inc/cli headless preview --app <appId> --json
    npx --yes @second-inc/cli headless integrations --app <appId> --json
    npx --yes @second-inc/cli headless open --app <appId>

For source checkout development, add:

    npm run headless -- --json

This should use `.second-dev.txt` when a dev server exists and should start the dev server only when the implementer/test instructions explicitly allow it.

Layer 2: Headless web and worker APIs.

Add local-only write endpoints in the web app, guarded separately from normal browser routes. They should require all of:

- runtime config `authMode === "none"`
- `SECOND_HEADLESS_ENABLED=1` or a runtime flag set only by the headless CLI
- a bearer token from the local control/headless token file
- loopback origin or local control path where feasible

Do not make normal workspace routes accept local tokens unless the route is explicitly part of the headless API.

The web API should:

- ensure local user/workspace bootstrapping,
- create/reuse headless apps,
- return app metadata and app directory,
- call worker build-preview,
- persist the source/artifact snapshot,
- validate and approve `agents.json` locally when allowed,
- sync `integration-setup.json`,
- publish compact workspace events,
- record audit events.

The worker API should expose a build-preview operation that reuses the `done_building` implementation path. If `runner.ts` is too coupled to chat tools, extract a shared build module from `createDoneBuildingTool` so both the tool and the worker endpoint call the same code.

Layer 3: Headless UI route.

Create a headless app page outside the normal workspace layout, for example:

    apps/web/src/app/headless/w/[workspaceId]/apps/[appId]/page.tsx

This page should use the same auth/app-access loader as the normal app page. It should render `AppWorkspace` with `headlessMode`.

`AppWorkspace` in headless mode should:

- keep the top app bar,
- keep app title/status,
- keep preview/files/data tabs if they fit the top bar without clutter,
- keep app-agent runs affordance,
- keep compact integration setup affordance when setup is pending,
- keep `AppPreview`, `AppDataBridge`, `AppIntegrationBridge`, and `AppAgentBridge`,
- initialize `agentMode` as hidden,
- never render the builder chat panel,
- not render controls that reopen the builder chat,
- avoid mounting `AppChat` and `useChat` in headless mode,
- avoid starting or resuming builder chat streams in headless mode.

Performance safety checklist for this layer:

- Hot-path data shape: headless route should load only app metadata, latest run state if needed for top-bar status, source file metadata/files needed for preview, app runtime settings, teams/integrations only when the user can collaborate and the top bar needs them. It should not load sidebar app lists, members, review inbox, or full settings models.
- Read-vs-write behavior: headless page and file reads stay read-only. Preview/build/approval/setup sync are explicit POSTs from local commands.
- Realtime invalidation source: publish small events only after successful mutation. No source files or setup documents in realtime payloads.
- Duplicate-request prevention: preview command should be idempotent per app and serialize or reject concurrent builds clearly.
- Multi-tab/multi-user behavior: multiple browsers can view the headless app; app-agent runs keep existing attach/replay semantics. No builder chat POST should start from headless page mounts.
- Tenant isolation: even local headless routes must scope by workspaceId/appId and return 404 for cross-workspace/app mismatches.
- Validation: normal `/w/.../apps/...` and new `/headless/w/.../apps/...` should both be tested after changes.


## Phased Implementation Plan


### Phase 0 - Reconfirm public skill/package specs

Purpose:

Verify the current Codex and Claude skill/plugin install paths before implementing the release artifact.

Files and code areas touched:

- No code required unless docs have drifted enough to change this plan.
- Record any updated findings in this plan.

Implementation scope:

- Recheck official Codex skill/plugin docs.
- Recheck official Claude skill docs.
- Decide whether to use one source `SKILL.md` folder for both surfaces or separate packages with shared content.

Why this phase is ordered here:

Skill packaging is user-facing and has drift risk. Confirm it before creating file layout.

Verification:

- The plan's `Artifacts and Notes` links still match current docs.
- The chosen release folder structure matches current official docs.

Rollback/safety:

- If docs changed, update only the skill packaging section. The Second headless architecture can remain.


### Phase 1 - Add headless local CLI command shape

Purpose:

Create the deterministic command surface the external Claude/Codex skill will call.

Files and code areas touched:

- `packages/cli-local-darwin-arm64/bin/second-local.js`
- Possibly new helper modules under `packages/cli-local-darwin-arm64/bin/` or `packages/cli-local-darwin-arm64/lib/`
- `packages/cli/bin/second.js` only if command forwarding or help text needs updates
- `package.json` for source-checkout `npm run headless`
- Possibly `scripts/headless-dev.mjs` for repo development

Implementation scope:

- Add command parsing for `headless`.
- Keep `start`, `run`, `stop`, and `reset` behavior unchanged.
- Add JSON output support.
- Start/reuse the local packaged runtime.
- Read/write local headless state under `~/.second/headless.json` or in the existing runtime state, with app IDs and last app URL.
- Create or call local web API to ensure a headless app.
- Print app URL and appDir.

Why this phase is ordered here:

The skill needs a stable command contract. UI/API work can evolve behind it.

Verification:

- `npx --yes @second-inc/cli headless --help` shows headless commands.
- `npx --yes @second-inc/cli headless start --json` returns parseable JSON.
- Existing `npx --yes @second-inc/cli`, `stop`, and `reset` still work.

Rollback/safety:

- Keep command changes additive.
- If headless start fails, it should not delete existing local data.
- `reset` should remain the only data-deleting command.


### Phase 2 - Add local-only headless web API

Purpose:

Let the CLI safely create/reuse headless apps and drive local mutations without browser session scraping.

Files and code areas touched:

- New routes under a local namespace such as:
  - `apps/web/src/app/api/local/headless/apps/route.ts`
  - `apps/web/src/app/api/local/headless/apps/[appId]/preview/route.ts`
  - `apps/web/src/app/api/local/headless/apps/[appId]/integrations/route.ts`
  - `apps/web/src/app/api/local/headless/apps/[appId]/status/route.ts`
- `apps/web/src/lib/config.ts`
- `apps/web/src/lib/db/repositories/apps.ts`
- `apps/web/src/lib/db/repositories/agent-runs.ts`
- `apps/web/src/lib/audit/record.ts`
- New shared local-headless auth helper under `apps/web/src/lib/local-headless.ts`

Implementation scope:

- Add a local-headless request guard.
- Require local mode and a token.
- Ensure local default user/workspace exists or provide a deterministic setup path.
- Create/reuse app with `createAppForWorkspace`.
- Return headless route URLs, settings URLs, appDir, app status, and setup status.
- Record audit events for app creation and headless operations.

Why this phase is ordered here:

The CLI should not have to automate browser forms or depend on session cookies.

Verification:

- Direct requests without token fail closed.
- Requests with token in external auth mode fail closed.
- Requests with valid local token create/reuse only local workspace apps.
- Cross-app or invalid app IDs return 404.

Rollback/safety:

- Keep these routes under `/api/local/headless/*`.
- Do not alter normal `/api/workspaces/*` behavior in this phase.


### Phase 3 - Add worker build-preview endpoint and source persistence

Purpose:

Give external Claude/Codex the equivalent of the Second preview build tool without using the builder chat.

Files and code areas touched:

- `apps/worker/src/runner.ts`
- Possibly new `apps/worker/src/build-preview.ts`
- `apps/worker/src/index.ts`
- `apps/web/src/lib/worker-client.ts`
- `apps/web/src/app/api/local/headless/apps/[appId]/preview/route.ts`
- `apps/web/src/lib/db/repositories/app-source-snapshots.ts`
- `apps/web/src/lib/db/repositories/apps.ts`

Implementation scope:

- Extract the current `done_building` build logic into a shared worker function if needed.
- Add a worker route such as `POST /sessions/:appId/build-preview`.
- Ensure the worker uses the app's workspace directory and existing template/scaffold restore behavior.
- Run dependency install only when needed.
- Run typecheck/build with the same rules as `done_building`.
- Require `dist/index.html`.
- Collect bounded source snapshot including `dist/**`.
- Return structured success/failure.
- Web local preview route persists the snapshot and publishes compact invalidation events.

Why this phase is ordered here:

Preview is the core loop. The skill is useless if the external agent cannot deterministically rebuild and refresh the app.

Verification:

- Create a tiny app, edit `src/App.tsx`, run headless preview, and see the preview update.
- Break TypeScript or Vite build intentionally; preview command returns structured build/typecheck errors.
- Snapshot limits are enforced.
- Normal builder `done_building` still works.

Rollback/safety:

- Build-preview endpoint should be internal/local only, not public.
- Failed builds must not advance persisted preview snapshots.


### Phase 4 - Add headless route and `AppWorkspace` mode

Purpose:

Make the browser page match the product request: top bar plus app, no workspace sidebar, no builder chat.

Files and code areas touched:

- New route:
  - `apps/web/src/app/headless/w/[workspaceId]/apps/[appId]/page.tsx`
- Shared loader:
  - maybe `apps/web/src/app/w/[workspaceId]/apps/[appId]/load-app-page-data.ts`
- `apps/web/src/components/app-workspace.tsx`
- Possibly smaller top-bar child components if extraction becomes necessary

Implementation scope:

- Extract common server-side app page loading.
- Create headless page outside normal workspace layout.
- Add `headlessMode` prop to `AppWorkspace`.
- In headless mode, hide or do not mount builder chat.
- Keep app-agent/data/integration bridges.
- Keep compact top-bar controls required to inspect app status, agent runs, files/data if useful, and integration setup.

Why this phase is ordered here:

Once build-preview works, the visible headless app should be easy to verify.

Verification:

- Headless URL renders without `WorkspaceSidebar`.
- Normal `/w/.../apps/...` still renders with sidebar and builder chat.
- Headless route does not auto-send builder chat prompts.
- App preview updates after `headless preview`.
- App agents can run from the generated app.

Rollback/safety:

- Additive route. If headless UI has a bug, normal workspace route remains usable.


### Phase 5 - Local-only `agents.json` approval without UI click

Purpose:

Allow external Claude/Codex to create `agents.json` and have it "just work" in headless local mode without an Approve Agents card.

Files and code areas touched:

- `apps/web/src/lib/agents/agents-governance.ts`
- `apps/web/src/lib/db/repositories/apps.ts`
- `apps/web/src/app/api/local/headless/apps/[appId]/preview/route.ts`
- `apps/web/src/app/api/local/headless/apps/[appId]/agents/approval/route.ts` if separate endpoint is useful
- `apps/web/src/lib/db/types.ts` if a new `AgentsJsonApprovalSource` value is needed
- Audit event code

Implementation scope:

- On preview, if `agents.json` exists, parse and validate it with existing governance code.
- If valid and local-headless guard passes, approve the exact canonical payload/hash with approval source `headless_cli` or similar.
- If current approved hash already matches, do nothing.
- If invalid, return structured validation errors and do not approve.
- Preserve the existing distinction between live approval and mock-only approval. In local no-auth, the default user should be owner/admin, so live local approval is acceptable. In any non-local mode, deny auto-approval.
- Record audit event `app.agents_config.approved` with metadata showing `approvalSource: "headless_cli"`.

Why this phase is ordered here:

App-agent execution depends on approved runtime policy. This phase is the security-sensitive core.

Verification:

- Valid `agents.json` is approved by `headless preview`.
- Editing `agents.json` clears/stales the previous approval until preview revalidates/reapproves.
- Invalid `agents.json` produces errors and blocks live tools.
- Internal tool routes still reject unapproved or mismatched tools.
- Normal AgentsCard approval still works.

Rollback/safety:

- Do not auto-approve through normal browser routes.
- Do not auto-approve when `SECOND_AUTH_MODE !== "none"`.
- Do not skip canonical hashing.


### Phase 6 - Integration setup flow without chat

Purpose:

Let external Claude/Codex ask the user to connect integrations without relying on builder chat cards.

Files and code areas touched:

- `apps/web/src/app/api/local/headless/apps/[appId]/integrations/route.ts`
- Existing integration requirement validation/sync code, possibly extracted from `apps/worker/src/runner.ts` or web internal route
- `apps/web/src/app/w/[workspaceId]/settings/integrations/page.tsx`
- `apps/web/src/app/w/[workspaceId]/settings/integrations/integrations-client.tsx`
- `apps/web/src/components/app-workspace.tsx`

Implementation scope:

- When preview sees `integration-setup.json`, validate and sync it.
- Return a list of required integrations, configured status, exact setup/settings URLs, and a `returnTo` headless app URL.
- Add a headless top-bar button or status badge when setup is pending.
- Preserve app-scoped grants. A credential for another app must not satisfy this app.
- The generated app should still receive mock data when integrations are not configured, according to existing custom tool behavior.

Why this phase is ordered here:

Agents and app actions can work with mock data before real setup, but the public skill needs a sane way to instruct the user to connect real providers.

Verification:

- Create `integration-setup.json`, run preview, and confirm requirements appear in settings.
- `headless integrations --app <appId> --json` returns setup URLs.
- After configuring a test static credential, the status changes to configured.
- Custom tool execution uses the app-scoped grant only.

Rollback/safety:

- Do not expose secret values to CLI output.
- CLI output may include provider names, domains, required secret names, permission labels, and URLs, but not token material or Vault IDs.


### Phase 7 - Build the public skill/plugin

Purpose:

Create the release artifact that teaches Claude/Codex how to use headless Second.

Files and code areas touched:

- Recommended Codex plugin:
  - `.agents/plugins/second-headless-app-builder/.codex-plugin/plugin.json`
  - `.agents/plugins/second-headless-app-builder/skills/second-app-builder/SKILL.md`
  - `.agents/plugins/second-headless-app-builder/skills/second-app-builder/scripts/`
  - `.agents/plugins/marketplace.json`
- Claude-compatible skill package:
  - either `.claude/skills/second-app-builder/SKILL.md` for repo testing
  - or generated release package/zip from the same source skill
- Optional shared source package:
  - `packages/skills/second-app-builder/SKILL.md`

Implementation scope:

- Write concise `SKILL.md` frontmatter with a strong description. The description should trigger on "build a Second app", "visual GUI around a task", "headless Second", "app agents", and "local Second app".
- In the body, instruct the external agent to:
  - start headless Second,
  - parse JSON output,
  - edit only the returned `appDir`,
  - use the template and `src/lib/second-sdk.ts`,
  - create `agents.json` when app agents or app-callable tools are needed,
  - create `integration-setup.json` only when setup is needed,
  - call headless preview after meaningful edits,
  - report setup URLs to the user,
  - never ask the user to click Approve Agents in local headless mode,
  - recover from build errors by editing files and rerunning preview.
- Include optional scripts only when they add deterministic value, for example a wrapper script that runs the headless CLI and validates JSON. Do not include bulky docs.
- Add Codex `agents/openai.yaml` metadata if using a skill folder per Codex conventions.
- Add plugin manifest if distributing through Codex plugin.

Why this phase is ordered here:

The skill should describe the real command/API contract after it exists, not a hypothetical one.

Verification:

- In Codex, install from local marketplace and ask for a tiny app.
- In Claude Code, install/copy skill and ask for a tiny app.
- Confirm both agents run headless commands, edit `appDir`, run preview, and return the app URL.

Rollback/safety:

- Keep the skill instructions bounded. Do not tell agents to edit `~/.second/secrets`, runtime state, or app infrastructure files.
- Avoid putting secrets, tokens, or local user paths into the skill package.


### Phase 8 - Docs, QA, and release readiness

Purpose:

Make the feature explainable, testable, and safe to publish.

Files and code areas touched:

- `docs/` page updates or a new focused docs page if warranted
- `packages/cli/README.md`
- `README.md` if the public quickstart should mention headless
- `QA/YYYY-MM-DD-headless-second-skill-qa.md`
- Automated tests around local-headless guard, build-preview, approval, integration sync, and UI mode

Implementation scope:

- Add docs for user flow and limitations.
- Add implementation docs only where necessary.
- Add a QA guide with exact local commands and expected observations.
- Run automated tests.
- Run in-app browser QA only when explicitly requested/allowed by the human.

Why this phase is ordered here:

Docs and QA should reflect the final command names and behavior.

Verification:

- A fresh user can follow docs to run headless and build a tiny app.
- QA file records URL, app ID, run/build IDs if any, model used, audit events, and bugs.
- Normal Second E2E smoke still passes.

Rollback/safety:

- If release is not ready, docs should clearly mark headless as experimental or local-only.


## Concrete Steps and Commands


Commands below are implementation/validation commands for future sessions. Do not run dev servers or Docker unless the user explicitly asks for QA or implementation with validation.

Inspect current local runtime state:

    pwd
    cat .second-dev.txt 2>/dev/null || true
    cat ~/.second/runtime.json 2>/dev/null || true

Run source checks after implementation:

    npm run typecheck
    npm --prefix apps/web run typecheck
    npm --prefix apps/worker run typecheck
    npm --prefix packages/cli run build

Expected public headless commands after implementation:

    npx --yes @second-inc/cli headless start --json
    npx --yes @second-inc/cli headless preview --app <appId> --json
    npx --yes @second-inc/cli headless integrations --app <appId> --json
    npx --yes @second-inc/cli headless open --app <appId>

Expected source-checkout development command after implementation:

    npm run headless -- --json

Example successful `headless start --json` output:

    {
      "ok": true,
      "workspaceId": "local-workspace-id",
      "appId": "app-id",
      "appDir": "/Users/name/.second/data/workspaces/app-id",
      "appUrl": "http://localhost:3030/headless/w/local-workspace-id/apps/app-id",
      "runtimeUrl": "http://localhost:3030",
      "status": "ready"
    }

Example successful `headless preview --json` output:

    {
      "ok": true,
      "appId": "app-id",
      "built": true,
      "sourceFileCount": 24,
      "agentsJson": {
        "present": true,
        "approved": true,
        "approvalSource": "headless_cli",
        "hash": "v1:..."
      },
      "integrations": {
        "needsSetup": true,
        "url": "http://localhost:3030/w/.../settings/integrations?appId=..."
      },
      "appUrl": "http://localhost:3030/headless/w/.../apps/..."
    }

Example failure output:

    {
      "ok": false,
      "error": "build_failed",
      "message": "Build failed - fix these errors then run preview again.",
      "typecheck": "...",
      "build": "..."
    }


## Validation and Acceptance


Automated validation:

- Unit tests for local-headless guard:
  - denies missing token,
  - denies external auth mode,
  - denies cross-workspace/app mismatch,
  - allows local no-auth with valid token.
- Unit/integration tests for build-preview:
  - success with template app,
  - typecheck failure,
  - missing `dist/index.html`,
  - snapshot size guard.
- Tests for `agents.json` approval:
  - valid payload approved with `headless_cli`,
  - invalid payload rejected,
  - changed payload invalidates/replaces previous hash,
  - internal tool execution still checks approved hash.
- Tests for integration setup sync:
  - valid `integration-setup.json` syncs requirements,
  - invalid JSON does not sync,
  - CLI output excludes secret values.
- Component or E2E tests for headless UI mode:
  - no sidebar,
  - no builder chat,
  - top bar remains,
  - preview iframe renders,
  - app-agent bridge remains available.

Manual acceptance:

- Fresh packaged CLI run opens a headless app URL.
- External agent can edit returned `appDir` and call preview.
- Browser updates to show the generated app.
- A generated app with `agents.json` can run an internal app agent without an Approve Agents click in local headless mode.
- A generated app with integration setup returns a settings URL and does not expose secrets.
- Normal Second app route still has sidebar and builder chat.
- Normal builder chat `done_building` still builds and persists preview.
- Normal `present_agents` approval still requires UI action outside headless local auto-approval.

Security acceptance:

- No headless auto-approval in `SECOND_AUTH_MODE=external`.
- No headless write route is reachable without local token.
- No source files, prompts, secrets, tokens, cookies, headers, or full DB documents in realtime events.
- Worker still scrubs infrastructure secrets from runtime environments.
- Tool execution still uses `/api/internal/tool-execute` and approved `agents.json`.
- OAuth tools still resolve triggering user from trusted server-side run/viewer state, not model input.

Performance/realtime acceptance:

- Headless route does not load workspace sidebar app list, members, invitations, or review inbox.
- Headless route does not mount builder `AppChat`.
- Headless preview command does not create duplicate builder runs.
- Multiple browser tabs can view the same headless app without starting duplicate streams.
- App-agent runs still use existing background execution and stream/replay behavior.


## Idempotence and Recovery


- `headless start` should be safe to run repeatedly. It should return the existing runtime/app unless the caller requests a new app.
- `headless preview` should be safe to run repeatedly after no file changes. It should rebuild and persist the same effective snapshot/hash or no-op where possible.
- Concurrent `headless preview` calls for the same app should serialize or fail with a clear "build already running" error.
- If preview build fails, keep the last good persisted snapshot visible.
- If local runtime is already running on another port, the command should return that runtime's URL instead of starting another copy.
- If local state is corrupt, provide a non-destructive diagnostic first. Data deletion remains behind `npx --yes @second-inc/cli reset`.
- If `agents.json` is invalid, return validation errors and do not approve; the external agent should fix the file and rerun preview.
- If `integration-setup.json` is invalid, return setup validation errors and do not overwrite the last good setup metadata unless the new file validates.
- If appDir is missing, the CLI/web API should ask the worker to restore/scaffold from Mongo snapshot or template.


## Interfaces and Dependencies


New or changed interfaces:

- CLI command:
  - `second headless start`
  - `second headless status`
  - `second headless preview`
  - `second headless integrations`
  - `second headless open`

- Local web API:
  - `POST /api/local/headless/apps`
  - `GET /api/local/headless/apps/[appId]`
  - `POST /api/local/headless/apps/[appId]/preview`
  - `POST /api/local/headless/apps/[appId]/agents/approval` if not folded into preview
  - `POST /api/local/headless/apps/[appId]/integrations` if not folded into preview

- Worker API:
  - `POST /sessions/:appId/build-preview` or similar internal endpoint.

- UI route:
  - `/headless/w/[workspaceId]/apps/[appId]`

- React component prop:
  - `AppWorkspace({ headlessMode?: boolean })`

- Approval source:
  - Add `headless_cli` to `AgentsJsonApprovalSource` only if the existing type requires a new explicit value.

- Skill/plugin package:
  - Codex plugin manifest `.codex-plugin/plugin.json`
  - `skills/second-app-builder/SKILL.md`
  - optional `skills/second-app-builder/scripts/*`
  - optional `agents/openai.yaml`

Dependencies:

- Existing local CLI packaging and platform support.
- Existing worker workspace path convention.
- Existing Vite template and `second-sdk`.
- Existing app source snapshots.
- Existing `agents.json` governance functions.
- Existing integration grant/credential/OAuth architecture.
- Existing app-agent run manager and bridges.


## Artifacts and Notes


Official external docs checked during planning:

- OpenAI Codex Agent Skills docs: https://developers.openai.com/codex/skills
  - Relevant current points: skills are directories with `SKILL.md`; `name` and `description` are required; optional scripts/references/assets are supported; reusable skills should be packaged as plugins.
- OpenAI Codex plugin build docs: https://developers.openai.com/codex/plugins/build
  - Relevant current points: plugins need `.codex-plugin/plugin.json`; a plugin can package a skill; marketplace files can expose plugins for install.
- Claude Code Skills docs: https://code.claude.com/docs/en/skills
  - Relevant current points: project skills can live under `.claude/skills/`; plugins can include `skills/`; skills can bundle scripts.
- Claude Code SDK Skills docs: https://code.claude.com/docs/en/agent-sdk/skills
  - Relevant current point: `allowed-tools` frontmatter is CLI-specific; SDK apps should control tools through SDK options.

Minimal skill body outline:

    ---
    name: second-app-builder
    description: Build and iterate local Second headless apps from Claude/Codex. Use when the user wants a visual GUI, local Second app, app agents, agents.json, integration setup, or a headless Second preview around a task.
    ---

    # Second App Builder

    Use Second as the local visual app runtime while the user talks to you, their own agent.

    1. Start or reuse headless Second with `npx --yes @second-inc/cli headless start --json`.
    2. Parse `appDir` and `appUrl`.
    3. Edit only files under `appDir`.
    4. Use `src/lib/second-sdk.ts` for app data, agents, and integration tools.
    5. If app agents or backend actions are needed, write `agents.json`.
    6. If provider setup is needed, write `integration-setup.json`.
    7. After meaningful edits, run `npx --yes @second-inc/cli headless preview --app <appId> --json`.
    8. Fix build errors and rerun preview.
    9. If preview output includes setup URLs, give them to the user.
    10. Return the final app URL.

Potential route/API naming alternatives:

- `/headless/w/[workspaceId]/apps/[appId]`
- `/local/apps/[appId]`
- `/h/[workspaceId]/[appId]`

Recommended: `/headless/w/[workspaceId]/apps/[appId]` because it is explicit and preserves workspace/app identity in the URL.


## Outcomes & Retrospective


Not implemented yet. This plan establishes the recommended architecture and implementation phases.

Expected retrospective questions after implementation:

- Did the external agent loop feel deterministic, or did it still need browser/UI automation?
- Did hiding builder chat materially reduce request load and UI complexity?
- Did local auto-approval preserve the same effective tool/data/integration restrictions?
- Did the skill wording reliably trigger in Codex and Claude without over-triggering on unrelated app-building tasks?
- Did integration setup feel clear when there is no builder chat card?


## Change Notes


- 2026-06-03 Asia/Jerusalem: Initial plan created from repo docs, current code inspection, and current public skill/plugin docs.


## Captured User Intent (Verbatim)


Codex- great idea for growth!!!!!!!!!!!!!!!
I would like To create a skill for Claude or Codex to build apps in Second - But it's not what you think. I need to release this skill. This skill will literally allow them to build apps and run them locally but it should be this sort of headless second where they don't have the sidebar and they don't have everything, just pure local, you know. What this means is that we need to support a version of Second which will be "headless" - In other words it just means it would clone 2nd probably and we'll run it in headless mode. Probably there will be this `npm run headless` or something, I don't know, and it should extract in the skill about everything, like the command to clone it or to maybe install it. I have no idea.

The thing is that I want to tweet that I gave Claude skill or Codex a skill to build apps, a visual GUI around the task you're trying to do so it can run multiple of itself inside of it. We use the exact same infrastructure in Second and just will build an app for it and then we'll just run it. The cool thing is that the users will talk with their Claude not with the Claude or Codex that is within Second. And so I hope that you understand what I'm saying when I mean that they will talk with their own Claude, okay and this Claude, again, our Codex CLI does it better. It will run the new command, which is `npm run headless` or something, whatever, and it just has no sidebar and no app, like the builder chat from the right, okay. All there is is the app that they see.

The thing is that their Claude or Codex CLI should eventually, if they change the files of the app or do the agents.json thing, also click on or call the preview app tool. I don't even know how this will work but you need to find the most simple straightforward way to make this work.

Another thing that I'm thinking of while I'm telling you to do this is that I want to make it just work so that when the agents are doing this, for example they create an agents.json or something, whatever, then I want it to just work so that the user won't need to click on Approve Agents, because it's headless mode. The up top bar in that headless mode should remain, okay, that's very important.

Also we need to think about integrations. When I say integrations I mean let's say they need to connect something so I think that they will see this button to connect integrations or something from the chat. They will just click on it, they will be redirected to their integrations page thingy, and they will do it and then we'll go back. I guess this is okay but the problem is that they don't have the chat, right, because this is what we said that we don't have the chat. I'm not exactly sure how this will work. Maybe Claude or Codex CLI should tell the users, "Okay click on this URL now and this URL to connect your integrations," or something like that.

First of all before you even begin I want you to create a full plan on how to implement this thing. One of the requirements for me in this plan thing is a diagram of how this will work, whether it's a diagram in ASCII or whatever may have made, but I want to understand the architecture and how we approach this. Again the goal is to just publish a skill that, yes obviously it will use Second end-to-end, but just to allow people to use Second from their own Codex or their own Claude CLI.
