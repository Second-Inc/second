# Ship App-Callable Integration Actions


This plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Change Notes` current as the work evolves. This file must remain consistent with the repository planning rules in `PLANS.md`.


## Overall Goal


Allow generated apps to call approved third-party integration APIs directly from their app code, without forcing deterministic bulk fetch and processing work through an AI app agent.

The v1 outcome should let the builder create a typed wrapper in generated source, such as `src/lib/posthog.ts`, and call a Second SDK function from `src/App.tsx`. The platform should execute the actual third-party HTTP request server-side, inject configured app-scoped secrets or OAuth access tokens server-side, return the provider response to the iframe, and let app code perform deterministic pagination, grouping, filtering, and aggregation.


## Goal Description / Sub-goals


This work is for Linear issue SEC-141, "App backends".

Sub-goals:

- Add a minimal governed way to declare app-callable integration actions that are not tied to an app agent.
- Reuse the existing integration grant, credential, setup, OAuth, domain-lock, private-IP, mock-data, and audit patterns instead of creating a separate backend platform.
- Add a generated-app SDK API that app code can call from `App.tsx` or helper files with TypeScript generics and local wrapper types.
- Add a parent-window bridge and browser-authenticated Next.js route so sandboxed preview iframes can request integration action execution without receiving secrets.
- Support static app-scoped API keys and OAuth connected accounts.
- Keep app and agent integration requirements deduplicated by `workspaceId + appId + domain + keySlug`.
- Preserve draft/published governance: draft app actions can only use live integrations after the approved policy matches the current draft source, and published apps use the promoted published policy.
- Keep the implementation small enough to ship quickly: no arbitrary generated backend code, no new worker process, no new queue, no new database collection unless implementation discovery proves it unavoidable.


## Motivation


Some app workloads are deterministic and data-heavy. A PostHog dashboard that fetches thousands of historical events and groups them by `userId` is a good example. Sending those events through an AI agent is the wrong shape:

- Agents are not deterministic, even with explicit instructions.
- Agents have finite context windows and can fail on large provider responses.
- Large tool outputs waste tokens and latency when the task is just API pagination and local computation.

The product already has the important secure primitives: app-scoped integration grants, user-entered API keys, OAuth connected accounts, server-side secret injection, and approved `agents.json` custom HTTP tools. The missing piece is a way for generated app code to call those governed integration requests directly, while still keeping secrets out of the iframe and out of the builder/runtime agents.


## State Before


The current system supports app agents and agent custom HTTP tools:

- The builder writes `agents.json`.
- The builder calls `mcp__second__present_agents`.
- Admin/owner approval stores a canonical hash and approved payload on the app document.
- App-agent custom tools are exposed by the worker from the approved agent config.
- The worker calls `/api/internal/tool-execute`.
- `/api/internal/tool-execute` verifies the tool appears in the approved `agents.json` payload, resolves the app-scoped integration grant by `workspaceId + appId + domain + keySlug`, injects secrets or OAuth tokens server-side, enforces domain/protocol/private-IP guards, and returns a bounded response.

The current system also supports integration setup:

- The builder writes `integration-setup.json`.
- The builder calls `mcp__second__present_integration_setup`.
- The worker syncs setup metadata through `/api/internal/integration-requirements`.
- Settings -> Integrations lets an admin configure the app-scoped grant.
- A configured credential for another app never satisfies this app.

What is missing:

- A generated app cannot call an integration action directly from `src/App.tsx`.
- Custom HTTP execution is currently coupled to app-agent runs and `agentId`.
- OAuth tool execution currently resolves the user from an app-agent run, not from the current app viewer.
- The workspace SDK exposes `useAgent`, `useAgentList`, `useCollection`, and `useDoc`, but no integration action call.
- The builder prompt explicitly says `present_plan.backend` must be `null` because custom backend is unavailable.
- `agents.json` validation currently expects a non-empty `agents` array, so there is no clean governed policy file for app-callable tools when the app has no agents.


## State After


Generated apps can call app integration actions directly:

- The builder declares app-callable integration actions in the existing governed policy artifact, `agents.json`, using a new top-level `appTools` array.
- The same app can still declare normal `agents` with agent custom tools in the same file.
- `mcp__second__present_agents` validates and presents both agent tools and app-callable actions. If the app has no agents but has `appTools`, approval still works.
- The builder writes `integration-setup.json` for any provider/key that needs setup. The setup item is shared by app tools and agent custom tools when they use the same `domain` and `keySlug`.
- The generated SDK includes `callIntegrationTool<TInput, TData>(toolName, input)` and an optional hook wrapper for React state.
- The generated app can define its own typed wrapper, for example:

      import { callIntegrationTool } from "@/lib/second-sdk";

      export type PostHogEventsPageInput = {
        projectId: string;
        after?: string;
        before?: string;
        offset?: number;
      };

      export type PostHogEventsPage = {
        results: Array<{ distinct_id?: string; properties?: Record<string, unknown> }>;
        next?: string | null;
      };

      export async function fetchPostHogEventsPage(input: PostHogEventsPageInput) {
        const result = await callIntegrationTool<PostHogEventsPageInput, PostHogEventsPage>(
          "posthog_events_page",
          input,
        );
        if (!result.success) throw new Error(result.error ?? "PostHog request failed");
        return result.data;
      }

- The platform executes each call in a browser-authenticated Next.js route, not through an AI agent.
- Static credentials and OAuth tokens never enter generated source, the iframe, the builder agent, app agents, logs, or realtime events.
- Draft/published behavior mirrors app data and agents governance: draft callers use the draft approved policy and draft access rules; published callers use the promoted published policy.


## Context and Orientation


Second is a monorepo. The relevant app is `apps/web`, a Next.js application with shadcn/Radix UI. The worker in `apps/worker` runs builder agents and app agents, scaffolds generated Vite apps, and provides the generated app template.

Generated apps run inside a sandboxed iframe. The iframe does not make privileged same-origin API calls directly. Instead, `src/lib/second-sdk.ts` posts messages to the parent window, and parent bridge components call the real Next.js API routes after validating the message came from the expected iframe window. Existing examples:

- App data: `src/lib/second-sdk.ts` -> `second:data:*` postMessage -> `AppDataBridge` -> `/api/workspaces/[workspaceId]/apps/[appId]/data`.
- App agents: `src/lib/second-sdk.ts` -> `second:agent:*` postMessage -> `AppAgentBridge` -> `/api/workspaces/[workspaceId]/apps/[appId]/agent-runs`.

Integration credentials are already app-scoped. The current secure execution path is centered on `/api/internal/tool-execute`, but that route is internal-token protected and assumes the caller is the worker for an app-agent run. SEC-141 should reuse its request execution logic, not expose the internal route to the browser.


## Relevant Files and Code Areas


- `docs/integrations.mdx`: documents app-scoped integration grants, `integration-setup.json`, static secrets, OAuth connected accounts, `/api/internal/tool-execute`, response bounds, and key files.
- `docs/app-agents.mdx`: documents `agents.json`, custom tools, approval, app-agent lifecycle, and current SDK hooks.
- `docs/agent-system.mdx`: documents the worker, system prompt responsibilities, approval stops, and provider-neutral tool exposure.
- `docs/worker.mdx`: documents worker tools, `present_agents`, `present_integration_setup`, `buildCustomToolsMcpServer`, and allowed tool names.
- `docs/app-data.mdx`: documents the iframe SDK plus parent bridge pattern to copy for app-callable integration actions.
- `docs/app-preview.mdx`: documents the generated Vite template and sandboxed iframe constraints.
- `docs/guard-and-tenancy.mdx`: documents `requireWorkspaceContext`, `resolveAppAccess`, internal API bypass rules, tenant isolation, and custom integration secret boundaries.
- `docs/architecture.mdx`: documents workspace-scoped data, draft/published source snapshots, realtime invalidation constraints, and indexes.
- `docs/streaming.mdx`: relevant for not coupling app integration calls to chat/app-agent streaming.
- `docs/self-hosting.mdx`: relevant for OAuth, secret storage, and internal token requirements in local/on-prem deployments.
- `apps/worker/src/workspace-template.ts`: contains generated `src/lib/second-sdk.ts`; add app integration action SDK functions here.
- `apps/web/src/components/app-workspace.tsx`: mounts `AppDataBridge` and `AppAgentBridge`; mount the new app integration bridge next to them.
- `apps/web/src/components/app-data-bridge.tsx`: best local pattern for request/response postMessage handling and route calls.
- `apps/web/src/components/app-agent-bridge.tsx`: best local pattern for iframe source validation and agent-trigger responses.
- `apps/web/src/app/api/internal/tool-execute/route.ts`: current secure custom HTTP executor; refactor shared execution logic out of this route.
- `apps/worker/src/runner.ts`: current builder tools, `present_agents` validation, integration setup sync, and app-agent custom tool execution.
- `apps/worker/src/builder-skills.ts`: integration instructions injected into generated workspaces; update for app-callable actions.
- `apps/web/src/lib/agent/system-prompt.ts`: builder system prompt; update plan/backend language, app-tool declaration guidance, and SDK usage guidance.
- `apps/web/src/lib/agents/agents-governance.ts`: `agents.json` canonicalization and draft approval checks; update validation to allow `appTools` without agents.
- `apps/web/src/components/ai-elements/agents-card.tsx`: existing approval card for `agents.json`; extend to show app-callable actions compactly.
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/agents/approval/route.ts`: existing approval route; can continue storing the approved policy payload.
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/agents/route.ts`: existing route for reading/updating `agents.json`; update validation language if needed.
- `apps/web/src/lib/db/repositories/apps.ts`: stores and promotes `agentsJsonApprovedPayload`; published snapshot promotion already copies approval metadata.
- `apps/web/src/lib/db/repositories/integrations.ts`: app grant sync, setup checks, credential lookup, OAuth provider shells.
- `apps/web/src/app/api/internal/integration-requirements/route.ts`: syncs `integration-setup.json`; keep this as the setup source.
- `apps/web/src/app/api/internal/workspace-integrations/route.ts`: builder metadata-only integration grant lookup.
- `apps/web/src/lib/auth/app-access.ts`: `resolveAppAccess` and app visibility/collaboration checks for the new browser route.
- `apps/web/src/lib/audit/record.ts`, `apps/web/src/lib/audit/event-explanations.ts`, and audit event types in `apps/web/src/lib/db/types.ts`: update audit metadata and explanations for direct app integration action calls.


## Assumptions and Constraints


- Do not introduce arbitrary generated server code in v1. The generated app can write deterministic TypeScript wrappers and processing logic, but the server only executes declarative HTTP action specs.
- Do not introduce a new database collection in v1. Existing app approval fields can store the approved payload.
- Do not introduce a separate `integrations.json` or `app-backend.json` approval path in v1. Use `agents.json` as the existing governed runtime policy artifact, extended with top-level `appTools`.
- Keep `integration-setup.json` as setup metadata only. It should not become the trusted runtime policy source.
- Keep app-scoped integration identity as `workspaceId + appId + domain + keySlug`.
- Do not let the iframe or browser provide endpoint URLs, headers, secret placeholders, OAuth metadata, or grant identity at execution time. The browser sends only `toolName` and typed input.
- Preserve the existing SSRF protections: domain lock, HTTPS in production, localhost-only HTTP in development, private/internal IP rejection, timeout, and response size bounds.
- Preserve mock-data behavior for missing or unconfigured integrations.
- OAuth v1 should use the current authenticated viewer as the app action user. To minimize schema churn, the approved auth metadata can continue using `identity: "triggering_user"` and document that in direct app calls the "triggering user" is the viewer who caused the SDK call. If implementation discovery shows this is too confusing or unsafe, add a new `identity: "current_user"` value and update validation deliberately.
- App code should page through large provider APIs rather than depending on one unbounded request. Keep per-request response bounds.
- Browser QA is not part of this planning task. During implementation, only run `npm run dev` for browser QA if explicitly requested or allowed by the repo instructions, and read `.second-dev.txt` for the actual URL.


## Progress


- [x] 2026-05-20 20:20 IDT: Fetched Linear SEC-141 and confirmed no comments or extra attachments.
- [x] 2026-05-20 20:20 IDT: Read `PLANS.md`.
- [x] 2026-05-20 20:20 IDT: Read relevant docs: `docs/integrations.mdx`, `docs/app-agents.mdx`, `docs/agent-system.mdx`, `docs/architecture.mdx`, `docs/guard-and-tenancy.mdx`, `docs/app-preview.mdx`, `docs/worker.mdx`, `docs/streaming.mdx`, `docs/app-data.mdx`, and OAuth/self-hosting sections in `docs/self-hosting.mdx`.
- [x] 2026-05-20 20:20 IDT: Read key code paths for integration grants, `agents.json` approval, tool execution, builder tools, generated SDK, iframe bridges, app access, and source snapshots.
- [x] 2026-05-20 20:20 IDT: Created this plan file.
- [ ] Implementation has not started.
- [ ] Automated validation has not run.
- [ ] Browser QA has not run.


## Surprises & Discoveries


- The worker `present_plan` tool already has a `backend` field, but `apps/web/src/lib/agent/system-prompt.ts` explicitly instructs the builder to set it to `null` because custom backend is not available yet. This is the prompt surface to change once app-callable integration actions exist.
- `integration-setup.json` already replaces the current app's grant set on sync. If app tools and agent tools share the same integration key, the builder must write the complete union of requirements, not only the app-tool delta.
- `/api/internal/tool-execute` currently receives `toolSpec` from the worker and verifies it matches approved `agents.json`. The new browser route should be stricter: resolve the canonical approved app tool by name server-side and execute that spec, rather than accepting any endpoint spec from the iframe.
- OAuth custom tools currently require an app-agent `runId` so the web route can resolve `triggeredByUserId`. Direct app calls need a different trusted user source: the authenticated `requireWorkspaceContext` user on the browser route.
- Existing generated app SDK calls all use postMessage. Because the preview iframe is sandboxed without `allow-same-origin`, app integration calls should follow the same parent bridge pattern instead of trying to call Next.js APIs directly from the iframe.
- There is no dedicated test script besides TypeScript typechecking in the root package. Current validation should rely on `npm run typecheck`, targeted manual route checks, and browser QA when allowed.


## Decision Log


- 2026-05-20, Codex: Use top-level `appTools` inside `agents.json` for v1 rather than creating `integrations.json`.
  - Rationale: `agents.json` already has canonical hashing, admin/owner approval, stale-draft detection, published promotion, and approval UI. A new file would require a new approval store, new card, new publish promotion path, and new review checks. The name is imperfect, but the moving-parts count is much lower. The plan should document `agents.json` as the governed app runtime policy artifact for now.
- 2026-05-20, Codex: Keep `integration-setup.json` as setup requirements only.
  - Rationale: setup instructions are synchronized into app-scoped grants, but are not currently a governed runtime policy artifact. Endpoint URLs, secret placeholders, and OAuth metadata must remain in the approved policy payload.
- 2026-05-20, Codex: Do not run arbitrary generated backend code in v1.
  - Rationale: the user asked for the smallest shippable architecture. Declarative server-side HTTP execution covers the PostHog-style use case while avoiding per-app backend hosting, code isolation, deployments, queues, migrations, and server-side generated-code security review.
- 2026-05-20, Codex: Add app integration execution as a browser-authenticated web route, not as a worker or app-agent route.
  - Rationale: deterministic app calls should not consume agent runtime or streaming resources. The route can use the viewer's real workspace/app access and can resolve OAuth identity from the authenticated user.
- 2026-05-20, Codex: Share integration credentials between app tools and agent tools through the same `domain + keySlug`.
  - Rationale: this avoids duplicate setup and keeps the current app-scoped credential model intact. If an app needs separate read and write credentials, it can use different `keySlug` values.


## Plan of Work


The implementation should add "app-callable integration actions" as a thin extension of the existing custom-tool machinery.

The builder will produce a governed policy like:

    {
      "appTools": [
        {
          "type": "custom",
          "name": "posthog_events_page",
          "displayName": "Fetch PostHog events page",
          "description": "Fetches one bounded page of PostHog events for deterministic dashboard processing.",
          "enabled": true,
          "integration": {
            "name": "PostHog",
            "domain": "posthog.com",
            "keySlug": "default"
          },
          "endpoint": {
            "method": "GET",
            "url": "https://app.posthog.com/api/projects/{{projectId}}/events/",
            "headers": {
              "Authorization": "Bearer {{secrets.POSTHOG_PERSONAL_API_KEY}}"
            },
            "queryParams": {
              "after": "{{after}}",
              "before": "{{before}}",
              "offset": "{{offset}}",
              "limit": "{{limit}}"
            }
          },
          "mockData": [
            {
              "results": [
                { "distinct_id": "user_123", "event": "$pageview", "properties": { "path": "/pricing" } }
              ],
              "next": null
            }
          ]
        }
      ],
      "agents": []
    }

The exact PostHog domain may need to support `us.posthog.com`, `eu.posthog.com`, or self-hosted hosts. That provider-specific detail should be researched during actual app building, not hardcoded platform-wide.

The execution route should not trust the iframe with this spec. The iframe should send:

    {
      "toolName": "posthog_events_page",
      "input": {
        "projectId": "123",
        "after": "2026-05-01",
        "before": "2026-05-20",
        "offset": 0,
        "limit": 100
      }
    }

The route should:

1. Authenticate the browser request with `requireWorkspaceContext`.
2. Resolve app visibility with `resolveAppAccess`.
3. Enforce that `version=draft` is only available to creators/collaborators/admins/owners.
4. Load the appropriate approved payload:
   - draft: current draft `agents.json` hash must match `app.agentsJsonApprovalHash`, and payload comes from `app.agentsJsonApprovedPayload`.
   - published: payload comes from `app.publishedAgentsJsonApprovedPayload`.
5. Find an enabled top-level `appTools[]` item by `name`.
6. Execute the canonical server-loaded spec with shared integration execution code.
7. For static secrets, resolve the app-scoped grant and inject named secrets server-side.
8. For OAuth, resolve the connected account using the authenticated viewer's user ID from `requireWorkspaceContext`.
9. Return `{ success, data, mock, mockReason?, statusCode?, error? }`.
10. Record compact audit events without request bodies, response bodies, secrets, headers, tokens, prompts, source files, or full provider documents.

To avoid duplicating `/api/internal/tool-execute`, move most of the current helper code into a shared module, for example `apps/web/src/lib/integrations/execute-http-action.ts`. The existing internal route and the new browser route should both call that module with different identity/policy contexts.

The generated app SDK should expose a promise-based call, not just a React hook, because deterministic work often belongs in plain async helper code:

    export type IntegrationToolResult<TData> = {
      success: boolean;
      data: TData;
      mock: boolean;
      mockReason?: string;
      statusCode?: number;
      error?: string;
    };

    export async function callIntegrationTool<TInput extends Record<string, unknown>, TData>(
      toolName: string,
      input: TInput,
    ): Promise<IntegrationToolResult<TData>>;

An optional hook can be added for convenience:

    export function useIntegrationTool<TInput extends Record<string, unknown>, TData>(
      toolName: string,
    ): {
      execute: (input: TInput) => Promise<IntegrationToolResult<TData>>;
      loading: boolean;
      error: string | null;
    };

The builder can then create typed provider wrappers in generated source. The platform should not try to infer provider-specific types. Type safety comes from generated TypeScript wrappers and the generic SDK call.


## Phased Implementation Plan


### Phase 1: Define Governed App Tool Policy


Purpose:

Allow `agents.json` to define app-callable integration actions even when no app agents exist.

Files and code areas touched:

- `apps/web/src/lib/agents/agents-governance.ts`
- `apps/worker/src/runner.ts`
- `apps/web/src/components/ai-elements/agents-card.tsx`
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/agents/route.ts`
- `docs/app-agents.mdx`
- `docs/integrations.mdx`

