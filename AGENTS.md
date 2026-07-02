# Second
Second is a generative workspace, which allows teams to build internal tools.

This is a monorepo containing everything.

# Layout
- apps/web: nextjs + shadcn

# General instructions (not necessarlly task dependent)

For big tasks (or whenever you feel like it), please first of all read the docs/ to understand about this project. Read them also to orient yourself in this project, find relevant files, understand the overall architecture and the code base. Obviously they might be outdated so the code is the real truth eventually.

In this repo, identify key files, the architecture, what this project is about, and how everything works (in they way which is relevant for this task) using the docs/.

Remember that we have currently 2 deployment models:
1. Local, using `npx @second-inc/cli ...`
2. On prem - on GCP (AWS is also not currently supported but it will and should be sometime). On prem can be either on the customer's cloud OR a managed instance - where I deploy it on Second's cloud and help them register the Auth provider, etc.

We are now in the open source repo. You should probably only work on the open source repo (this was just context for you).

Also important: Whatever you do, it's very important that this will be enforced securely and beautifully and will actually work and will not have any security issues. Also keep in mind tenant isolation (critical). I mean I know that right now we haven't released our SAAS solution yet, but still it's very important. Keep all of the best practices from the docs and the current structure.

It's also very important to keep everything very secure and go with the security best practices and everything that we currently have set up and fixed to not regress and to not introduce any security issues.

# About app UI changes
- Before changing app UI, inspect strong local references such as `apps/web/src/components/ai-elements/tool-card.tsx`, `apps/web/src/components/ai-elements/agents-card.tsx`, `apps/web/src/app/w/[workspaceId]/apps/[appId]/agents/page.tsx`, and `apps/web/src/app/w/[workspaceId]/settings/integrations/page.tsx`.
- Match the existing restrained shadcn/Radix theme: compact rows, muted borders, mono metadata, semantic badges, and polished tool-call / agent-card patterns.

# About local browser testing
- Do not assume the app is on `localhost:3000`. `npm run dev` generates `.second-dev.txt` in the repo root; read its `url=` value before opening the app or telling a browser/agent what to visit. The file is local-only and gitignored.
- `npm run dev` is worktree-aware: it automatically chooses a per-worktree dev ID, Compose project name, and non-conflicting ports. Multiple worktrees can run at once, and each active worktree has its own MongoDB and Redis containers.
- If the human requests browser QA, that request grants permission to run `npm run dev` for the current worktree when no matching dev server is already running. Start it only as needed for QA, then use `.second-dev.txt` as the source of truth for the URL.
- When using the in-app browser for QA, show the browser to the human unless they explicitly ask to keep it hidden.
- If onboarding or sign-in needs QA identity details and the user did not specify them, use email `john@doe.com`, display name `John Doe`, role `Founder`, and workspace name `Second`.
- When testing app-building flows, keep prompts intentionally tiny so runs finish quickly: ask for a tiny to-do list with minimal UI and no agents.
- Unless explicitly requested, send the message and verify the response starts successfully, but do not approve or complete the build.

# About local runtime detection
- Do not duplicate local-vs-cloud checks with ad hoc combinations of `SECOND_LOCAL_INSTALL`, `SECOND_AUTH_MODE`, or `readRuntimeConfig().authMode`. Use the shared helpers in `apps/web/src/lib/source-control/runtime.ts`, especially `sourceControlRuntimeLabel()` and `canShowLocalSourceControlFeatures()`, so Source Control settings, Available Apps, app-level publish controls, pages, and APIs agree on what "local" means.
- If a local-only feature appears in one surface but not another, inspect and fix the shared helper first instead of adding a component-local workaround.

# When making changes that are directly related to the desktop app:
- If the bug only appears in the packaged desktop app but not in `npx --yes @second-inc/cli` or browser localhost, first suspect desktop runtime environment differences such as PATH, app sandbox/signing, packaged resources, or lifecycle.
- For macOS provider subprocess bugs, remember Finder-launched apps do not inherit the user's terminal PATH; resolve CLI tools through the login shell or common install paths before changing provider logic.
- Do the smallest source fix plus quick validation, then hand the exact local build command to the human for manual app testing when they are actively testing the DMG/app.
- Do not keep running long DMG/notarization/build-test loops unless explicitly asked; stop once the code is ready for the requested manual test.
- If the human asks you to build it yourself then run, install and test it, run the following command: `cd /Users/omervexler/.codex/worktrees/<current-worktree>/second && npm --prefix packages/cli ci && npm --prefix apps/desktop ci && npm --prefix packages/cli-local-darwin-arm64 run build && SECOND_DESKTOP_SKIP_NOTARIZE=1 npm --prefix apps/desktop run make -- --mac dmg --arm64 --publish never` . The DMG will then be here: "/Users/omervexler/.codex/worktrees/<current-worktree>/second/apps/desktop/release/Second-0.2.0-mac-arm64.dmg"

