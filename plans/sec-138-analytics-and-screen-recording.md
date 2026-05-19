# Implement SEC-138 analytics detail and screen recording


This plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Change Notes` current as the work evolves. This file must remain consistent with `PLANS.md`.


## Overall Goal


Implement Linear issue SEC-138 by enriching approval-related product analytics in non-anonymized mode and adding an explicit, off-by-default PostHog screen recording option to the existing usage data dialog.


## Goal Description / Sub-goals


The work has two user-visible outcomes:

- When Second records approval analytics such as `approval shown`, the event should include useful details about what was shown when analytics is non-anonymized. The same data must remain stripped when the user's anonymized usage setting is on.
- The Usage data dialog should offer a separate screen recording opt-in. The option must default off, explain that Local Second is free and that recordings help improve it, and start PostHog session replay only when the user explicitly enables it in non-anonymized mode.

The implementation must keep the current security posture:

- Existing server-mediated analytics events still go through `/api/analytics/capture` for authentication, tenant checks, event allowlisting, sanitization, and anonymization.
- Screen recording is the only browser-direct PostHog path, because PostHog session replay is implemented by the browser SDK.
- Screen recording must not silently run while the Usage data dialog still says anonymization is enabled.
- No PR or git workflow should be run for this task.


## Motivation


SEC-138 asks for better product debugging data. Today an event can say an approval was shown, but for agent approvals it is not obvious which agents, tools, integrations, or counts were shown. That makes the analytics less useful when the user has already opted into identifiable analytics.

The issue also asks for an explicit screen recording opt-in. Screen recording is more invasive than lightweight analytics, so it should be off by default and separately controlled. When the user opts in, the product should treat it as intentionally un-anonymized sharing and record the full app experience through PostHog replay.


## State Before


Product analytics are already implemented in `apps/web/src/lib/analytics.ts` and `apps/web/src/app/api/analytics/capture/route.ts`.

Important current behavior:

- Browser code calls `captureAnalyticsEvent(...)`.
- Client-side `preparedProperties(...)` removes identifiers when `anonymizeUsageData` is on.
- Server-side `/api/analytics/capture` repeats sanitization and anonymized-property stripping, then forwards to PostHog.
- Non-anonymized mode identifies the onboarded user through `/api/analytics/identify`.
- `approval shown` is emitted from `apps/web/src/components/app-chat.tsx` with only `workspace_id`, `app_id`, `run_id`, `tool_call_id`, and `approval_type`.
- `agents approved` already sends detailed agent IDs, names, tool counts, and data collection counts, but only after the approval action.
- `analytics-consent-dialog.tsx` only exposes the anonymization toggle.
- There is no `posthog-js` dependency and no browser PostHog SDK initialization.
- Sentry replay privacy is managed separately through `apps/web/src/lib/sentry-client-consent.ts`; this task is about PostHog screen recording, not Sentry replay.


## State After


After the change:

- `AnalyticsConsent` has a new persisted boolean for PostHog screen recording, defaulting to `false`.
- The Usage data dialog shows a compact, polished screen recording callout and toggle below the anonymization setting. Enabling recording turns off anonymization because SEC-138 explicitly wants this only for un-anonymized sharing.
- Re-enabling anonymization turns screen recording off.
- A client-only PostHog replay controller initializes `posthog-js` only when screen recording is enabled, uses the configured public PostHog token/host, identifies the current user, and starts session recording. It stops recording and resets the SDK when disabled or when consent changes.
- Normal product analytics events still use `/api/analytics/capture`; the PostHog browser SDK should not add duplicate pageview/autocapture product events.
- `approval shown` includes structured, bounded details about the pending approval payload. For agents this includes agent count, agent IDs/names, tool counts, integration counts, auth kinds, and data collection counts. For suggestions and plans it includes analogous counts/titles/section-presence metadata where available.
- Anonymized analytics still strips identifiers and names through both client and server filters.
- Product analytics docs describe the new screen recording consent and its direct PostHog replay path.


## Context and Orientation


Second is a Next.js app in `apps/web` with workspace-scoped auth and tenant isolation. Browser analytics calls are deliberately sent to same-origin API routes instead of PostHog directly, so the web server can authenticate the user, prove workspace membership, sanitize properties, apply anonymization, and add release metadata before forwarding to PostHog.

Screen recording is different. PostHog session replay is a browser SDK feature that records DOM/session snapshots from the browser. PostHog's current docs say manual control is done by initializing with `disable_session_recording: true`, then calling `posthog.startSessionRecording()` and `posthog.stopSessionRecording()`. The JavaScript SDK config also supports `disable_session_recording`, `capture_pageview`, `autocapture`, `capture_pageleave`, `mask_all_text`, and `mask_all_element_attributes`.

The relevant user interface is `apps/web/src/components/analytics-consent-dialog.tsx`. It is mounted from the workspace layout after onboarding, receives the current `AnalyticsIdentity`, writes local consent to `localStorage`, updates Sentry consent state, and sends the onboarding analytics event.

The relevant approval analytics source is `apps/web/src/components/app-chat.tsx`. It parses AI SDK dynamic tool parts for `mcp__second__present_plan`, `mcp__second__present_suggestions`, and `mcp__second__present_agents`, decides when a blocking approval is pending, renders the corresponding card, and emits approval analytics.


## Relevant Files and Code Areas


- `apps/web/package.json`: needs `posthog-js` as a runtime dependency for browser replay.
- `apps/web/package-lock.json`: must be updated with the dependency resolution.
- `apps/web/src/lib/analytics.ts`: owns consent shape, normalization, localStorage persistence, anonymous distinct IDs, identify calls, product event preparation, and consent subscriptions.
- `apps/web/src/lib/posthog-screen-recording.ts`: new client-only module to own browser SDK lifecycle and keep replay behavior out of generic analytics capture.
- `apps/web/src/app/api/analytics/config/route.ts`: new small authenticated route that returns the public PostHog token/host so client replay can respect server-side `SECOND_POSTHOG_*` config without exposing anything private.
- `apps/web/src/components/analytics-consent-dialog.tsx`: add the screen recording callout/toggle, consent interactions, and invocation of the replay controller.
- `apps/web/src/components/app-chat.tsx`: enrich pending approval metadata at `approval shown` time and reuse existing parsing helpers for agents, suggestions, and plans.
- `apps/web/src/app/api/analytics/capture/route.ts`: may need anonymized omit-key additions for any new detailed properties that include names, titles, IDs, or raw text.
- `docs/product-analytics.mdx`: document the new screen recording behavior, default, and privacy model.
- `docs/self-hosting.mdx`: mention that PostHog project token also powers opt-in replay when the user enables screen recording.


## Assumptions and Constraints


- No git commands, branch creation, commit, push, or PR creation are allowed for this task.
- Do not run the dev server unless explicitly asked for browser QA. The final response should tell the user when they can run the app to test.
- It is acceptable to run local package/typecheck commands.
- `SECOND_POSTHOG_TOKEN` is a public PostHog project token, not a private key. Returning it to the browser for replay is acceptable and consistent with PostHog browser SDK usage.
- The browser SDK should be initialized only for explicit screen recording consent, not for all analytics.
- Screen recording should be stored in local consent and default to off for existing users.
- The user asked not to over-engineer this. Avoid new database persistence or server-side consent tables; the existing local usage data preference model is the right fit.
- The phrase from SEC-138, "Local Second is free to use. This would really help improve it!", should appear as a designed badge/description near the screen recording option.
- Tenant isolation is preserved by keeping normal analytics server-mediated and by not adding workspace data reads/writes to the replay path. The new config route must still require an onboarded user.
- Performance safety checklist:
  - Hot-path data shape: approval analytics additions are small bounded arrays/counts only; no prompts, files, full tool endpoints, or source snapshots.
  - Read-vs-write behavior: the config route is a read-only GET and must not mutate state.
  - Realtime invalidation source: no new realtime events are needed.
  - Duplicate-request prevention: the replay controller should cache config and only initialize/start/stop when consent or identity changes.
  - Multi-tab/multi-user behavior: consent changes fire the existing localStorage/custom event path; each tab controls its own browser recording state. Anonymous ID reset remains unchanged on sign-out.
  - Tenant isolation: identify payload uses the current onboarded user/workspace identity; config route requires ready auth state.
  - Validation: typecheck, focused inspection, and manual app QA through the dialog and PostHog network/session replay behavior.


## Progress


- [x] (2026-05-19 11:59Z) Loaded Linear SEC-138 and confirmed there are no comments.
- [x] (2026-05-19 11:59Z) Read `PLANS.md`, product analytics docs, architecture/security/streaming/app-preview/self-hosting docs, and the UI reference files required before app UI changes.
- [x] (2026-05-19 11:59Z) Checked current analytics, consent dialog, capture/identify routes, Sentry consent code, app-chat approval analytics, and package dependencies.
- [x] (2026-05-19 11:59Z) Reviewed official PostHog docs for session replay installation, JavaScript config, privacy controls, and manual start/stop recording.
- [x] (2026-05-19 12:05Z) Installed `posthog-js` and implemented client replay consent/lifecycle.
- [x] (2026-05-19 12:05Z) Enriched `approval shown` analytics with bounded plan/suggestion/agent details for non-anonymized mode.
- [x] (2026-05-19 12:05Z) Updated product analytics and self-hosting docs.
- [x] (2026-05-19 12:05Z) Ran validation: `npm --prefix apps/web run typecheck` and `npm --prefix apps/web run lint` both passed.
- [x] (2026-05-19 12:06Z) Ran `npm --prefix apps/web audit --omit=dev`, found one moderate transitive `brace-expansion` advisory under the existing `shadcn -> ts-morph` tree, applied non-force `npm --prefix apps/web audit fix`, and confirmed `npm --prefix apps/web audit --omit=dev` reports zero vulnerabilities.


## Surprises & Discoveries


- Observation: The app currently has no `posthog-js` browser SDK dependency.
  Evidence: `apps/web/package.json` contains Sentry but no PostHog dependency, and `apps/web/node_modules/posthog-js` does not exist.
- Observation: Normal product analytics intentionally avoids direct browser-to-PostHog calls.
  Evidence: `docs/product-analytics.mdx` states browser code posts to `/api/analytics/capture`, whose route allowlists events, sanitizes properties, applies anonymization, and forwards to PostHog.
- Observation: Existing consent includes `shareUsageData`, but `normalizeConsent` currently coerces sharing back to enabled and only treats a prior explicit disable as anonymized mode.
  Evidence: `apps/web/src/lib/analytics.ts` sets `shareUsageData: true` regardless of stored value.
- Observation: PostHog session replay manual control is compatible with an explicit off-by-default setting.
  Evidence: PostHog docs show `disable_session_recording: true`, then `posthog.startSessionRecording()` and `posthog.stopSessionRecording()`.
- Observation: `posthog-js` 1.374.2 exposes typed manual replay controls and supports the 2026 config defaults.
  Evidence: `apps/web/node_modules/posthog-js/lib/src/posthog-core.d.ts` includes `startSessionRecording(...)` and `stopSessionRecording()`, and `@posthog/types` includes `ConfigDefaults = '2026-01-30' | ...`.
- Observation: Installing dependencies surfaced a moderate audit advisory unrelated to PostHog's runtime path.
  Evidence: `npm --prefix apps/web audit --omit=dev` reported `brace-expansion` under `@ts-morph/common`; `npm --prefix apps/web ls @ts-morph/common brace-expansion` showed that path comes through `shadcn -> ts-morph`.


## Decision Log


- Decision: Add a separate local consent field for screen recording instead of reusing `anonymizeUsageData`.
  Rationale: SEC-138 describes screen recording as a separate, ultra-sharing option that should be off by default.
  Date/Author: 2026-05-19 11:59Z / Codex
- Decision: Make screen recording active only when anonymization is off; enabling recording will save both `recordScreen: true` and `anonymizeUsageData: false`.
  Rationale: SEC-138 says the richer analytics and screen recording are only for un-anonymized mode. This prevents a contradictory state where UI says data is anonymized but full replay is recording.
  Date/Author: 2026-05-19 11:59Z / Codex
- Decision: Keep regular analytics on the existing server capture route and use `posthog-js` only for replay.
  Rationale: This preserves the current event allowlist, sanitization, release metadata, tenant checks, and anonymization guarantees while still enabling the browser-only replay product.
  Date/Author: 2026-05-19 11:59Z / Codex
- Decision: Add a tiny authenticated public config route for PostHog replay.
  Rationale: The browser needs token/host for the SDK, and the server already owns the `SECOND_POSTHOG_*` fallback/disabled logic.
  Date/Author: 2026-05-19 11:59Z / Codex


## Plan of Work


First, install `posthog-js` in `apps/web`. The browser SDK will be imported only from a client module. Do not replace existing `/api/analytics/capture` event calls with SDK calls.

Second, extend `AnalyticsConsent` in `apps/web/src/lib/analytics.ts` with a new `recordScreen` boolean. `DEFAULT_CONSENT.recordScreen` is `false`. `normalizeConsent` should preserve `recordScreen` only when the stored value is true and anonymization is false. This guarantees old localStorage entries migrate safely and recording cannot be considered enabled in anonymized mode. `writeAnalyticsConsent` should continue to dispatch `second:analytics-consent-changed`.

Third, add `apps/web/src/app/api/analytics/config/route.ts`. It should call `requireReadyState`, return guard errors using the existing auth response helpers, read `readAnalyticsPublicConfig()`, and return `{ posthogToken, posthogHost }`. This is a read-only route. If telemetry is disabled, it returns an empty token just like capture/identify routes.

Fourth, create `apps/web/src/lib/posthog-screen-recording.ts` as a `"use client"` module. It should:

- Export a function such as `applyPostHogScreenRecordingConsent(consent, identity)`.
- No-op when `window` is unavailable.
- Stop/reset recording if `recordScreen` is false, `anonymizeUsageData` is true, `shareUsageData` is false, or identity is missing.
- Fetch `/api/analytics/config` once and cache the result.
- No-op if `posthogToken` is empty.
- Dynamically import `posthog-js` so the SDK is not part of server code.
- Initialize with `api_host`, `disable_session_recording: true`, `autocapture: false`, `capture_pageview: false`, `capture_pageleave: false`, `capture_dead_clicks: false`, `mask_all_text: false`, `mask_all_element_attributes: false`, and a modern `defaults` value if supported by types.
- Identify the current user with user/workspace properties and start recording with ingestion controls overridden where supported.
- Stop recording and reset the SDK when disabled, anonymization is re-enabled, or identity changes.

Fifth, update `apps/web/src/components/analytics-consent-dialog.tsx`:

- Import a recording-appropriate icon such as `VideoIcon`.
- Add the designed callout/badge above the recording toggle with the exact intent text: "Local Second is free to use. This would really help improve it!"
- Add a `ConsentToggleRow` for "Record this screen to improve Second" or similarly clear wording.
- When the recording toggle is turned on, call `updateConsent({ recordScreen: true, anonymizeUsageData: false })`.
- When anonymization is turned on, call `updateConsent({ anonymizeUsageData: true, recordScreen: false })`.
- Run the new replay controller when identity/consent changes, similar to Sentry consent application.

Sixth, enrich `approval shown` analytics in `apps/web/src/components/app-chat.tsx`:

- Extend `PendingApproval` to carry an `analytics` property or add a helper `approvalShownAnalyticsFromMessages`.
- For agent approvals, parse agents from input or output and include `agent_count`, `agent_ids`, `agent_names`, and a bounded `agents` array with `id`, `name`, `tool_count`, `enabled_tool_count`, `recommended_tool_count`, `custom_tool_count`, `builtin_tool_count`, `integration_count`, `auth_kind`, and `data_collection_count`.
- For suggestions, include `suggestion_count`, `suggestion_title`, and `suggestion_titles`.
- For plans, include `plan_feature_count`, `plan_has_overview`, `plan_has_data_flow`, `plan_has_agents`, `plan_has_backend`, and bounded feature names if useful.
- Keep this data bounded and do not include raw prompts, system prompts, endpoint bodies, headers, secrets, URLs, source files, or full documents.
- Rely on existing client/server anonymized stripping to remove IDs, names, titles, and arrays when anonymization is on. Add omit keys if new property names would otherwise leak text or identifiers in anonymized mode.

Seventh, update docs:

- `docs/product-analytics.mdx` should explain that screen recording is off by default, separate from anonymized product analytics, only active in non-anonymized mode, and uses PostHog browser session replay directly because replay requires the browser SDK.
- `docs/self-hosting.mdx` should mention that the public PostHog token/host also power the explicit screen recording opt-in.


## Phased Implementation Plan


### Phase 1: Consent and replay infrastructure


Purpose: Add the data model, config route, browser SDK dependency, and replay lifecycle without changing the visible dialog yet.

Files and code areas touched:

- `apps/web/package.json`
- `apps/web/package-lock.json`
- `apps/web/src/lib/analytics.ts`
- `apps/web/src/app/api/analytics/config/route.ts`
- `apps/web/src/lib/posthog-screen-recording.ts`

Implementation scope:

- Install `posthog-js`.
- Add `recordScreen` consent normalization and persistence.
- Add read-only authenticated public config endpoint.
- Add a best-effort replay controller that starts/stops PostHog session recording based on consent and identity.

Why this phase is first: The UI should not expose a switch until the underlying state and SDK lifecycle are implemented.

Manual verification:

- Inspect localStorage key `second:analytics-consent:v1`; existing values should read as `recordScreen: false`.
- Call `/api/analytics/config` while signed in and confirm it returns token/host, or an empty token if telemetry is disabled.
- With consent manually set to recording true and anonymized false, the browser should load PostHog and send replay traffic; with recording false it should stop.

Acceptance signals:

- No type errors in the new route or replay module.
- The route does not mutate state.
- Existing analytics capture calls are untouched.

Safety / recovery:

- If SDK initialization fails, catch the error and leave the app usable.
- If the token is empty, do nothing.
- If consent changes to anonymized or recording false, stop/reset the SDK.


### Phase 2: Dialog UI and consent interactions


Purpose: Expose the screen recording opt-in in the Usage data dialog.

Files and code areas touched:

- `apps/web/src/components/analytics-consent-dialog.tsx`

Implementation scope:

- Add a compact callout/badge matching the existing shadcn/Radix restrained style.
- Add the screen recording toggle with clear copy.
- Enforce state transitions: recording on disables anonymization; anonymization on disables recording.
- Invoke the replay controller when consent/identity changes.

Why this phase is ordered here: The UI depends on the consent field and replay controller from Phase 1.

Manual verification:

- Open account menu → Usage data settings.
- Confirm the anonymization toggle still appears and the new recording section is off by default.
- Turn screen recording on and confirm the anonymization switch turns off.
- Turn anonymization back on and confirm screen recording turns off.
- Reload and confirm the saved state persists.

Acceptance signals:

- Dialog text fits in the existing `sm:max-w-md` layout.
- No nested-card visual clutter.
- The "Settings updated" status still works.

Safety / recovery:

- If the new toggle state behaves incorrectly, remove only the `recordScreen` patch and the dialog returns to the previous single-toggle behavior.


### Phase 3: Rich approval analytics


Purpose: Make `approval shown` events useful in non-anonymized mode without leaking details in anonymized mode.

Files and code areas touched:

- `apps/web/src/components/app-chat.tsx`
- `apps/web/src/lib/analytics.ts`
- `apps/web/src/app/api/analytics/capture/route.ts`

Implementation scope:

- Extend pending approval extraction to include bounded analytics metadata.
- Add helper functions for agent, suggestion, and plan approval analytics.
- Add any new sensitive key names to client and server anonymized omit lists.

Why this phase is ordered here: It is independent of replay, but uses the same privacy model and should be completed before final docs.

Manual verification:

- Trigger a plan/suggestions/agents approval.
- Inspect the `approval shown` network request payload.
- With anonymization off, useful details should be present.
- With anonymization on, names/titles/IDs and detail arrays should be absent.

Acceptance signals:

- `approval shown` includes useful metadata for agents, suggestions, and plans.
- No prompts, full messages, secrets, endpoint bodies, or source files are sent.
- Anonymized mode strips all new identifying/text detail keys.

Safety / recovery:

- If a parser cannot recognize a tool payload, send counts/defaults rather than raw data.
- Keep arrays bounded to existing analytics sanitizer limits.


### Phase 4: Documentation and validation


Purpose: Capture the final privacy model and prove the code compiles.

Files and code areas touched:

- `docs/product-analytics.mdx`
- `docs/self-hosting.mdx`
- This plan file

Implementation scope:

- Update docs with the new replay consent model.
- Run automated checks that are safe without containers/dev server.
- Update `Progress`, `Surprises & Discoveries`, and `Outcomes & Retrospective`.

Why this phase is last: Docs should describe the implementation that actually landed.

Manual verification:

- User runs the app, opens Usage data settings, enables screen recording, performs a short flow, and checks that PostHog shows a session replay.

Acceptance signals:

- `npm --prefix apps/web run typecheck` passes.
- The user has clear instructions for QA without us starting the dev server.

Safety / recovery:

- If typecheck fails due to SDK types, adjust the wrapper module instead of weakening unrelated TypeScript settings.


## Concrete Steps and Commands


Working directory: `/Users/omervexler/.codex/worktrees/916f/second`

Install dependency:

    npm --prefix apps/web install posthog-js

Run focused validation:

    npm --prefix apps/web run typecheck

Optional manual browser QA for the user after implementation:

    npm run dev

Then read `.second-dev.txt` and open the `url=` value. Do not assume `localhost:3000`.

Manual QA flow:

1. Sign in or complete onboarding if needed.
2. Open the account menu and choose Usage data settings.
3. Confirm screen recording is off by default.
4. Turn on screen recording and confirm anonymization turns off.
5. Use the app briefly, including opening an app chat and triggering a tiny approval flow if possible.
6. Check browser network traffic or PostHog project replay ingestion for session recording.
7. Turn anonymization back on and confirm screen recording turns off.


## Validation and Acceptance


Automated validation:

- `npm --prefix apps/web run typecheck` must pass.

Manual acceptance:

- The Usage data dialog has a polished new screen recording option and clear Local Second/free-use helper copy.
- Screen recording is off by default.
- Turning recording on moves the user into non-anonymized mode.
- Turning anonymization on disables recording.
- With recording enabled, PostHog session replay starts.
- With recording disabled or telemetry disabled, PostHog session replay does not start.
- Existing product analytics continue to go through `/api/analytics/capture`.
- `approval shown` events contain richer metadata only when non-anonymized.
- Tenant isolation is unchanged: new server route only returns public config for an authenticated, onboarded user and does not read workspace-owned resources.


## Idempotence and Recovery


The implementation is additive and can be retried safely:

- Re-running `npm --prefix apps/web install posthog-js` should keep the same dependency in `apps/web/package-lock.json`.
- Consent normalization handles missing `recordScreen` fields for existing localStorage entries.
- The replay controller is best-effort and should tolerate repeated calls with the same consent state.
- If a partial implementation leaves `recordScreen` in localStorage, normalization still disables it whenever anonymization is on.
- If the new `/api/analytics/config` route fails, replay does not start, but normal app usage and existing product analytics continue.

Rollback guidance:

- Remove the dialog toggle and replay controller call first to stop exposing the feature.
- Remove `posthog-screen-recording.ts`, the config route, and the `posthog-js` dependency if the feature is fully reverted.
- Keep anonymized omit-key additions if they are harmless; they only reduce anonymized payload detail.


## Interfaces and Dependencies


- `posthog-js`: browser SDK used only for explicit session replay.
- `AnalyticsConsent`: gains `recordScreen: boolean`.
- `/api/analytics/config`: authenticated GET route returning `{ posthogToken: string, posthogHost: string }`.
- PostHog SDK methods used by the wrapper: `init`, `identify`, `startSessionRecording`, `stopSessionRecording`, `reset`.
- Existing APIs preserved: `captureAnalyticsEvent`, `identifyAnalyticsUser`, `subscribeAnalyticsConsent`, `writeAnalyticsConsent`.
- Existing event names preserved: no new PostHog product event names are required.


## Artifacts and Notes


SEC-138 Linear title: "Update analytics: more."

Official PostHog docs consulted:

- `https://posthog.com/docs/session-replay/installation`
- `https://posthog.com/docs/libraries/js/config`
- `https://posthog.com/docs/session-replay/privacy`
- `https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record`