Implementation scope:

- Introduce a shared type/concept for an approved custom HTTP action spec:
  - `type: "custom"`
  - `name`
  - `displayName?`
  - `description?`
  - `enabled?`
  - `integration`
  - `endpoint`
  - `mockData`
  - `responseSchema?`
- Add optional top-level `appTools?: CustomHttpActionSpec[]` to the accepted `agents.json` payload.
- Update `readAgentsJsonSnapshot` validation so a payload is valid when it has either:
  - a non-empty `agents` array, or
  - a non-empty `appTools` array.
- Reuse existing custom-tool validation rules for `appTools`.
- Keep normal `agents[].tools[]` behavior unchanged.
- Update `present_agents` output to include both `agents` and `appTools`.
- Extend `AgentsCard` to render a compact "App actions" or "App API actions" section with integration domain, key slug, method/host, auth type, and enabled state.
- Keep the existing approval route and app document fields.

Why this phase is ordered here:

The browser execution route must have a governed policy source before it can safely execute anything.

Human verification:

- Inspect `agents.json` examples with only `appTools` and confirm `present_agents` would return `ok: true`.
- Inspect an invalid app tool with a missing endpoint or invalid secret placeholder and confirm validation blocks approval.
- Confirm normal agent-only `agents.json` remains accepted.