# About QA guides
- For broad manual QA, use the `QA/` folder. Keep a reusable date-prefixed E2E guide such as `QA/YYYY-MM-DD-E2E.md`, and create a separate date-prefixed task guide such as `QA/YYYY-MM-DD-<feature-or-merge>-qa.md` for the current feature, branch, or merge.
- When a user asks for both a general E2E pass and a feature-specific QA pass, run the general E2E guide first, then the feature-specific guide, and record results in the feature-specific QA file.
- Only run QA when the user explicitly asks you to run QA, test, verify, or manually check the product. Creating or updating QA documents is not permission to execute them.
- If the user asks to create the QA docs before running tests, stop after writing the docs so they can review them.
- QA result files should mark each area as pass/fail/blocked, include concrete evidence such as URLs, app IDs, run IDs, model used, and audit event names, and list bugs separately with repro, expected behavior, observed behavior, impact, and status.
- Respect the local testing constraints above: use the in-app browser, do not start the dev server unless the user explicitly allows it, and do not run containers or infrastructure commands.

# No human in the loop mode
- When the human says something like "just do it e2e and open a pr", "do it without me in the loop", or "do it e2e", treat that as permission to complete the whole loop without stopping for routine review.
- In this mode, perform the task, create a plan first if the work is large or risky, run the relevant automated checks, run in-app browser QA, write a QA document, and iterate until the implementation and QA are clean.
- After QA passes, create or switch to the branch before staging and committing. If changes already exist, keep them in the worktree, create the branch, then `git add -A`, commit, push, and open the PR.
- Sometimes the human will ask for the same end-to-end flow but explicitly say not to open the PR yet; that is valid, so stop after the requested final step instead of creating the PR.
- Only stop to ask the human if there is a real blocker, a destructive/external action not covered by the request, or an ambiguity that would make the work unsafe.

# Performance and realtime safety
- Treat fast navigation and collaborative streaming as core product requirements, not polish. Features must preserve quick workspace navigation, app/chat back-and-forth, multi-tab use, and multiple users watching the same run.
- Before changing navigation, app metadata, settings, chat, runs, sidebar, integrations, members, teams, or app source persistence, read the relevant docs: `docs/architecture.mdx`, `docs/streaming.mdx`, `docs/guard-and-tenancy.mdx`, `docs/app-preview.mdx`, and `docs/self-hosting.mdx`.
- Do not put large source maps, prompts, files, secrets, or full documents on hot metadata paths. App lists, sidebar, access checks, settings shells, and navigation should use compact/projected read models. Source files belong behind explicit source/snapshot loaders.
- GET/read paths must stay read-only. Do not "repair", "ensure", upsert, or publish invalidation events from a read route unless the route is explicitly designed and documented as a mutation.
- Workspace realtime events are invalidation hints, not data and not authorization. Publish small scoped events only after a successful real mutation. Never include source, prompts, secrets, tokens, cookies, headers, or full DB documents in events.
- Avoid refetch storms. A normal click must not fan out into repeated Members/Teams/Invitations/Integrations requests. Use the existing workspace realtime provider, projected settings read models, and scoped request dedupe patterns instead of adding component-local polling or new EventSource subscriptions.
- Keep workspace chrome realtime separate from run-level chat streaming. Chat/run streaming needs ordered attach/replay semantics; sidebar/settings/app chrome only need compact invalidation/status updates.
- Do not abort the authoritative chat POST on route unmount. Navigating away may close observers, but the running POST must be allowed to finish so messages persist and the active stream clears. Reconnecting clients should attach through the stream/replay path.
- When diagnosing deployed slowness, use `SECOND_PERF_TRACE=1` temporarily and follow `docs/deployed-slowness-playbook.mdx`. Correlate request IDs with pod logs/metrics and check request amplification, health probe failures, CPU throttling, memory pressure, Redis/Mongo latency, and external auth latency before guessing.
- For any plan or implementation touching these areas, include a performance safety checklist: hot-path data shape, read-vs-write behavior, realtime invalidation source, duplicate-request prevention, multi-tab/multi-user streaming behavior, tenant isolation, and how to validate in staging.
- Do not assume Kubernetes/GKE automatically scales the app. Node autoscaling is not pod autoscaling. If capacity matters, inspect replicas/resources/HPA behavior and document what will or will not scale.

# About Sentry access
- If a task needs the Sentry API and `SENTRY_AUTH_TOKEN` is missing from the current shell, source `~/.zshrc` and check again. Do not print the token or ask the human to paste it into chat.

# Forbidden actions:
- You are not allowed to run git commands unless the human explicitly asks for git/PR work or no-human-in-the-loop mode.
- You are not allowed to actually run containers / terraform etc. (but can run command to validate)
- You are not allowed to run the dev server unless the human explicitly allows it or asks for browser QA as described above. It's probably already running.

# When I ask you to security review
Read the docs/ to understand the overall structure and about this repo if you haven't yet.
You need to verify / decline that the changes did not hurt tenant isolation / security?

# About updating docs
When asked to update the docs in docs/:
- It's really imporatnt that you will keep the same tone and style of the documentation.
- You need to decide where it's time to update an existing doc, and when it's time to create a new one (if even needed). No problem to include some new details about security btw. It's important. Use your judement in regards on
what to include and what not.

# About Plans

For complex features, significant refactors, or detail-heavy requests, create a plan before implementing.

When asked to plan:
- Do not code
- Create a new Markdown file in `./plans/<descriptive-name>.md`
- Follow `PLANS.md` (!)