Relevant PostHog findings:

- Web session replay records browser sessions for later playback.
- The JS SDK supports `disable_session_recording`.
- Manual control uses `posthog.startSessionRecording()` and `posthog.stopSessionRecording()`.
- Session replay privacy controls include masking/blocking classes, but SEC-138 explicitly wants un-anonymized recording only when the user opts in.


## Outcomes & Retrospective


Implemented SEC-138 without changing the existing sanitized product analytics capture path. The app now has a separate `recordScreen` consent flag, an authenticated PostHog config endpoint, a client-only PostHog replay controller, a Usage data dialog screen recording opt-in, richer `approval shown` payloads, and updated docs.

Automated validation passed:

    npm --prefix apps/web run typecheck
    npm --prefix apps/web run lint
    npm --prefix apps/web audit --omit=dev

Manual browser QA is still needed by the user because the task explicitly asked not to start the app here. The key manual check is enabling screen recording in Usage data settings and verifying PostHog session replay ingestion.


## Change Notes


- 2026-05-19 11:59Z: Initial plan created from Linear issue SEC-138, repository research, and PostHog documentation review.
- 2026-05-19 12:05Z: Updated progress and outcomes after implementation and validation.
- 2026-05-19 12:06Z: Recorded audit finding, non-force audit fix, and clean audit validation.


## Captured User Intent (Verbatim)


User request in this chat:

> Do SEC-138 from [@Linear](plugin://computer-use@openai-bundled) , create a plan then implement. then let me know when i can run the app to qa and test whether screen recording works (do not open a pr or something like that)

Linear SEC-138 description:

> Like, when it says "approval_shown" of type agents. ok great, but what were shown? add more like this, we need data! - crucial: im only talking about when it's un-anonymized.
>
> Also, add a screen recording option in the usage data personalization dialog (use PostHog for that). when on - make it work. read posthog docs beforehand obviously. do not over engineer this: if this option is on: record everything! do not anynmize. it's different from the top one i guess of sending anonymized logs to sentyr and posthog. that's ok, people understand that screen recording is ultra sharing stuff. it should be off by default as well. You should add a bade / description above it: "Local Second is free to use. This would really help improve it!". Something nicely designed, you know.