Observable success:

- The approval card can represent app-callable integration actions.
- A no-agent app can still have an approved integration action policy.

Rollback/retry/safety:

- This phase is additive. If the card rendering has issues, the policy can still be validated in worker output while the UI is fixed.
- Do not remove support for existing `agents` arrays or existing custom tool fields.


### Phase 2: Refactor Shared Integration HTTP Execution


Purpose:

Avoid duplicating the security-sensitive custom HTTP executor when adding direct app calls.

Files and code areas touched:

- `apps/web/src/app/api/internal/tool-execute/route.ts`
- New helper such as `apps/web/src/lib/integrations/execute-http-action.ts`
- Possibly `apps/web/src/lib/integrations/action-policy.ts`
- `apps/web/src/lib/db/repositories/integrations.ts`
- `apps/web/src/lib/oauth/token-broker.ts` only if the existing API needs a small identity wrapper
- `apps/web/src/lib/audit/event-explanations.ts`

Implementation scope:

- Move reusable helper functions from `/api/internal/tool-execute` into a library:
  - endpoint template substitution
  - secret placeholder detection
  - input placeholder detection
  - public unauthenticated detection
  - domain normalization and hostname matching
  - DNS/private-IP checks
  - request timeout and response-size enforcement
  - mock response selection
  - static secret lookup
  - OAuth token acquisition
