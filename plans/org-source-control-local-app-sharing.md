# Implement Source-Control-Backed Local App Sharing

This is a living document. Keep it aligned with the root `PLANS.md` instructions in this repository as implementation proceeds. Update `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Change Notes` whenever the plan changes or new evidence appears.

## Overall Goal

Allow organizations to run Second locally on each user's device, through either the CLI local runtime or the desktop app, while sharing applications through organization source control instead of ad hoc ZIP handoff. GitHub is the first supported provider, but the implementation must use provider boundaries that make GitLab, Bitbucket, or self-hosted providers possible later.

The central product model is:

- Each user's local Second runtime remains local and fast.
- Source control becomes the shared organization state and distribution log for apps.
- When source control is enabled, GitHub is the source of truth and MongoDB is a local/runtime cache for fast rendering.
- App source and built artifacts can be restored or distributed from GitHub at explicit synchronization boundaries.

## Goal Description / Sub-goals

1. Add workspace-level Source Control settings under `/w/<workspace-slug>/settings/source-control`.
2. Support GitHub connection first, using a PAT for local CLI/desktop and for the first cloud/on-prem version.
3. Store credentials securely through the existing WorkOS Vault or encrypted local secret-store pattern.
4. Preserve provider-agnostic interfaces so future GitLab and Bitbucket support do not require rewriting app lifecycle code.
5. Add an app-level "Publish to source control" control for local apps.
   - Connecting workspace source control only enables the feature.
   - It must not upload existing apps automatically.
   - It must not upload new apps automatically.
   - A specific app syncs to GitHub only after the user turns on publishing for that app.
6. After every successful `done_building`, sync to source control only if that specific app has "Publish to source control" enabled:
   - create a repository when the app has no linked repo,
   - commit the current app snapshot,
   - push the commit,
   - create a version tag,
   - use the `done_building.summary` as the tag description.
7. Keep the agent/tool experience transparent. The `done_building` tool stays conceptually unchanged; source-control synchronization runs after the successful build snapshot is persisted and only for opted-in apps.
8. Add a local-only "Available Apps" workspace page after "New app", "Agents", and "Library".
9. Let local users browse organization apps from GitHub and click "Get" or "Update" to import/update a local app.
10. For cloud/on-prem deployments, allow source control to initialize worker/container source when needed, without making every app view depend on GitHub.
11. Maintain tenant isolation, compact hot-path data, fast navigation, and realtime safety.

## Motivation

Today Second can export and import app ZIP files, which is enough for manual sharing. It is not enough for an organization where every user runs Second locally, because there is no shared database or central published app state across devices.

Organizations already use source control as the durable shared system for source, history, ownership, and review. Making GitHub the shared state for local Second apps gives teams:

- auditable app history,
- repeatable distribution,
- versioned updates,
- owner/org permissions from GitHub,
- a natural path to move source out of MongoDB over time,
- a better enterprise story for local-first usage.

The runtime must still feel like Second. App navigation and preview should not turn into GitHub fetches on normal page loads.

## State Before

The current system has these relevant behaviors:

- App source and built preview artifacts are persisted in MongoDB `app_source_snapshots`.
- `saveAppSourceFiles` stores the draft source snapshot and updates compact app metadata.
- The preview renders from `dist/index.html` inside the persisted snapshot, or from live worker files while a session is active.
- The worker calls `done_building`, validates files, installs dependencies if needed, runs typecheck/build, requires `dist/index.html`, and returns a successful structured payload with `summary`.
- The chat route detects successful `done_building`, fetches worker files, saves them through `saveAppSourceFiles`, and records audit events.
- App export creates a Second app ZIP from persisted and live source files.
- App import parses the ZIP, creates a local app, saves source files, syncs `integration-setup.json`, may approve `agents.json`, creates a completed builder run, and records audit.
- Local CLI and desktop runtimes set local-mode environment such as `SECOND_AUTH_MODE=none` and `SECOND_LOCAL_INSTALL=1`.
- There is no workspace-level source-control connection, no GitHub provider, no automatic repository creation after builds, and no local "Available Apps" catalog.

## State After

After implementation:

- A workspace owner/admin can configure Source Control from settings.
- GitHub is enabled. GitLab and Bitbucket cards are visible but disabled/enterprise-only.
- Local mode uses a GitHub PAT entered by the user.
- Cloud/on-prem mode initially also supports PAT, but the UI clearly shows that GitHub OAuth app support is coming soon.
- Secrets are stored only through WorkOS Vault or encrypted local storage. PATs are never returned to the browser, worker, agent, events, logs, or audit metadata.
- A new provider abstraction owns all GitHub-specific operations.
- Existing apps and new apps remain Mongo-only until that specific app is published to source control.
- In local CLI/desktop mode, if workspace source control is connected, the app top bar exposes a "Publish to source control" toggle/action.
- The first time the user turns publishing on for an app, Second adopts the current app state into GitHub: create repo if needed, commit the current snapshot, write `second-app.json`, label/tag it as a Second app, and create `second-app-v1`.
- After an app is published to source control, successful future `done_building` calls sync that app to GitHub after the local source snapshot has been saved.
- Each opted-in sync commits a sanitized app snapshot and creates a new `second-app-v<N>` tag.
- The root repo contains a `second-app.json` manifest so the repo/archive is self-describing and compatible with the existing bundle/import model after archive normalization.
- Compact source-control metadata lives on the app document and in a source-control connection collection; full source still lives in snapshots and GitHub, not in app list/sidebar payloads.
- Local CLI/desktop users see "Available Apps" in the workspace sidebar.
- The Available Apps page lists apps discoverable from the configured GitHub owner/org and lets users Get or Update an app into their local Second runtime.
- Cloud/on-prem workers initialize restored app source from GitHub when source control is enabled, while normal app page rendering uses a materialized cached built artifact for the selected GitHub version.

## Context and Orientation

Second is a monorepo. The relevant app is `apps/web`, a Next.js application with shadcn/Radix UI patterns, plus `apps/worker`, which runs agent sessions and builds app previews.

Important architectural constraints from the docs:

- Workspaces are the security boundary.
- Every request must resolve and enforce workspace context.
- Hot metadata paths must stay compact.
- Source files, prompts, secrets, full documents, and large artifacts must not travel through sidebar/app-list/realtime payloads.
- Workspace realtime events are invalidation hints only.
- GET/read paths must not repair or mutate state.
- Chat/run streaming must stay separate from workspace chrome realtime.
- The authoritative chat POST must not be aborted on route unmount.
- The preview runtime renders built `dist/index.html`; source snapshots in MongoDB are the durable fallback when worker files are gone.

The image architecture has three product columns:

