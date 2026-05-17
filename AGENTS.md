# Second

Second is a generative workspace for internal tools. The repository is a
monorepo containing the web app, worker, local CLI, documentation, and release
automation.

## Layout

- `apps/web`: Next.js app using shadcn/Radix UI.
- `apps/worker`: worker service for agent sessions, runtime adapters, and tool
  execution.
- `packages/cli`: user-facing `@second-inc/cli` launcher.
- `packages/cli-local-darwin-arm64`: local Apple Silicon payload package.
- `docs`: Mintlify documentation.
- `plans`: active implementation plans that are intentionally kept in the repo.

## Project Context

Second currently supports two deployment models:

1. Local development and local single-machine usage through
   `npx --yes @second-inc/cli`.
2. Self-hosted or managed deployments on customer infrastructure, currently
   oriented around GCP/Kubernetes. AWS support is not implemented yet.

The code is the source of truth. Use the docs to orient yourself, but verify
behavior in the implementation before changing shared contracts.

## Security And Tenancy

- Treat tenant isolation as a core invariant. Data access must stay scoped by
  `workspaceId` and, where relevant, `appId`, user membership, app access, and
  integration grants.
- Preserve the distinction between browser-authenticated routes and internal
  web/worker routes. Production internal routes must fail closed when
  `INTERNAL_API_TOKEN` is missing or invalid.
- Do not expose secrets, provider tokens, cookies, private URLs, full prompts,
  source snapshots, or large documents on hot metadata paths or realtime events.
- Workspace realtime events are invalidation hints, not authorization or data.
  Keep payloads compact and publish them only after successful mutations.
- GET/read paths must stay read-only. Do not repair, upsert, or publish
  invalidation events from read routes unless the route is explicitly designed
  as a mutation.

Before changing navigation, app metadata, settings, chat, runs, sidebar,
integrations, members, teams, or app source persistence, read the relevant docs:
`docs/architecture.mdx`, `docs/streaming.mdx`,
`docs/guard-and-tenancy.mdx`, `docs/app-preview.mdx`, and
`docs/self-hosting.mdx`.

For changes in those areas, include a performance and security checklist:
hot-path data shape, read-vs-write behavior, realtime invalidation source,
duplicate-request prevention, multi-tab/multi-user streaming behavior, tenant
isolation, and staging validation.

## UI Changes

- Match the existing restrained shadcn/Radix style: compact rows, muted borders,
  mono metadata, semantic badges, and polished tool-call / agent-card patterns.
- Before changing app UI, inspect strong local references such as
  `apps/web/src/components/ai-elements/tool-card.tsx`,
  `apps/web/src/components/ai-elements/agents-card.tsx`,
  `apps/web/src/app/w/[workspaceId]/apps/[appId]/agents/page.tsx`, and
  `apps/web/src/app/w/[workspaceId]/settings/integrations/page.tsx`.

## Local Testing

- Do not assume the app is on `localhost:3000`. `npm run dev` writes
  `.second-dev.txt` in the repo root; use its `url=` value when opening the app.
- `npm run dev` is worktree-aware and chooses isolated ports, Compose project
  names, MongoDB, and Redis containers per worktree.
- Do not start the dev server, containers, Docker Compose, or infrastructure
  commands unless the task explicitly requires local QA or runtime validation.
- If onboarding or sign-in needs test identity details, use
  `john@doe.com`, display name `John Doe`, role `Founder`, and workspace
  name `Second`.
- When testing app-building flows, keep prompts intentionally small and stop
  before approving or completing long builds unless the task explicitly asks for
  end-to-end QA.

## Quality Checks

Use the smallest validation surface that covers the change. Common checks:

```bash
npm run typecheck
npm --prefix apps/web run lint
npm --prefix apps/web run build
npm --prefix apps/worker run typecheck
npm --prefix packages/cli run build
```

For docs changes:

```bash
cd docs
mint validate
```

## QA Guides

- Only run broad manual QA when explicitly asked.
- For broad manual QA, keep reusable guides in `QA/` if that directory is
  intentionally created for the task.
- QA result files should record pass/fail/blocked status, concrete evidence,
  bugs, repro steps, expected behavior, observed behavior, impact, and status.

## Plans

For complex features, significant refactors, or detail-heavy requests, create a
plan before implementing. When explicitly asked to plan, do not code; create a
Markdown file in `plans/` and follow `PLANS.md`.
