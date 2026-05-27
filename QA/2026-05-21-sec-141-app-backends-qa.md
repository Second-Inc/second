# SEC-141 App Backends QA

Date: 2026-05-21  
Tester: Codex  
Browser: Chrome via Codex Chrome extension  
Dev URL: `http://sec141-add-typed-api-sdk.second.localhost:1355`  
Workspace: `second` / Second  
User: `john@doe.com` / John Doe / Founder  
App: PostHog QA Dashboard  
App ID: `6a0ec97795ab4d77af5f89b1`  
Builder run ID: `6a0ec97795ab4d77af5f89b2`  
Runtime/model: Codex CLI / `gpt-5.5`

## Scope

Manual browser QA for SEC-141 app-callable integration actions using a mock-mode PostHog dashboard. The scenario intentionally did not configure a PostHog API key.

Prompt summary:

- Build a compact PostHog events dashboard.
- Use `agents.json` with top-level `appTools` only; no app agents.
- Add one custom app action, `posthog_events_page`, for `posthog.com`.
- Add `integration-setup.json` for `POSTHOG_PERSONAL_API_KEY`.
- Return exactly 50 mock events across four `distinct_id` values.
- Use `callIntegrationTool` from app code and group events by user ID.

## Results

| Area | Status | Evidence |
| --- | --- | --- |
| Local onboarding and workspace creation | Pass with note | Created local identity and workspace. The onboarding context agent ran slowly, so I completed onboarding via the app's own context/complete APIs with empty context to keep QA focused on SEC-141. |
| Builder plan approval | Pass | Builder presented and accepted the PostHog dashboard plan. |
| `appTools`-only approval card | Pass after fix | The card rendered `1 app action`, no agents, and showed the PostHog `GET https://app.posthog.com/api/projects/{{projectId}}/events/` action. A bug initially left Approve disabled for appTools-only configs; fixed during QA. |
| Generated app source | Pass | Builder self-check reported `{ appTools: 1, agents: 0, mockPages: 1, mockEvents: 50, users: [qa-user-001..004] }`. |
| Integration setup sync | Pass | Builder created `integration-setup.json`; UI showed `Connect PostHog to your app` setup link. |
| Generated app typecheck | Pass | Generated workspace ran `npm run typecheck` successfully. |
| App preview mock execution | Pass | Preview showed `Mock mode`, `HTTP 200`, 50 events, 4 users, 8 paths, 5 event types, and per-user grouping counts. |
| Iframe bridge and app tool route | Pass | Server logs showed `POST /api/workspaces/second/apps/6a0ec97795ab4d77af5f89b1/app-tools/posthog_events_page/execute?version=draft 200` on initial load and after refresh. |
| Audit events | Pass | Audit API returned `tool.custom.mocked` with `source: app_iframe` and summary `Used mock data for custom tool posthog_events_page.` |
| Browser console | Pass | Chrome console error/warning query returned `[]`. |

## Bugs

### SEC-141-QA-1: appTools-only approval was not considered pending

Status: Fixed and re-tested.

Repro:

1. Create an app whose `agents.json` has top-level `appTools` and no `agents`.
2. Let the builder call `present_agents`.
3. Observe the rendered approval card.

Expected:

The approval card should become the active pending approval when either `agent_count > 0` or `app_tool_count > 0`.

Observed:

The card rendered correctly but `Approve` was disabled because `pendingBlockingApprovalFromMessages` skipped all `present_agents` calls with `agent_count === 0`.

Impact:

AppTools-only apps could not continue through the governed approval flow from the UI.

Fix:

Updated `apps/web/src/components/app-chat.tsx` so `present_agents` is skipped only when both `agent_count === 0` and `app_tool_count === 0`.

## Validation

- Root `npm run typecheck`: pass.
- Chrome manual QA: pass after the approval-state fix.
- Dev server remained on the worktree URL from `.second-dev.txt`.