1. Source Control settings:
   - route: `/w/<workspace-slug>/settings/source-control`
   - GitHub enabled
   - GitLab/Bitbucket shown as enterprise-only or coming later
   - GitHub detail page modeled after existing settings integration detail pages
   - local mode: GitHub PAT
   - cloud mode: future OAuth app, but PAT support first with a callout
2. Post-build repository sync:
   - `done_building` remains the transparent build completion signal
   - local desktop/CLI repo creator is the GitHub user represented by the configured PAT
   - if the app has no repo, create repo
   - if the app has a repo, commit/push/tag
   - tag description is the `summary` from `done_building`
   - repo linkage is stored in MongoDB metadata
3. Available Apps:
   - route: `/w/<workspace-slug>/available-apps`
   - local-only page after New app, Agents, and Library
   - shows apps available through org source control
   - cards include title, description, who built it, and version
   - button is Get or Update
   - Get downloads/imports the app into local Second

## Relevant Files and Code Areas

- `docs/architecture.mdx`
  - workspace model, Mongo/Redis, app metadata, source snapshots, realtime boundaries.
- `docs/streaming.mdx`
  - `done_building` stream handling and persistence expectations.
- `docs/guard-and-tenancy.mdx`
  - workspace context, tenant isolation, audit, internal API constraints.
- `docs/app-preview.mdx`
  - worker files, `app_source_snapshots`, `dist/index.html`, cold restore behavior.
- `docs/self-hosting.mdx`
  - deployment modes, env vars, WorkOS, Mongo, Redis, worker/web boundaries.
- `docs/app-governance.mdx`
  - draft/published app source snapshots, owner/admin access, approval flows.
- `docs/integrations.mdx`
  - app-scoped grants and server-side secret handling patterns.
- `apps/web/src/lib/app-bundles.ts`
  - existing ZIP export/import format, path filtering, bundle caps, manifest shape.
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/export/route.ts`
  - existing export API, access checks, draft/live file merge, audit event.
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/import/route.ts`
  - existing import API, bundle parsing, app creation, snapshot save, restored run creation.
- `apps/web/src/lib/db/repositories/app-source-snapshots.ts`
  - durable source snapshot storage.
- `apps/web/src/lib/db/repositories/apps.ts`
  - `saveAppSourceFiles`, snapshot metadata, draft edit behavior, app list projections.
- `apps/web/src/lib/db/types.ts`
  - Mongo document types to extend with source-control connection and app metadata.
- `apps/web/src/lib/db/collections.ts`
  - collection accessors for new source-control collections.
- `apps/web/src/lib/db/indexes.ts`
  - indexes for workspace-scoped source-control config and app linkage.
- `apps/worker/src/runner.ts`
  - `executeDoneBuildingTool`, build validation, snapshot collection, summary payload.
- `apps/worker/src/tool-broker.ts`
  - registered `done_building` tool.
- `apps/web/src/lib/agent/done-building.ts`
  - parser for successful `done_building` payload.