- Model two execution identities:
  - app-agent execution: actor is the approved app agent, OAuth user is loaded from `app_agent_runs` by `workspaceId + appId + runId`.
  - app-runtime execution: actor is the authenticated user, OAuth user is `workspaceContext.user._id`.
- Keep `/api/internal/tool-execute` behavior compatible for existing app agents.
- Prefer executing the canonical approved spec rather than trusting caller-provided endpoint data. If this creates too much churn for the internal route, keep the comparison first and promote canonical execution in the browser route.

Why this phase is ordered here:

The new route should use the same hardened execution implementation from day one. Duplicating this code would increase the chance of missing a guard.

Human verification:

- Review the refactor diff to confirm no guard was lost.
- Confirm the internal route still requires `workspaceId`, `appId`, `agentId`, `toolName`, and `toolSpec`.
- Confirm app-agent custom tools still return mock data for missing setup and still deny unapproved draft tools.

Observable success:

- Existing app-agent custom tool execution remains behaviorally unchanged.
- Shared helper exposes a small interface that the direct app route can call.

Rollback/retry/safety:

- Keep the original route tests or manual fixtures around while refactoring.
- If the refactor becomes risky, first add the direct route by calling a smaller extracted "fetch external request" helper and leave the full internal route mostly intact, then consolidate after behavior is verified.