- `apps/web/src/lib/agent/worker-bridge.ts`
  - detection of successful `done_building` and worker file fetch.
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/route.ts`
  - post-stream save point where source-control sync should be triggered.
- `apps/web/src/components/app-preview.tsx`
  - preview from built `dist/index.html`.
- `apps/web/src/components/import-app-dialog.tsx`
  - existing local import UX to reuse for Available Apps behavior.
- `apps/web/src/components/app-composer.tsx`
  - app creation/import entry points and events.
- `apps/web/src/components/workspace-sidebar.tsx`
  - add local-only "Available Apps" nav item.
- `apps/web/src/app/w/[workspaceId]/layout.tsx`
  - workspace shell props and local capability flags.
- `apps/web/src/app/w/[workspaceId]/settings/settings-nav.tsx`
  - add settings nav entry.
- `apps/web/src/app/w/[workspaceId]/settings/integrations/page.tsx`
  - visual reference for compact settings cards.
- `apps/web/src/app/w/[workspaceId]/settings/integrations/[integrationId]/page.tsx`
  - visual reference for provider detail page.
- `apps/web/src/app/w/[workspaceId]/settings/integrations/integrations-client.tsx`
  - realtime/read-model/client UX reference.
- `apps/web/src/lib/workspace-settings/read-models.ts`
  - add a source-control settings read model.
- `apps/web/src/lib/oauth/secret-store.ts`
  - secure storage pattern with WorkOS Vault or encrypted local storage.
- `apps/web/src/lib/vault.ts`
  - WorkOS Vault primitives.
- `apps/web/src/lib/db/repositories/oauth-provider-configs.ts`
  - provider configuration persistence pattern.
- `apps/web/src/lib/auth/permissions.ts`
  - permissions for source-control settings management.
- `apps/web/src/lib/auth/app-access.ts`
  - app access behavior and workspace ownership rules.
- `apps/web/src/app/api/workspaces/[workspaceId]/sidebar/route.ts`
  - keep source-control sidebar additions compact.
- `apps/web/src/lib/events/workspace-events.ts`
  - add source-control invalidation events without payload bloat.
- `apps/web/src/lib/config/runtime.ts`
  - expose local install capability safely.
- `packages/cli-local-darwin-arm64/bin/second-local.js`
  - local CLI runtime env; confirms `SECOND_LOCAL_INSTALL=1`.
- `apps/desktop/src/main/main.js`
  - desktop runtime process setup.
- `packages/local-supervisor/src/index.js`
  - desktop/local supervisor process orchestration.

Official GitHub docs consulted for implementation constraints:

- [Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Repository REST API](https://docs.github.com/en/rest/repos/repos)
- [Repository contents REST API](https://docs.github.com/en/rest/repos/contents)
- [Git database REST API: trees](https://docs.github.com/en/rest/git/trees)
- [Git database REST API: refs](https://docs.github.com/en/rest/git/refs)
- [Git database REST API: tags](https://docs.github.com/en/rest/git/tags)
- [Releases REST API](https://docs.github.com/en/rest/releases/releases)

## Assumptions and Constraints

- Do not implement coding changes from this plan until explicitly requested.
- Support GitHub only in the first implementation.
- Design provider interfaces so GitLab and Bitbucket adapters can be added later.
- The first GitHub connection type is PAT. OAuth/GitHub App can be added later.
- The UI should show GitHub OAuth as coming soon in cloud/on-prem mode.
- Available Apps is local-only for CLI/desktop. Cloud deployments already have central sharing/publishing semantics and should not show this page by default.
- Do not change the public semantics of the `done_building` tool.
- Do not require a local `git` binary. Use provider APIs for repo creation, commits, tags, and archive/download.
- Do not make normal app page loads compile source; when source control is enabled, render a materialized cached artifact that corresponds to the selected GitHub version.
- Do not put source files, built files, prompts, tokens, PATs, or full provider responses on hot metadata paths or realtime events.
- All source-control records and app queries must be scoped by `workspaceId`.
- All external provider calls must run server-side.
- Agents and workers must never receive the PAT unless a future provider design explicitly scopes a worker-only short-lived token. The first implementation should not do that.
- GitHub repo visibility should default to private.
- Fine-grained PATs should be preferred over classic PATs.
- Generated apps should continue excluding unsafe files such as `.env`, `.npmrc`, `.git`, and ignored directories.
- GitHub repository topics are useful for discovery but should not be the sole source of truth; the root manifest is authoritative.
- GitHub tag/release behavior must be idempotent and recoverable.

## Progress

- [x] 2026-07-01: Read the image and extracted text.
- [x] 2026-07-01: Read root `PLANS.md` and shaped this as a plan-only deliverable.
- [x] 2026-07-01: Read architecture, streaming, app preview, tenancy, self-hosting, governance, integration, local runtime, import/export, and settings code paths.
- [x] 2026-07-01: Confirmed the existing app runtime serves built previews from worker/Mongo snapshots, not from source control.
- [x] 2026-07-01: Researched GitHub PAT and REST API requirements for repo creation, contents, git trees, refs, tags, releases, and topics.
- [x] 2026-07-01: Created this implementation plan.
- [ ] Implementation not started.
- [ ] Validation not started.

## Surprises & Discoveries

- The current source snapshot already includes built `dist/**` files, not only editable source. This is why MongoDB can remain the fast render cache while GitHub becomes the organization distribution/source layer.
- Existing export/import already has most of the app packaging constraints needed for GitHub distribution: path safety, size caps, manifest, ignored files, audit, restored run creation, and `agents.json` handling.
- GitHub-generated repository archive ZIPs include a top-level repo/ref directory. The importer will need a normalization step before reusing the existing `second-app.json` parser.
- GitHub repository topics require administration-level permission to replace topics. Topics should be best-effort and merged with existing topics, not assumed to always succeed.
- `done_building.summary` is available in the worker result, but the web bridge should preserve the parsed payload explicitly so the post-build sync does not scrape text from messages.
- Local CLI and desktop already identify themselves through `SECOND_LOCAL_INSTALL=1`, which can gate the Available Apps page.

## Decision Log

1. When source control is enabled, treat GitHub as authoritative and MongoDB snapshots as materialized cache.
   - Normal app page loads should render a cached built artifact for the selected GitHub version.
   - Normal app page loads should not compile source.
   - Agent/session restore should use GitHub when source control is enabled and the live worker/container state is gone.

2. Use provider APIs, not shell `git`.
   - This avoids a runtime dependency on `git`.
   - It makes future providers easier to add.
   - It lets the server enforce file filtering and token handling in one place.

3. Add a provider abstraction before adding GitHub-specific code.
   - The app lifecycle should call `SourceControlProvider`, not GitHub REST endpoints directly.

4. Preserve the `done_building` tool contract.
   - The source-control sync happens after successful snapshot persistence only when the app has source-control publishing enabled.
   - The agent does not need to know whether source control is connected.

5. Workspace source-control connection is not app publication.
   - Connecting GitHub enables source-control publishing controls.
   - It must not automatically upload existing Mongo-only apps.
   - It must not automatically upload newly created apps.
   - Each app becomes source-control-backed only after the user explicitly enables "Publish to source control" for that app.

6. Do not fail local app rendering when GitHub sync fails after the snapshot is saved.
   - The app build remains usable locally.
   - The app receives a visible source-control sync status and retry action.
   - The run/audit trail records the sync failure without exposing secrets.

7. Use `second-app.json` at repository root as the authoritative app manifest.
   - This keeps the repository self-describing.
   - It aligns with the existing bundle manifest.
   - GitHub archive imports can reuse the existing import parser after stripping the GitHub archive root directory.

8. Use `second-app-v<N>` tags.
   - `N` is a monotonically increasing integer stored in app source-control metadata and validated against remote tags.
   - The annotated tag message is the `done_building.summary`.

9. Default app repositories to private.
   - Public repos should require an explicit future setting.

10. Gate Available Apps to local runtimes.
   - The sidebar item appears only when `SECOND_LOCAL_INSTALL=1` and a source-control connection is configured or connectable.

11. Keep GitHub discovery layered.
    - Prefer repos with topic `second-app` when available.
    - Validate every candidate by reading root `second-app.json`.
    - Treat manifest metadata as authoritative.

12. Use WorkOS Vault or the existing encrypted secret-store pattern for PATs.
    - Do not store PAT plaintext in MongoDB.
    - Do not expose secret refs to clients unless already safe in existing config patterns.

13. Put only compact source-control state on app metadata.
    - Store provider, owner, repo, tag/version, commit SHA, sync status, and source hash.
    - Do not store files, provider responses, or token data on the app document.

## Plan of Work

### Data Model

Add a workspace-scoped source-control connection collection.

Proposed document:

```ts
type SourceControlProviderKey = "github";

type SourceControlConnectionDocument = {
  _id: ObjectId;
  workspaceId: ObjectId;
  provider: SourceControlProviderKey;
  mode: "pat" | "oauth-placeholder";
  status: "not_configured" | "valid" | "invalid" | "revoked";
  targetOwner: string;
  targetOwnerType?: "user" | "organization" | "unknown";
  defaultVisibility: "private" | "public";
  repoNamePrefix?: string;
  credentialRef: string;
  credentialKind: "github_pat";
  connectedAccountLogin?: string;
  connectedByUserId?: ObjectId;
  connectedByName?: string;
  permissionsState?: {
    canReadMetadata: boolean;
    canReadContents: boolean;
    canWriteContents: boolean;
    canCreateRepositories: boolean;
    canManageTopics: boolean;
    checkedAt: Date;
  };
  lastValidatedAt?: Date;
  lastErrorCode?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

Add compact source-control metadata to `AppDocument`.

Proposed embedded field:

```ts
type AppSourceControlMetadata = {
  publishEnabled: true;
  publishState: "publishing" | "published" | "sync_failed";
  provider: "github";
  connectionId: ObjectId;
  owner: string;
  repo: string;
  repoId?: string;
  defaultBranch: string;
  remoteUrl?: string;
  manifestPath: "second-app.json";
  latestCommitSha?: string;
  latestTreeSha?: string;
  latestTag?: string;
  version?: number;
  sourceHash?: string;
  syncStatus: "never" | "pending" | "synced" | "failed";
  lastSyncedAt?: Date;
  lastSyncStartedAt?: Date;
  lastSummary?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdByRemoteLogin?: string;
  installedFrom?: {
    provider: "github";
    owner: string;
    repo: string;
    tag?: string;
    version?: number;
    commitSha?: string;
    sourceHash?: string;
  };
};
```

Absence of `apps.sourceControl` means the app is not published to source control. Workspace source-control connection alone must not create this field on every app.

Add indexes:

- `source_control_connections`: unique `{ workspaceId: 1, provider: 1 }`.
- `apps`: `{ workspaceId: 1, "sourceControl.provider": 1, "sourceControl.owner": 1, "sourceControl.repo": 1 }`.
- `apps`: `{ workspaceId: 1, "sourceControl.installedFrom.provider": 1, "sourceControl.installedFrom.owner": 1, "sourceControl.installedFrom.repo": 1 }`.

### Repository Manifest

Write a root `second-app.json` into every app repository.

Proposed manifest extension:

```json
{
  "type": "second.app.export.v1",
  "schemaVersion": 1,
  "exportedAt": "2026-07-01T00:00:00.000Z",
  "app": {
    "name": "Customer Console",
    "description": "Internal customer lookup console",
    "slug": "customer-console",
    "tags": ["Second App"]
  },
  "source": {
    "fileCount": 42,
    "totalBytes": 812345,
    "hash": "sha256:..."
  },
  "context": {
    "buildSummaries": [
      "Added customer search and account detail view."
    ]
  },
  "sourceControl": {
    "provider": "github",
    "owner": "acme",
    "repo": "customer-console-second-app",
    "tag": "second-app-v12",
    "version": 12,
    "commitSha": "...",
    "builtBy": {
      "displayName": "John Doe",
      "remoteLogin": "john-doe"
    }
  }
}
```

Implementation notes:

- Keep existing manifest fields compatible with `SecondAppBundleManifest`.
- Allow unknown manifest fields in parser if not already supported.
- Treat the manifest as metadata only. Files still go through existing path/size filtering.
- Do not include secrets, prompts beyond existing safe build-summary context, tokens, cookies, headers, or full provider responses.

### Provider Interface

Create `apps/web/src/lib/source-control/types.ts`.

```ts
export type SourceControlProviderKey = "github";

export type SourceControlConnectionInput = {
  workspaceId: string;
  credentialRef: string;
  targetOwner: string;
};

export type SourceControlAppRef = {
  provider: SourceControlProviderKey;
  owner: string;
  repo: string;
  defaultBranch?: string;
};

export type SourceControlSnapshotCommitInput = {
  appId: string;
  appName: string;
  description?: string;
  files: Record<string, string>;
  manifest: SecondAppBundleManifest;
  summary: string;
  sourceHash: string;
  previous?: AppSourceControlMetadata;
};

export interface SourceControlProvider {
  key: SourceControlProviderKey;
  validateConnection(input: SourceControlConnectionInput): Promise<ValidatedSourceControlConnection>;
  listSecondApps(input: SourceControlConnectionInput): Promise<SourceControlCatalogItem[]>;
  ensureAppRepository(input: EnsureAppRepositoryInput): Promise<EnsuredRepository>;
  commitAppSnapshot(input: SourceControlSnapshotCommitInput): Promise<CommittedSnapshot>;
  createVersionTag(input: CreateVersionTagInput): Promise<CreatedVersionTag>;
  downloadAppArchive(input: DownloadAppArchiveInput): Promise<DownloadedArchive>;
  loadAppFilesAtRef(input: LoadAppFilesAtRefInput): Promise<LoadedAppFiles>;
}
```

Create `apps/web/src/lib/source-control/providers/github.ts` as the first adapter.

GitHub operations:

- Validate token/account:
  - call the GitHub user endpoint and owner/repo APIs needed by the configured target owner.
  - verify metadata read, contents read/write, and repo creation/admin capability where possible.
- Create repository:
  - organization repo: `POST /orgs/{org}/repos`.
  - user repo: `POST /user/repos`.
  - default private.
  - create a predictable slug and handle collisions.
- Commit snapshot:
  - get current branch ref if repo exists.
  - create blobs/trees/commit through Git database APIs.
  - update branch ref.
  - include full sanitized snapshot plus `second-app.json`.
  - ensure deletions remove files no longer in the app snapshot.
- Tag version:
  - create annotated tag object.
  - create `refs/tags/second-app-v<N>`.
  - tag message is exactly the successful `done_building.summary` or a sanitized fallback if absent.
- Discovery:
  - list owner repositories with pagination.
  - prefer repos with `second-app` topic.
  - read root `second-app.json` to validate.
  - find latest `second-app-v<N>` tag and manifest at that ref.
- Download:
  - use provider archive download for the selected tag/ref.
  - normalize GitHub archive root before passing into shared import logic.

### Credential Storage

Generalize or wrap `apps/web/src/lib/oauth/secret-store.ts` for source-control tokens.

Implementation options:

1. Rename to a generic `apps/web/src/lib/secrets/secret-store.ts` and keep OAuth wrappers.
2. Add `apps/web/src/lib/source-control/credential-store.ts` that delegates to the existing secret-store/Vault primitives.

Prefer option 2 for the smallest implementation.

Rules:

- Store PAT values only in WorkOS Vault or encrypted local storage.
- Persist only `credentialRef` in MongoDB.
- On credential rotation, update the secret ref atomically with config status.
- On delete/disconnect, delete the secret first or mark it revoked if provider deletion fails.
- Mask PAT input in UI.
- Never log PATs. Redact `Authorization` headers and provider error bodies.

### Settings UI and API

Add settings route:

- `apps/web/src/app/w/[workspaceId]/settings/source-control/page.tsx`
- optional provider detail route:
  - `apps/web/src/app/w/[workspaceId]/settings/source-control/github/page.tsx`

Add settings navigation entry in:

- `apps/web/src/app/w/[workspaceId]/settings/settings-nav.tsx`

Match existing settings style:

- compact rows,
- muted borders,
- semantic badges,
- mono metadata,
- no large marketing panels,
- GitHub card enabled,
- GitLab and Bitbucket cards disabled with "Enterprise" or "Coming later" badge.

Add API routes:

- `GET /api/workspaces/[workspaceId]/source-control`
  - returns provider cards and current connection read model.
- `PUT /api/workspaces/[workspaceId]/source-control/github`
  - validates and stores target owner, repo visibility, and PAT.
- `POST /api/workspaces/[workspaceId]/source-control/github/validate`
  - validates without saving, if useful for UI.
- `DELETE /api/workspaces/[workspaceId]/source-control/github`
  - disconnects and deletes secret ref, leaving local app metadata intact.

Permissions:

- Require workspace context for every route.
- Require owner/admin or `workspace:manage` for configure/disconnect.
- Allow members to read a minimal "connected or not" state only if needed for Available Apps.

PAT instructions in UI:

- Prefer a fine-grained personal access token.
- Resource owner should be the GitHub user or organization that will own Second app repos.
- Repository access should cover either all repositories under that owner or the repository set the organization expects Second to manage.
- Required repository permissions:
  - Metadata: read
  - Contents: read and write
  - Administration: write, for creating repositories and managing topics
- Workflows: write only if the organization deliberately allows Second apps to include `.github/workflows/*`; otherwise Second should continue filtering or blocking workflow files.
- Org approval may be required for fine-grained PATs.
- Classic PAT fallback:
  - `repo` for private repositories.
  - `public_repo` only if the organization explicitly uses public app repos.
- Recommend expiration and rotation.

Cloud/on-prem UI:

- Show the same GitHub PAT flow initially.
- Add a compact callout: "GitHub OAuth app connection is coming soon for managed and on-prem deployments."
- If WorkOS Vault is configured, show "Stored in WorkOS Vault" after save.
- If local encrypted storage is used, show a local/trusted-runtime label.

### App-Level Publish to Source Control

Workspace source control only enables source-control publishing. It does not publish apps by itself.

Add an app-level "Publish to source control" toggle/action in the app top bar.

Availability:

- local CLI/desktop only,
- workspace source control is connected,
- current user can update/publish the app,
- provider connection has enough permission to create/update the target repo.

Behavior:

- Toggle off / not published:
  - app remains Mongo-only,
  - `done_building` saves the snapshot as it does today,
  - no GitHub repo is created,
  - no commit is pushed,
  - no tag/version is created.
- First toggle on:
  - take the current latest app state from live worker files if available, otherwise from Mongo snapshot,
  - create the GitHub repo if needed,
  - write the sanitized app files,
  - write root `second-app.json`,
  - label/mark the repo as a Second app,
  - commit the snapshot,
  - create `second-app-v1`,
  - set `apps.sourceControl.publishEnabled = true`,
  - set `apps.sourceControl.publishState = "published"`.
- After toggle on:
  - every later successful `done_building` with changed source commits/tags a new version,
  - same source hash does not create a duplicate version,
  - GitHub becomes authoritative for that app.

Existing Mongo-only apps:

- stay Mongo-only after workspace GitHub connection,
- keep loading from Mongo,
- are adopted into GitHub only when the user turns on "Publish to source control" for that specific app.

New apps:

- also stay Mongo-only by default,
- must not be uploaded on first `done_building`,
- start syncing only after the user turns on "Publish to source control" for that app.

Modal copy should explain the behavior plainly:

```text
Publish this app to source control?

Second will create a GitHub-backed version of this app from the current app state. After publishing, future successful builds for this app will automatically update GitHub and create new versions.

Apps that are not published stay local.
```

### Post-`done_building` Source-Control Sync

Extend `WorkerBridgeResult` to include parsed successful build completion payload:

```ts
type WorkerBridgeResult = {
  ...
  sourceFiles?: Record<string, string>;
  doneBuilding?: {
    summary?: string;
    fileCount?: number;
    totalBytes?: number;
    warning?: string;
  };
};
```

In `worker-bridge.ts`:

- When `isDoneBuildingSuccessOutput` succeeds, store the parsed payload.
- Preserve current behavior for `buildComplete` and file fetch.

In the chat route:

1. Stream worker result as today.
2. If `bridgeResult.sourceFiles` exists, call `saveAppSourceFiles` as today.
3. After `saveAppSourceFiles` succeeds, call `syncAppSnapshotToSourceControl` if:
   - workspace has an active source-control connection,
   - this specific app has `apps.sourceControl.publishEnabled = true`,
   - build completed successfully.
4. Source-control sync:
   - computes/uses the same source hash as snapshot save,
   - skips commit/tag if hash already matches the latest synced hash,
   - creates repo if missing,
   - commits files and manifest,
   - creates tag,
   - updates compact `apps.sourceControl` metadata,
   - records audit events.

Failure behavior:

- Do not throw after the local snapshot has been saved.
- Mark `sourceControl.syncStatus = "failed"`.
- Store a short safe `lastErrorCode` and redacted `lastErrorMessage`.
- Record audit event `app.source_control_sync.failed`.
- Publish a small workspace invalidation event with app id and source-control status only.
- Show retry affordance in app settings or source-control status UI.

Audit events:

- `source_control.connected`
- `source_control.disconnected`
- `app.source_control_repo.created`
- `app.source_control_sync.started`
- `app.source_control_sync.completed`
- `app.source_control_sync.failed`
- `app.source_control_app.installed`
- `app.source_control_app.updated`

### GitHub Repository Shape

Each app repository should contain:

- the sanitized app source files,
- generated `second-app.json`,
- optional generated `README.md`,
- built `dist/**` from the successful build snapshot.

It must not contain:

- `.git`,
- `.env*`,
- `.npmrc`,
- package-manager auth files,
- `node_modules`,
- `.next`,
- `.cache`,
- `.claude`,
- local attachments,
- source maps or very large artifacts if current app-bundle filters exclude them,
- any files rejected by `filterBundleSourceFiles`.

Commit message:

```text
Update Second app snapshot

<done_building.summary>
```

Tag:

```text
second-app-v<N>
```

Tag message:

```text
<done_building.summary>
```

Repository topics:

- Best-effort merge existing topics with `second-app`.
- If topic update fails due to permissions, continue with manifest-based discovery and mark a non-fatal warning.

### Available Apps UI and API

Add page:

- `apps/web/src/app/w/[workspaceId]/available-apps/page.tsx`

Add sidebar item:

- `apps/web/src/components/workspace-sidebar.tsx`

Display copy:

```text
Apps that are available for you to get through your org's source control.
```

Gating:

- Only show in local mode, using `SECOND_LOCAL_INSTALL=1`.
- If no source-control connection exists, show an empty state with a settings link for admins/owners.
- In cloud mode, hide the page or return 404.

Add APIs:

- `GET /api/workspaces/[workspaceId]/available-apps`
  - local-only.
  - requires workspace context.
  - uses server-side source-control connection.
  - lists provider catalog items.
  - returns compact cards:
    - provider
    - owner
    - repo
    - title
    - description
    - builtBy
    - latestTag
    - version
    - updatedAt
    - installStatus: `available | installed | update_available`
    - installedAppId if installed.
- `POST /api/workspaces/[workspaceId]/available-apps/install`
  - body: provider, owner, repo, tag/ref.
  - downloads selected archive/ref server-side.
  - normalizes archive root.
  - reuses shared import service to create a local app.
  - records `installedFrom` metadata.
- `POST /api/workspaces/[workspaceId]/available-apps/update`
  - body: provider, owner, repo, tag/ref, appId.
  - verifies the local app is installed from the same upstream.
  - downloads selected ref.
  - updates the existing app draft snapshot through `saveAppSourceFiles`.
  - creates a completed import/update run for audit/history.
  - marks local draft edited if needed.

Refactor import code:

- Extract shared import logic from `apps/import/route.ts` into a service:
  - parse bundle/archive,
  - validate files,
  - create app or update app,
  - save source files,
  - sync integration setup,
  - handle `agents.json` approval where safe,
  - create restored/imported run.

UI behavior:

- Use compact cards or rows matching existing app/library style.
- Show provider/repo/tag in mono metadata.
- Button is "Get" when not installed.
- Button is "Update" when installed version is behind.
- Button is disabled with a clear state when the PAT cannot read the repo.
- Do not show provider tokens, clone URLs with embedded auth, or raw error bodies.

### Source-Control Restore for Workers / Cloud Containers

When source control is enabled, GitHub is the source of truth for app source. MongoDB is a materialized cache/snapshot, not the authority.

Add a source-control restore path for worker/session initialization:

- When a chat/build session needs source files:
  - if the existing worker/container session is still alive, keep using its live files,
  - if restore is needed and source control is enabled for the app, load the selected app version from GitHub,
  - save the restored files back into `app_source_snapshots` as a fast cache,
  - then hydrate the worker,
  - if source control is not enabled, restore from Mongo `app_source_snapshots`.

Rules:

- This restore path is a mutation and must not run from GET/read page routes.
- It should run only in explicit build/session initialization or explicit resync/recover actions.
- It must enforce workspace/app access before fetching.
- It must not leak PATs to workers.
- It should be observable with audit and logs, but logs must be redacted.

For cloud/on-prem deployments:

- Container initialization should load source from GitHub when source control is enabled and a dead/ephemeral container must be restored.
- The built user preview should still render from a fast materialized artifact/cache, but that artifact/cache must correspond to the GitHub source-of-truth version.
- If source control is unreachable, Mongo can be used only as an offline/stale fallback with visible status, not silently treated as authoritative.

### Performance Safety Checklist

For every implementation phase touching navigation, settings, app metadata, chat, runs, sidebar, or source persistence, verify:

- Hot-path data shape:
  - sidebar/app list contains only compact app/source-control status.
  - no source files, manifests, provider payloads, or token refs unless already safe.
- Read-vs-write behavior:
  - GET routes do not create repos, repair configs, sync snapshots, or write audit events.
  - source-control restore happens only from mutation/build/session paths.
- Realtime invalidation source:
  - events are emitted only after successful DB mutations.
  - events include workspace id, app id, status, and timestamps only.
- Duplicate request prevention:
  - settings/catalog clients dedupe refreshes.
  - Available Apps pagination does not trigger repeated full repo scans on every render.
- Multi-tab/multi-user streaming:
  - build POST remains authoritative.
  - source-control sync does not abort chat persistence.
  - reconnecting clients see saved snapshot and sync status.
- Tenant isolation:
  - every query includes `workspaceId`.
  - provider connection is loaded by workspace id.
  - installed/updated apps are created only in the current workspace.
- Validation:
  - use mocks/unit tests for provider failures.
  - use local browser QA with `.second-dev.txt` only when QA is explicitly requested.

## Phased Implementation Plan

### Phase 1: Data Model and Secret Foundation

Implement:

- `SourceControlConnectionDocument` type.
- `AppSourceControlMetadata` type.
- collection helpers.
- indexes.
- repository helpers:
  - get connection by workspace/provider,
  - upsert connection,
  - mark connection invalid,
  - delete connection,
  - update app source-control metadata,
  - query locally installed upstream apps.
- credential store wrapper for source-control PATs.

Validation:

- Typecheck DB types.
- Unit-test secret store wrapper with redaction and missing-key behavior.
- Verify no PAT appears in returned read models.

### Phase 2: Provider Interface and GitHub Adapter

Implement:

- provider types.
- GitHub fetch client with:
  - REST base URL,
  - API version header,
  - user agent,
  - token redaction,
  - pagination helper,
  - typed error normalization.
- GitHub connection validation.
- GitHub repository creation.
- GitHub commit via Git database APIs.
- GitHub annotated tags.
- GitHub repository discovery and manifest loading.
- GitHub archive download and root normalization.

Validation:

- Unit-test URL construction and pagination.
- Unit-test manifest validation.
- Unit-test idempotent "same source hash" skip.
- Unit-test tag conflict behavior.
- Mock GitHub 401, 403, 404, rate limit, repo exists, topic permission denied, and archive root formats.

### Phase 3: Source Control Settings

Implement:

- settings nav item.
- source-control settings page.
- GitHub detail page or inline detail state.
- read model.
- GET/PUT/DELETE API routes.
- local/cloud UI labels.
- PAT instructions.
- disabled GitLab/Bitbucket cards.

Validation:

- Owner/admin can configure.
- Member cannot configure.
- PAT is never returned after save.
- Disconnect removes/revokes secret reference.
- UI matches existing integrations/settings visual language.

### Phase 4: App-Level Publish and Post-Build Sync

Implement:

- `WorkerBridgeResult.doneBuilding`.
- app top-bar "Publish to source control" toggle/action.
- publish confirmation modal.
- first-publish adoption flow from current live files or Mongo snapshot.
- source-control sync service.
- source-control manifest writer.
- app repo creation on first publish.
- commit/tag on every later successful build only after app-level publish is enabled.
- app metadata updates.
- audit events.
- visible sync status and retry API.

Validation:

- Build with no source-control connection behaves exactly as before.
- Build with source-control connection but app publish off behaves exactly as before and does not create a repo, commit, or tag.
- First publish for an app creates repo, commit, tag, and app metadata.
- Second build after publish commits and tags a new version.
- Same source hash does not create a duplicate tag.
- GitHub failure after local snapshot save leaves app usable and marks sync failed.
- Retry succeeds without duplicating repos.

### Phase 5: Available Apps

Implement:

- local-only sidebar item.
- page route.
- catalog API.
- install API.
- update API.
- shared import/update service extracted from existing import route.
- installed/update detection from app source-control metadata.

Validation:

- Hidden in cloud mode.
- Visible in local mode.
- Catalog lists only validated Second app repos.
- Get creates a local app with `installedFrom` metadata.
- Update updates the existing app, not a duplicate.
- Import path still accepts manually uploaded ZIPs.
- Repo archive root normalization works for GitHub archives.

### Phase 6: Source-Control Restore for Worker Initialization

Implement:

- explicit restore service for app source files from provider ref.
- hook into build/session initialization when restore is needed and app has source-control metadata.
- save restored files to `app_source_snapshots`.
- audit/source-control restore event.

Validation:

- Normal app page GET does not call GitHub.
- Worker restore calls GitHub only when needed.
- Stale/missing snapshot recovers from GitHub.
- GitHub outage falls back to existing Mongo snapshot when present.
- Restore failure is visible and redacted.

### Phase 7: Security, Docs, and QA

Implement/update:

- docs for source-control architecture.
- `docs/app-preview.mdx` with explicit GitHub restore boundary.
- `docs/self-hosting.mdx` with GitHub PAT/OAuth-coming-soon setup notes.
- `docs/guard-and-tenancy.mdx` with source-control tenant isolation constraints if needed.
- QA guide for local source-control app sharing.

Validation:

- Security review for tenant isolation and secret handling.
- Check no secrets in logs, events, audit metadata, browser payloads, or worker payloads.
- Check no GET route mutates state.
- Check sidebar/settings do not fetch full source or scan GitHub repeatedly.
- Browser QA only when explicitly requested, using `.second-dev.txt` for the local URL.

## Concrete Steps and Commands

Before coding:

```bash
pwd
rg -n "sourceControl|source-control|app_source_snapshots|saveAppSourceFiles|done_building|SECOND_LOCAL_INSTALL" apps packages docs
```

During implementation:

```bash
npm --prefix apps/web run typecheck
npm --prefix apps/worker run typecheck
npm --prefix apps/web run lint
```

If the repository has broader validation scripts at implementation time, prefer the repo-standard commands discovered from `package.json`.

For local browser QA, only when explicitly requested:

```bash
npm run dev
sed -n 's/^url=//p' .second-dev.txt
```

Then use the URL from `.second-dev.txt`, not an assumed `localhost:3000`.

Manual QA flow after implementation:

1. In a local runtime, open Source Control settings.
2. Configure GitHub PAT for an organization or user owner.
3. Build a tiny app and wait for `done_building`.
4. Verify:
   - local preview works,
   - repo exists,
   - source files and `dist/**` exist,
   - root `second-app.json` exists,
   - `second-app-v1` tag exists,
   - tag message matches `done_building.summary`,
   - app metadata shows synced.
5. Modify the app and build again.
6. Verify `second-app-v2` tag and updated manifest.
7. In another local runtime/workspace with a PAT that can read the org repos, open Available Apps.
8. Click Get and verify app imports locally.
9. Build a newer version in the creator runtime.
10. Verify the other runtime shows Update.
11. Click Update and verify the existing local app updates.
12. Confirm normal app page load renders the cached built artifact for the selected GitHub version and does not compile source.

## Validation and Acceptance

The implementation is acceptable when:

- GitHub can be configured from Source Control settings by owners/admins.
- PATs are stored securely and are never exposed to the client or worker.
- GitLab and Bitbucket are represented as disabled future providers without fake functionality.
- Connecting GitHub does not upload existing apps.
- Creating a new app does not upload it automatically.
- A successful `done_building` does not upload to GitHub unless the specific app has "Publish to source control" enabled.
- First publish for an app creates a repo, commit, tag, and source-control metadata.
- A successful `done_building` commits and tags each new app version only after app-level publish is enabled.
- The tag description is the build summary from `done_building`.
- GitHub sync failures are visible, retryable, audited, and redacted.
- Apps render from a fast cached/materialized built artifact; in source-control mode that artifact must correspond to the selected GitHub version.
- Available Apps is visible only in local CLI/desktop mode.
- Available Apps lists GitHub repos that contain valid Second app manifests.
- Get imports an app into local Second.
- Update updates the existing installed app from the same upstream repo.
- Import/export ZIP behavior remains compatible.
- Worker/container source restore can fetch from GitHub only at explicit build/session restore boundaries.
- All DB reads/writes are scoped by workspace.
- Realtime events remain compact invalidation hints.
- No source, prompts, secrets, tokens, cookies, headers, or full provider documents are placed on hot metadata paths.
- Automated checks pass.
- Browser QA passes if requested.

### Answer to the Loading Question

If source control is enabled, GitHub is the source of truth. This is true for both local and on-prem/cloud deployments.

MongoDB is only a materialized cache/snapshot in that mode. It can make rendering fast, but it must not be treated as the authoritative app state once source control is connected.

| Deployment | Source control | Built app shown to user | Agent files when an existing session is still alive | Agent files when restore is needed |
| --- | --- | --- | --- | --- |
| Local CLI/desktop | Off | Mongo snapshot is authoritative and used for preview. | Live local worker files. | Mongo snapshot. |
| Local CLI/desktop | On | GitHub is authoritative. Materialize the selected GitHub version into the local Mongo/cache and render that cached built artifact. | Live local worker files. | GitHub. Restore from GitHub, then cache in Mongo. |
| On-prem/cloud | Off | Mongo snapshot is authoritative and used for preview. | Live container files. | Mongo snapshot. |
| On-prem/cloud | On | GitHub is authoritative. Materialize the selected GitHub version into Mongo/artifact cache and render that cached built artifact. | Live container files. | GitHub. Restore from GitHub, then cache in Mongo. |

Important answer:

- App preview/page should be fast and render a built artifact, not compile source on every view.
- If source control is off, Mongo is the source of truth.
- If source control is on, GitHub is the source of truth.
- In source-control mode, Mongo is a cache of the selected GitHub version, not the authority.
- If the remote container is still alive, no restore is needed.
- If the remote container died and the user sends a new message, source files should reappear from GitHub when source control is connected.

Why this is the right split:

- Viewing an app and preparing source for an agent are different hot paths.
- The current app-page path already renders from a `files` object and, for built apps, looks for `files["dist/index.html"]` in `apps/web/src/components/app-preview.tsx`.
- The current files API loads persisted snapshots through `getAppSourceFilesForVersion`, plus live worker files only for an active draft worker session.
- `done_building` succeeds only after `npm run build` succeeds and `dist/index.html` exists.
- After the worker returns files, the chat route persists them through `saveAppSourceFiles`.

So the current system is: build during `done_building`, save the built output, then app preview reads the saved built output.

With source control enabled, the authority changes to GitHub, but the hot render shape should remain fast:

- Do not compile on every app page load.
- Do not make viewing an app wait on package install/build.
- Do not make normal viewing depend directly on runner/container startup.
- Do not silently treat Mongo as authoritative when GitHub is connected.
- Do materialize/cache the selected GitHub version so the built app can render quickly.

Long term, the materialized built artifact could move from MongoDB to object storage such as GCS or S3. The rule would still be the same: GitHub is authoritative when source control is enabled, and the app page renders a fast cached built artifact for that GitHub version.

### Answer to the Versioning Question

Yes, versions should auto-bump.

The app version must not be manually entered by the user. Versions auto-bump only for apps that have "Publish to source control" enabled. On every successful `done_building` for an already-published app that produces a source hash different from the latest synced hash, Second should allocate the next version number, commit the snapshot, and create the matching `second-app-v<N>` tag.

Rules:

- Turning on "Publish to source control" for an app creates `version = 1` and tag `second-app-v1` from the current app state.
- Each later successful build for that published app with changed source creates `version = previousVersion + 1` and tag `second-app-v<N>`.
- Builds for unpublished apps do not create versions, repos, commits, or tags.
- If the source hash did not change, do not bump the version and do not create a duplicate tag.
- If local metadata says the next version is `N` but GitHub already has `second-app-v<N>` for another commit, scan existing `second-app-v*` tags, allocate the next available integer, and update Mongo metadata to match GitHub.
- If commit succeeds but tag creation fails, keep the commit metadata, mark tag sync failed, and retry tag creation without bumping again unless the next retry discovers a real tag conflict.
- Available Apps update detection compares the installed upstream version/tag/source hash against the latest remote manifest/tag.

## Idempotence and Recovery

Repo creation:

- If the configured repo name is free, create it.
- If it exists and contains a matching `second-app.json` for this app, attach to it.
- If it exists and is unrelated, generate a suffix.
- If creation succeeds but app metadata update fails, the next sync should discover the repo by manifest or attempt attach before creating another repo.

Commit:

- Compute source hash before syncing.
- If latest synced hash matches, skip commit/tag.
- If remote branch advanced, re-read ref and retry with latest tree.
- If a file was removed locally, remove it from the remote tree.

Tag:

- If the next tag exists for the same commit, treat as success.
- If the next tag exists for a different commit, allocate the next available version and update app metadata.
- If tag creation fails after commit, app metadata should show commit synced but tag failed, with retry creating the tag.

Credential failures:

- 401/403 marks connection invalid/revoked.
- Do not delete local apps.
- Do not remove app source snapshots.
- Show reconnect/rotate PAT path.

Partial import:

- If GitHub archive downloads but import fails validation, no local app should be created.
- If app creation succeeds but snapshot save fails, mark the run/import failed and do not show the app as installed.
- If update fails, preserve the previous local app snapshot.

Rate limits:

- Normalize provider errors.
- Use pagination and request-level dedupe.
- Cache catalog results briefly server-side if needed, but do not let cache bypass permissions.

## Interfaces and Dependencies

New modules:

- `apps/web/src/lib/source-control/types.ts`
- `apps/web/src/lib/source-control/index.ts`
- `apps/web/src/lib/source-control/providers/github.ts`
- `apps/web/src/lib/source-control/credential-store.ts`
- `apps/web/src/lib/source-control/manifest.ts`
- `apps/web/src/lib/source-control/sync-app.ts`
- `apps/web/src/lib/source-control/catalog.ts`
- `apps/web/src/lib/source-control/import-from-provider.ts`

New or changed repositories:

- `apps/web/src/lib/db/repositories/source-control-connections.ts`
- `apps/web/src/lib/db/repositories/apps.ts`
- `apps/web/src/lib/db/types.ts`
- `apps/web/src/lib/db/collections.ts`
- `apps/web/src/lib/db/indexes.ts`

New or changed routes:

- `apps/web/src/app/api/workspaces/[workspaceId]/source-control/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/source-control/github/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/source-control/github/validate/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/available-apps/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/available-apps/install/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/available-apps/update/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/import/route.ts`

New or changed pages/components:

- `apps/web/src/app/w/[workspaceId]/settings/source-control/page.tsx`
- `apps/web/src/app/w/[workspaceId]/settings/source-control/github/page.tsx`
- `apps/web/src/app/w/[workspaceId]/available-apps/page.tsx`
- `apps/web/src/components/workspace-sidebar.tsx`
- `apps/web/src/app/w/[workspaceId]/settings/settings-nav.tsx`

Changed agent/build flow:

- `apps/web/src/lib/agent/worker-bridge.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/route.ts`

Dependencies:

- Prefer native `fetch` plus small local typed helpers over adding Octokit.
- If Octokit is added later, keep it inside the GitHub provider adapter only.

## Artifacts and Notes

### UI Notes

Source Control settings should follow the existing integrations settings pages:

- compact layout,
- clear provider rows,
- semantic status badges,
- mono repo/provider metadata,
- restrained shadcn/Radix styling,
- no marketing hero.

Available Apps should feel like a work queue/catalog:

- filter/search optional later,
- cards or dense rows,
- provider/repo/version visible,
- Get/Update primary action,
- no explanatory wall of text beyond the requested short copy.

### Security Notes

Critical checks:

- No PAT in browser payloads.
- No PAT in worker payloads.
- No PAT in realtime events.
- No PAT in audit metadata.
- No PAT in logs or error messages.
- Workspace id on every DB query.
- App id and workspace id checked before install/update/restore.
- Provider errors normalized and redacted.
- GET routes read only.
- GitHub archive contents pass existing bundle path filters.
- Manifest metadata is untrusted input and must be validated.
- Do not execute or install anything during catalog listing.
- Do not permit `.github/workflows/*` unless explicitly allowed by future policy.

### GitHub Permission Notes

Fine-grained PAT recommended permissions for the first implementation:

- Resource owner: organization or user that will own app repos.
- Repository access: all repositories under that owner, or explicitly selected repos plus enough permission to create new app repos.
- Metadata: read.
- Contents: read and write.
- Administration: write, for repository creation/topic management.
- Workflows: write only if future policy allows generated workflow files.

Classic PAT fallback:

- `repo` for private app repositories.
- `public_repo` only for explicitly public app repositories.

## Outcomes & Retrospective

Not started. Fill this section after implementation and validation.

Record:

- final architecture changes,
- provider API tradeoffs,
- GitHub permission friction,
- performance findings,
- tenant isolation review,
- any follow-up issues.

## Change Notes

- 2026-07-01: Initial plan created from user image architecture, pasted text, repository docs, source inspection, and GitHub API research.

## Captured User Intent (Verbatim)

The user requested:

```text
Your job is to create a plan to implement the following image architecture.
Basically it's a plan to allow organizations to run second on each user's device, meaning the local version, either the CLI or the desktop app AND share applications. 

HOW?:
Because currently second allows you to create zip files of applications And other people can take this zip file and basically upload it as you know. But when you are an organization, it needs to use source control, probably to distribute the applications, because each application is running on the user's device and there is no shared state. We make the source control the shared state. And also this is relevant because I think that it's about time that not all of the code will be stored in MongoDB but rather in GitHub or Bitbucket or whatever like a normal person. But we currently want to support GitHub only, but you need to create the code in a way that will allow us to integrate more providers later. 

So from the image you can understand what's relevant for what. There are basically three columns of stuff that I care about. 

Just if you need the transcription, I created code which extracted all of the raw text. Obviously it's not in order but each bulk of text is there so you can have the full everything that's written in terms, instead of Trying to perfectly read each word from the image but obviously you need to read the image and understand it and see the arrows and how I structured it. 

I also note the question that I have there whether we should actually load apps from GitHub or not. I guess that when initializing containers, when it's cloud deployments, it should be initialized from GitHub as well obviously. 

OK so deeply research the code base and create the full plan and here is the raw text from the image (somewhat unordered right below):
```