### Phase 3: Add Browser Route for App Integration Actions


Purpose:

Create the server endpoint that generated app code can call through the parent bridge.

Files and code areas touched:

- New route, likely `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/app-tools/[toolName]/execute/route.ts`
- `apps/web/src/lib/auth/app-access.ts`
- `apps/web/src/lib/agents/agents-governance.ts`
- Shared execution helper from Phase 2
- `apps/web/src/lib/audit/event-explanations.ts`

Implementation scope:

- Add `POST /api/workspaces/[workspaceId]/apps/[appId]/app-tools/[toolName]/execute?version=draft|published`.
- Authenticate with `requireWorkspaceContext`.
- Resolve app with `resolveAppAccess`.
- For `version=draft`, require `access.canCollaborate`.
- For `version=published`, allow any visible app viewer.
- Load app metadata and source files needed to verify draft approval.
- For draft:
  - if current draft policy is missing approval, return a clear `403` such as `app_tools_approval_required`.
  - if approval source is `build_chat_mock`, return mock data only, matching existing non-admin agent approval behavior.
- For published:
  - require `publishedAgentsJsonApprovedPayload` to contain an enabled `appTools` item with the requested name.
- Execute only the canonical server-loaded `appTools` item.
- Return compact JSON compatible with SDK result types.
- Record audit events with category `tools`, source `app_iframe`, actor `user`, target `tool`, and metadata limited to tool name, integration domain/key slug, source version, status code, auth type, provider key if OAuth, mock flag, and integration ID.

Why this phase is ordered here:

This is the first user-visible platform capability. It depends on the governed policy and shared executor.

Human verification:

- With an approved draft `appTools` payload and configured integration, POST to the route with a small input and observe a live provider response.
- With missing setup, observe mock data and `mock: true`.
- With an unapproved draft change, observe `403`.
- With a published app, observe the route uses `publishedAgentsJsonApprovedPayload`, not draft source.

Observable success:

- A browser-authenticated request can execute an app action without an app-agent run.
- A normal member cannot access draft actions.
- A visible published viewer can use published actions.
- Cross-workspace or cross-app IDs return `404`/scoped failure through existing guard/access behavior.

Rollback/retry/safety:

- The route is additive. If issues appear, generated apps without the new SDK will be unaffected.
- Do not expose this through `/api/internal`.


### Phase 4: Add Generated SDK and Parent Bridge


Purpose:

Make the feature usable from generated app code inside the sandboxed iframe.

Files and code areas touched:

- `apps/worker/src/workspace-template.ts`
- New component such as `apps/web/src/components/app-integration-bridge.tsx`
- `apps/web/src/components/app-workspace.tsx`
- Possibly docs in `docs/app-agents.mdx` or a new docs subsection in `docs/integrations.mdx`

Implementation scope:

- Add SDK types:
  - `IntegrationToolResult<TData>`
  - `callIntegrationTool<TInput, TData>(toolName, input)`
  - optionally `useIntegrationTool<TInput, TData>(toolName)`
- Add postMessage protocol:
  - iframe -> parent: `second:integration:execute` with `{ requestId, toolName, input }`
  - parent -> iframe: `second:integration:execute-response` with `{ requestId, toolName, success, data, mock, mockReason?, statusCode?, error? }`
- Add `AppIntegrationBridge` that:
  - validates `event.source === iframeRef.current.contentWindow`
  - validates `data.source === "second-app"`
  - calls the new browser route with current `workspaceId`, `appId`, and `sourceVersion`
  - returns success or failure responses to the iframe
- Mount `AppIntegrationBridge` in `AppWorkspace` next to `AppDataBridge` and `AppAgentBridge` when preview is shown.
- Keep bridge request/response scoped and one-shot. Do not add polling, SSE, or workspace realtime subscriptions.

Why this phase is ordered here:

The route can be tested directly first. Then the iframe SDK and bridge provide the generated app experience.

Human verification:

- Inspect the generated `src/lib/second-sdk.ts` template and confirm TypeScript generics compile.
- Build a tiny generated app helper that calls `callIntegrationTool` and renders loading/error/mock states.
- In browser QA, trigger a call from the preview iframe and observe the response renders without exposing secrets.

Observable success:

- App code can call `await callIntegrationTool("tool_name", input)`.
- The platform route receives the request from the parent bridge, not directly from the sandboxed iframe.
- Failed calls return typed errors rather than hanging promises.

Rollback/retry/safety:

- This is additive to the SDK. Existing generated apps still compile because existing exports are unchanged.
- Keep function names explicit; avoid overloading existing `useAgent` semantics.


### Phase 5: Update Builder Guidance and Integration Instructions


Purpose:

Teach builder agents when to use app-callable integration actions instead of app agents.

Files and code areas touched:

- `apps/web/src/lib/agent/system-prompt.ts`
- `apps/worker/src/builder-skills.ts`
- `docs/integrations.mdx`
- `docs/app-agents.mdx`
- Possibly `docs/app-preview.mdx` or `docs/agent-system.mdx`

Implementation scope:

- Update planning guidance:
  - `present_plan.backend` can summarize app-callable integration actions when needed.
  - The builder should choose app tools for deterministic fetch/process/display tasks.
  - The builder should choose app agents only when reasoning, generation, autonomous decisions, or natural-language workflows are needed.
- Update integration guidance:
  - Builder calls `list_app_integration_keys` before deciding setup for app tools too.
  - Builder writes top-level `appTools` in `agents.json` for direct app calls.
  - Builder writes `integration-setup.json` for app tool setup requirements.
  - If an app tool and an agent tool use the same provider/key, use the same `keySlug` and union the requirements.
  - If the app tool needs separate credentials or materially different permissions, use a separate `keySlug`.
- Update bounded response guidance:
  - App tools may return data to app code, not an agent, but still need per-request bounds.
  - Prefer pagination and deterministic app-side aggregation for bulk data.
- Add examples for PostHog-style paginated fetch wrappers.

Why this phase is ordered here:

The platform capability must exist before the builder is told to use it. Prompt changes too early would make builders produce unsupported files/code.

Human verification:

- Read the prompt sections and confirm they no longer claim custom backend is unavailable.
- Confirm the prompt still enforces setup instructions and approval before app implementation.
- Confirm the prompt does not tell agents to expose secret values or call provider APIs from browser code directly.

Observable success:

- Builder plans can mention app-callable integration actions.
- Generated app code imports the SDK and writes typed wrappers rather than creating app agents for deterministic fetch work.

Rollback/retry/safety:

- Prompt/docs changes can be reverted independently if runtime support is not ready.


### Phase 6: Validation, Security Review, and Manual QA


Purpose:

Prove the feature works, does not regress app-agent tools, and preserves tenant isolation/security.

Files and code areas touched:

- All files above.
- Any test or fixture files added during implementation.
- `QA/` only if the implementation task explicitly asks to run QA or document QA.

Implementation scope:

- Add focused unit-style coverage if there is a suitable local pattern. If not, add small pure helper tests only where a runner exists or keep validation through TypeScript and manual route fixtures.
- Run repository typecheck.
- Manually exercise direct app route behavior with mocked/unconfigured integrations.
- Run browser QA only when allowed by the user/repo instructions.

Why this phase is ordered here:

The route and bridge must be validated together after implementation.

Human verification:

- Create or use a local app with an approved `appTools` payload.
- Configure or intentionally leave unconfigured a test integration.
- Trigger the SDK call from preview and observe live or mock response.
- Confirm secret values never appear in browser devtools response payloads, iframe source, realtime events, or audit metadata.

Observable success:

- Deterministic app code fetches provider data through Second.
- App agents still execute existing custom tools.
- Draft/published and cross-tenant checks behave correctly.

Rollback/retry/safety:

- If live provider credentials are not available, mock behavior is still a valid partial verification.
- If browser QA requires a dev server and none is running, read `.second-dev.txt` after starting `npm run dev` only when the user has requested QA or allowed it.


## Concrete Steps and Commands


All commands should run from the repository root:

    cd /Users/omervexler/.codex/worktrees/9029/second

Research and file orientation commands used for this plan:

    sed -n '1,260p' PLANS.md
    sed -n '1,620p' docs/integrations.mdx
    sed -n '1,620p' docs/app-agents.mdx
    sed -n '1,260p' docs/worker.mdx
    sed -n '1,340p' docs/guard-and-tenancy.mdx
    sed -n '1,280p' docs/app-data.mdx
    rg -n "agents\\.json|integration-setup\\.json|tool-execute|present_agents|list_app_integration_keys" apps/web/src apps/worker/src

Implementation validation commands:

    npm run typecheck

Expected result:

- `npm run typecheck` completes with no TypeScript errors in `apps/web` or `apps/worker`.

Optional targeted manual route verification after implementation:

    # Use the actual local URL from .second-dev.txt if browser/server QA is allowed.
    # Browser-authenticated routes should be tested from the app UI or browser session,
    # not by pasting cookies into scripts.

Browser QA rules:

- Do not assume `localhost:3000`.
- If the dev server is already running, read `.second-dev.txt` and use its `url=` value.
- If no matching dev server is running, start `npm run dev` only when the user explicitly asks for browser QA or grants the permission described in `AGENTS.md`.


## Validation and Acceptance


Acceptance criteria:

- A generated app can call a named app integration action from `src/App.tsx` or a helper file without defining or running an app agent.
- The iframe sends only `toolName` and typed input. It never sends endpoint URLs, secret placeholders, OAuth metadata, or credential IDs.
- The server resolves the canonical approved app tool spec from the app's approved policy payload.
- Draft app calls require collaborator/admin/owner/creator access and an approved current draft policy.
- Published app calls use the published approved policy and published app access rules.
- Static API keys are injected server-side from this app's integration grant only.
- OAuth app calls use the current authenticated viewer's connected account within the same workspace/provider config.
- Missing or unconfigured integrations return mock data using the approved tool's `mockData`.
- Domain/protocol/private-IP guards remain active.
- Per-request response size and timeout limits remain active.
- Existing app-agent custom tool execution still works.
- Existing `useCollection`, `useDoc`, `useAgent`, and `useAgentList` SDK APIs still work.
- Integration setup for app tools appears in Settings -> Integrations and uses the same app-scoped grant model.
- When an app tool and an agent tool use the same `domain + keySlug`, one configured grant satisfies both if permissions/secrets/scopes match the unioned requirements.
- Audit events are compact and redacted.

Security review checklist:

- Tenant isolation: every route query includes `workspaceId`; app lookup is by `workspaceId + appId`; integration lookup is by `workspaceId + appId + domain + keySlug`; OAuth account lookup is by `workspaceId + userId + providerConfigId`.
- Browser trust: the parent bridge validates `event.source` against the expected iframe window; the route authenticates the browser session; the iframe cannot choose endpoints or credentials.
- Secrets: no secret values, Vault IDs, OAuth access tokens, refresh tokens, client secrets, headers, cookies, or provider token responses are returned to agents, iframes, logs, audit metadata, or realtime events.
- Approval: live execution requires approved policy, not draft model output alone.
- Draft/published: draft callers cannot mutate or use published policy accidentally; published callers cannot use unreviewed draft tools.
- SSRF: hostname must match integration domain/subdomain, HTTPS is required in production, and private/internal IPs are rejected after DNS resolution.
- Response bounds: keep bounded per-request response size and timeout. For bulk APIs, use pagination.
- Audit: audit metadata is compact and redacted; response bodies and request bodies are not logged.

Performance and realtime safety checklist:

- Hot-path data shape: app metadata and sidebar reads must not load source files, provider responses, or full tool specs. New route loads approved payload only when an app action is executed.
- Read-vs-write behavior: GET/read paths remain read-only. The new action execution route is POST because it can call external APIs and may trigger OAuth token refresh.
- Realtime invalidation source: executing an app action should not publish workspace realtime events unless it mutates Second state, such as token refresh audit/storage. It should never publish provider responses.
- Duplicate-request prevention: SDK calls are explicit promises. Do not add component-local polling or background retries by default. Generated app code can implement deliberate pagination.
- Multi-tab/multi-user behavior: each tab calls through its authenticated session; OAuth identity is the current viewer; no global in-memory state should mix users.
- Chat/run streaming behavior: direct app actions do not start builder runs, app-agent runs, worker sessions, or SSE streams.
- Tenant isolation: route and repositories scope all app, integration, OAuth, and audit queries by workspace and app.
- Staging validation: test one draft collaborator, one published member viewer, one missing integration, one mock-only approval, and one configured integration if credentials are available.


## Idempotence and Recovery


- The policy extension is additive. Existing `agents.json` files with only `agents` remain valid.
- `integration-setup.json` sync already upserts current app grants and deletes stale grants. During implementation, ensure app tools are included in the complete current requirements before calling `present_integration_setup`.
- If a builder changes `agents.json`, existing approval staleness behavior should require reapproval before live app actions run.
- If an app action route fails because the integration is unconfigured, it should return mock data rather than borrowing credentials from another app.
- If OAuth refresh fails, return a structured failure and record a redacted audit event. Do not clear unrelated connected accounts or grants.
- If the SDK call times out or receives non-JSON from the parent bridge, resolve/reject cleanly so generated UI can show an error state.
- If implementation of top-level `appTools` is later replaced by a cleaner `runtime.json` or `integrations.json`, migrate by reading both old and new locations for at least one release and keeping the same approval semantics.


## Interfaces and Dependencies


New or changed interfaces:

- `agents.json` payload:

      type AgentsRuntimePolicy = {
        agents?: AgentDefinition[];
        appTools?: CustomHttpActionSpec[];
      };

- `CustomHttpActionSpec` should share shape with current custom agent tools:

      type CustomHttpActionSpec = {
        type: "custom";
        name: string;
        displayName?: string;
        description?: string;
        enabled?: boolean;
        integration: {
          name: string;
          domain: string;
          keySlug?: string;
          auth?: IntegrationAuthConfig;
        };
        endpoint: {
          method: string;
          url: string;
          headers?: Record<string, string>;
          queryParams?: Record<string, string>;
          body?: unknown;
        };
        responseSchema?: unknown;
        mockData: unknown[] | unknown;
      };

- SDK:

      callIntegrationTool<TInput extends Record<string, unknown>, TData>(
        toolName: string,
        input: TInput,
      ): Promise<IntegrationToolResult<TData>>

- postMessage:

      second:integration:execute
      second:integration:execute-response

- New route:

      POST /api/workspaces/[workspaceId]/apps/[appId]/app-tools/[toolName]/execute?version=draft|published

Existing dependencies to reuse:

- `requireWorkspaceContext`
- `resolveAppAccess`
- `getAppSourceFilesForVersion`
- `getDraftAgentsJsonApproval`
- `findIntegrationGrantForTool`
- `integrationNeedsSetup`
- `findOAuthProviderConfigForWorkspace`
- `findConnectedAccountForUserProvider`
- `getValidOAuthAccessToken`
- `recordAuditEvent`
- `integration-setup.json` sync through `/api/internal/integration-requirements`


## Artifacts and Notes


Linear issue summary:

- Issue: SEC-141, "App backends"
- URL: `https://linear.app/second-inc/issue/SEC-141/app-backends`
- Priority: Urgent
- Status at planning time: In Progress
- Description: "not just tools for agents. sometimes you just need an api fetch and some pre/post processing and custom code (or multiple fetches). the builder should write an api the app can consume using the sdk. meaning, it should build the \"backend\" and call it in the app. one good example: fetching 100s of posthog events..."

Recommended v1 app pattern:

    // src/lib/posthog.ts, generated by the builder
    import { callIntegrationTool } from "@/lib/second-sdk";

    export type EventsPageInput = {
      projectId: string;
      after?: string;
      before?: string;
      offset?: number;
      limit?: number;
    };

    export type EventsPage = {
      results: Array<{
        distinct_id?: string;
        event?: string;
        properties?: Record<string, unknown>;
      }>;
      next?: string | null;
    };

    export async function fetchEventsPage(input: EventsPageInput) {
      const response = await callIntegrationTool<EventsPageInput, EventsPage>(
        "posthog_events_page",
        { limit: 100, offset: 0, ...input },
      );
      if (!response.success) throw new Error(response.error ?? "PostHog request failed");
      return response.data;
    }

    export function groupEventsByUser(events: EventsPage["results"]) {
      return events.reduce<Record<string, EventsPage["results"]>>((groups, event) => {
        const userId = String(event.distinct_id ?? "unknown");
        groups[userId] ??= [];
        groups[userId].push(event);
        return groups;
      }, {});
    }

Important note:

- The platform should not claim to provide a full backend runtime after this work. It provides app-callable integration actions. That distinction matters because generated server code, persistent jobs, queues, and private compute are intentionally out of scope for v1.


## Outcomes & Retrospective


Not yet implemented. Update this section after implementation and validation with:

- What shipped.
- Any deviations from the plan.
- Validation results.
- Known limitations, especially response-size/pagination and OAuth identity semantics.


## Change Notes


- 2026-05-20, Codex: Initial plan created from SEC-141, repository docs, and source inspection.


## Captured User Intent (Verbatim)


Codex, solve [@linear](plugin://linear@openai-curated) issue SEC-141.
The whole point here is that let's say I have an app that needs to fetch, I don't know, thousands of post-hoc logs, okay. Because I want to build a dashboard for myself that's relying on post-hoc information. and all I need is to get all of these logs and group them by user ID. Obviously this is a deterministic task. This is not a task for an AI agent. For two reasons:
1. AI agents are not deterministic no matter how you will look at it. Even given instructions we don't know exactly which tools they might use. 
2. The second problem is that they have a limited context window. APIs calls don't. And this happened to me actually: an app created a tool for an agent to use a posthog API but actually the agent couldn't complete the request because it was too long for him (the response i mean).

What we need is basically the builder agent to be able to create a typed SDK that when it's creating the code of the app, for example, when he edits App.tsx - it should be able to just call this API. This should run somewhere. I have no idea where and just work and return this response. Or by the way this can be MUCH MUCH SIMPLER- which is, by the way, what I prefer for now because the core idea of what I needed to understand is that we need to ship now we must ship something that will work and will have the most minimal amount of code, the most minimal amount of moving parts. Why is that? My philosophy is that every time we add more moving parts, or more workarounds, or more hacky stuff, or more things to the architecture that touch other components, things will break. This is inevitable not because of you but even maybe because of me because I would make a change that I'm not aware of something that you did, for example...

And so what I'm trying to say here is that maybe we have a solution where the only thing that we need to add is an ability to be able to call, for example from the App.tsx to something that just resembles a custom tool call, and the rest of the processing will be just inside of the App.tsx or any other file that App.tsx uses...

So obviously we're talking about connecting to third-party tools and APIs- and this means that it should use the API keys that the user inputs, just like the integrations. Actually it should be just an integration, but one that's used from within the App.tsx. Now regarding security we had this whole thing where the agent couldn't see the API keys, correct? We have this thing that can call for the agent on behalf of them so maybe we should use it here. I'm not even sure. 

But definitely one of the most important things is that this should work even if there is no custom tool for an agent. For example if my app just lists post-hoc events and then groups them by a user ID, the builder agent should definitely create this integration and it should definitely create integration connection instructions. The third thing is that obviously the app itself should be able to call it and receive the response. The thing is that I'm not sure that today it's possible to define a tool without agents.json - so maybe we need another thing which is called integrations.json ? I'm not even sure. And then what about if there is an integration that's needed for the app but also we would like an agent to use a tool relating to the same integration? You need to figure this out but again with the least amount of new moving parts and the least amount of changes generally.

Create a plan for that, then pause. Please start by identifying the relevant docs for you to get a recap about the integrations and agents.json . Then read key files as eventually code is the source of truth.
