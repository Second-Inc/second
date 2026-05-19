# Fix Agent Failure and Error Reporting


This plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Change Notes` current as the work evolves. This file must remain consistent with `PLANS.md`.


## Overall Goal


Make builder agent chat failures observable, recoverable, and safe: no failed or wedged agent stream should silently leave the user with a permanent "Working" or "Connecting to stream..." state, and pressing Stop must actually stop the active agent turn so the next user message can proceed.


## Goal Description / Sub-goals


The work covers SEC-139, "Sentry reporting & agents fail silently." The specific sub-goals are:

- Replace the silent empty-stream fallback in the builder chat POST with explicit, user-visible, and Sentry-reported outcomes.
- Add durable stale-stream recovery for `agent_runs` stuck in `status: "streaming"` with a stale or missing `activeStreamId`.
- Add an explicit retry path after recoverable stream failures so the user can retry the failed/stale turn without reloads, direct Mongo edits, or losing their last message.
- Fix Stop for builder chat so it cancels the server/worker turn, clears the run's active stream state, publishes realtime updates, and permits a later "continue" message.
- Persist compact failure metadata on builder runs so failed runs remain explainable after reload without storing prompts, source files, secrets, headers, cookies, or full stack traces in hot read models.
- Extend client and server Sentry reporting around the agent chat/stream path while preserving anonymization, tenant isolation, and redaction.
- Keep the existing multi-tab and route-navigation guarantees: normal navigation must not abort the authoritative chat POST; only an intentional Stop should cancel it.


## Motivation


The Linear issue reports a user-visible failure where chat showed repeated "Internet died, you should be able to reconnect now" messages, a working indicator, a red error bar, and "Connecting to stream..." but did not surface a clear failure or produce useful Sentry evidence. The attached user analysis says a worker stream can die before `failRun` or `completeRun`, leaving the run permanently in `status: "streaming"` with a stale `activeStreamId`. Subsequent messages can be silently dropped by the claim filter and return an empty AI SDK stream.

This is a core reliability and trust issue. Builder chat is the primary path where users collaborate with Claude/Codex/OpenCode. If a run fails, the system must either reconnect, recover, or fail clearly with actionable state. It must not hide failures, lose user messages, or keep an agent running after a user pressed Stop.


## State Before


The current system has a strong streaming architecture, but several failure paths are incomplete:

- `apps/web/src/lib/db/repositories/agent-runs.ts` stores builder runs with `pending`, `streaming`, `completed`, and `failed` statuses plus `activeStreamId`, but it does not persist a compact failure reason for builder runs.
- `startRunStream()` only claims runs that are `pending`, or terminal runs whose posted message count is longer than persisted messages. A stuck `streaming` run matches neither branch.
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/route.ts` returns an empty `createUIMessageStream` when `startRunStream()` returns `false`. That path does not write an AI SDK error part, record an audit event, or capture to Sentry.
- `failRun()` and `completeRun()` update by `_id` only, so a late old stream could theoretically overwrite a newer recovery stream unless implementation adds a stream lease/generation guard.
- `GET /chat/stream` waits briefly for `activeStreamId`; if none appears, it returns `204`. That is correct as a read-only fallback, but without stale-run repair elsewhere it can leave observers polling indefinitely.
- `AppChat` suppresses `TypeError` stream errors from the visible error UI and only tracks "build failed" analytics, not Sentry, for chat stream failures.
- The Stop button in `AppChat` aborts `chatPostAbortRef` and calls `stop()`. Because the authoritative chat POST is what drives `onFinish` persistence and run cleanup, this can leave the worker continuing while the UI stops locally.
- The worker's `/sessions/:appId/messages` stream has no explicit cancellation endpoint. `SessionImpl.sendMessage()` has a busy flag but no `AbortSignal` or `cancelCurrentRun()` path for Claude, Codex, or OpenCode.
- Direct Sentry API inspection for linked issue `7491322966` works after sourcing `~/.zshrc`, where `SENTRY_AUTH_TOKEN` is configured.


## State After


After implementation:

- If a chat POST cannot claim a run, the response is never a silent empty stream. It returns either a structured reconnect/busy response that the client handles, or an AI SDK error part with a clear message.
- Stale `streaming` runs are detected by a scoped write path, marked `failed` with a compact `failure` payload, and then either retried or presented to the user as recoverable.
- The chat UI exposes a clear retry affordance for retryable failures, preserves the user's last failed message/draft, and starts a fresh stream after the backend has moved the run out of stale `streaming`.
- Stop sends an explicit server-side cancellation request, terminates the active worker/runtime turn when possible, persists the current terminal state as `failed` with code `user_stopped`, clears `activeStreamId`, publishes `run.failed`, and lets the next user message start a fresh stream.
- Worker adapters receive cancellation signals and terminate provider-specific work instead of letting Claude/Codex/OpenCode continue in the background.
- Server-side chat failures, claim rejections, stale-stream recoveries, worker errors, and client stream failures are captured to Sentry with redacted, bounded context.
- Sentry and audit metadata use hashes, route shapes, status codes, stream ids, failure phase, runtime id/model, and counts. They do not include prompts, message text, source files, secrets, headers, cookies, request bodies, or full DB documents.
- Sidebar, app chat, and multi-tab observers converge on the same terminal run state through existing compact workspace realtime events.


## Context and Orientation


Second's builder agent chat path is documented in `docs/architecture.mdx`, `docs/streaming.mdx`, `docs/agent-system.mdx`, `docs/worker.mdx`, `docs/app-preview.mdx`, `docs/guard-and-tenancy.mdx`, and `docs/self-hosting.mdx`.

The relevant data flow is:

1. Browser `AppChat` uses `useChat` with a `DefaultChatTransport`.
2. `POST /api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat` authenticates the user, checks app/run access by `{ workspaceId, appId, runId }`, atomically claims a builder run, connects to the worker, and returns an AI SDK UIMessageStream.
3. `streamFromWorker()` calls worker `POST /sessions/:appId/messages` and translates worker SSE into UIMessage chunks.
4. `consumeSseStream` registers a Redis resumable stream, captures replay chunks, and saves `activeStreamId`.
5. `onFinish` persists final messages and clears `activeStreamId` through `completeRun()`.
6. Other tabs attach through `GET /chat/stream` and workspace realtime events.

The important invariant is tenant isolation: every browser route must authorize with `requireWorkspaceContext`, load the app by `{ workspaceId, appId }`, and load the run by `{ workspaceId, appId, runId }`. Workspace realtime events are invalidation hints only; they must remain compact and must not carry authorization-sensitive data or full chat content.


## Relevant Files and Code Areas


- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/route.ts`: builder chat POST/GET route; currently contains the silent empty-stream fallback, worker stream handling, `failRun`, `completeRun`, audit events, and replay registration.
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/stream/route.ts`: read-only stream attach route; should stay read-only but should surface non-attachable states cleanly.
- `apps/web/src/lib/db/repositories/agent-runs.ts`: builder run state machine; should own scoped claim, stale recovery, failure metadata, stream lease/generation checks, and workspace event publication.
- `apps/web/src/lib/db/types.ts`: `AgentRunDocument` needs a compact failure/stream lease shape if persisted.
- `apps/web/src/lib/agent/worker-bridge.ts`: worker SSE bridge; should accept cancellation, report bridge-level failures, and avoid swallowing provider errors without Sentry context.
- `apps/web/src/lib/streams/run-replay.ts`: replay capture can provide a low-cost stream heartbeat signal, but any heartbeat must be throttled and compact.
- `apps/web/src/components/app-chat.tsx`: Stop button, `useChat` error display, `useRunSync`, polling fallback, Sentry client error reporting, and multi-tab stream attachment behavior.
- `apps/worker/src/index.ts`: worker `/sessions/:appId/messages` endpoint; needs cancellation endpoint or signal-aware stream handling.
- `apps/worker/src/session-manager.ts`: session busy state; should gain `AbortController` ownership and a `cancelCurrentRun()` method.
- `apps/worker/src/runner.ts`: Claude runtime path; cancellation should close the active query and produce a bounded cancellation error/result.
- `apps/worker/src/runtimes/codex-cli.ts`, `apps/worker/src/runtimes/codex-app-server.ts`, and OpenCode runtime code under `apps/worker/src/runtimes/`: provider-specific cancellation behavior.
- `apps/web/src/instrumentation.ts`, `apps/web/src/sentry.server.config.ts`, `apps/web/src/instrumentation-client.ts`, `apps/web/src/lib/client-error-reporting.ts`, and `apps/web/src/lib/sentry-public-config.ts`: current Sentry initialization and client reporting helpers.
- `apps/web/src/lib/audit/record.ts`, `apps/web/src/lib/audit/redaction.ts`, and `apps/web/src/lib/audit/event-explanations.ts`: audit event recording and redaction.
- `apps/web/src/lib/events/workspace-events.ts`: compact workspace events for run status invalidation.


## Assumptions and Constraints


- This plan intentionally stops before implementation. The user asked to create a plan and pause.
- The Linear ticket, image, and attached Markdown file were readable through the Linear connector and signed Linear upload URL. The connector returned no separate `attachments[]`, but the embedded file URL was readable.
- The attached Markdown file is planning input, not a guaranteed final design. It correctly identifies the empty-stream claim-failure path and stale `streaming` state, but implementation must account for multi-tab streaming and intentional Stop.
- Sentry API details for the linked issue were inspected after sourcing `~/.zshrc`, where `SENTRY_AUTH_TOKEN` is configured. Do not print the token or ask the user to paste it into chat.
- Do not run the dev server or browser QA unless the user explicitly asks for QA or allows it.
- Do not run containers, Terraform, or infrastructure commands.
- Do not use git commands unless the user explicitly asks for git/PR work or no-human-in-the-loop mode.
- GET/read routes must remain read-only. Stale-run repair should happen in POST/mutation routes, startup maintenance, or an explicit maintenance endpoint, not in `GET /chat` or `GET /chat/stream`.
- Realtime events must stay compact: ids, statuses, timestamps, and invalidation scope only.
- Hot metadata paths must not include large messages, prompts, source maps, source files, secrets, or full documents.
- The implementation must preserve the documented navigation invariant: route changes must not abort the authoritative chat POST. Only an explicit Stop should cancel an active run.


## Progress


- [x] 2026-05-19 14:43 IDT - Verified access to Linear issue `SEC-139`.
- [x] 2026-05-19 14:43 IDT - Verified the issue description is readable, including the linked Sentry issue URL.
- [x] 2026-05-19 14:43 IDT - Verified the embedded image is readable. It shows a chat stuck around "Working" / "Connecting to stream..." after repeated "Internet died..." messages.
- [x] 2026-05-19 14:43 IDT - Verified the attached file `stuck-streaming-run-empty-stream-fallback.md` is readable and summarized its root-cause analysis.
- [x] 2026-05-19 14:43 IDT - Initially checked local Sentry API credential availability; `SENTRY_AUTH_TOKEN` was missing from the default shell environment.
- [x] 2026-05-19 14:50 IDT - Sourced `~/.zshrc`, found `SENTRY_AUTH_TOKEN`, and read Sentry issue `7491322966`.
- [x] 2026-05-19 14:43 IDT - Read the relevant architecture, streaming, tenancy, app preview, self-hosting, worker, app-agent, and agent-system docs.
- [x] 2026-05-19 14:43 IDT - Inspected the chat route, run repository, stream attach route, AppChat Stop behavior, worker stream endpoint, session manager, worker bridge, and Sentry helpers.
- [x] 2026-05-19 14:43 IDT - Created this implementation plan.
- [x] 2026-05-19 15:38 IDT - Implemented typed builder run claim results, compact failure metadata, stream leases, stale-stream recovery, lease-guarded terminal writes, and throttled stream heartbeat updates.
- [x] 2026-05-19 15:38 IDT - Replaced the silent chat POST claim-failure fallback with typed no-op/error stream responses, audit events, and redacted Sentry reporting.
- [x] 2026-05-19 15:38 IDT - Added an authenticated `POST /chat/stop` route plus worker `/sessions/:appId/cancel` support and runtime abort propagation for Claude, Codex, and OpenCode paths.
- [x] 2026-05-19 15:38 IDT - Added client chat stream error reporting, visible failure/retry UI, and retry message restoration into the composer.
- [x] 2026-05-19 15:38 IDT - Ran `npm run typecheck`; web and worker typechecks passed.
- [x] 2026-05-19 16:38 IDT - Added defensive handling for the stop-during-initialization regression by preventing a stopped lease from starting the worker, guarding worker stream enqueue after cancellation, suppressing stopped-run error flicker, and avoiding stale stream-ready reconnect flashes.
- [x] 2026-05-19 16:38 IDT - Re-ran `npm run typecheck`; web and worker typechecks passed.
- [x] 2026-05-19 - Simplified the user-facing Stop behavior: Stop is disabled while a turn is still initializing and only becomes clickable after the assistant turn has started streaming; terminal runs no longer enter the initial live-sync loading path.
- [x] 2026-05-19 - Re-ran `npm run typecheck`; web and worker typechecks passed.
- [x] 2026-05-19 - Fixed stale stopped-failure hydration after retry: delayed failed snapshots older than the current local message list no longer briefly re-show "Run stopped by the user" after a successful retry finishes.
- [x] 2026-05-19 - Re-ran `npm run typecheck`; web and worker typechecks passed.
- [x] 2026-05-19 - Updated stopped-run UX: partial answers remain visible, user-stopped failures render as a neutral inline callout, and "Try again" rewinds the interrupted local turn and immediately resends the same user message instead of filling the composer.
- [x] 2026-05-19 - Re-ran `npm run typecheck`; web and worker typechecks passed.
- [x] 2026-05-19 - Fixed stopped-run "Try again" claim rejection by sending an explicit `retryLastMessageId` and allowing retryable failed runs to re-claim the same persisted latest user message instead of returning `stale_input`.
- [x] 2026-05-19 - Re-ran `npm run typecheck`; web and worker typechecks passed.
- [x] 2026-05-19 - Corrected the stopped-run retry implementation to use the AI SDK same-message replacement path (`messageId`) instead of manually rewinding local messages and creating a new client message id.
- [x] 2026-05-19 - Re-ran `npm run typecheck`; web and worker typechecks passed.
- [x] 2026-05-19 - Relaxed the server retry claim to trust the explicit retry request's latest user message id while still requiring a retryable failed run and no history truncation. This avoids fragile matching against the persisted stopped-turn user id.
- [x] 2026-05-19 - Re-ran `npm run typecheck`; web and worker typechecks passed.
- [x] 2026-05-19 - Removed reconnect-state leakage from the composer placeholder and rendered submitted turns from live messages instead of deferred messages, preventing transient "Connecting to stream..." in the composer and pre-user-message Working jitter.
- [x] 2026-05-19 - Re-ran `npm run typecheck`; web and worker typechecks passed.
- [ ] Browser QA not run.


## Surprises & Discoveries


- `startRunStream()` returns only `boolean`, so the route cannot distinguish "duplicate initial POST while another tab is legitimately starting" from "run is wedged forever" from "new message rejected because the run is busy."
- The chat POST currently returns an empty AI SDK stream on claim failure. That explains the attached file's "working, then nothing" symptom.
- `failRun()` and `completeRun()` update by `_id`, not `{ workspaceId, appId, runId, streamLease }`. A robust stale-recovery implementation should guard terminal writes from old streams.
- The Stop button intentionally aborts the chat POST even though comments nearby correctly say route changes must not abort authoritative chat POST streams. Intentional Stop needs a different path from navigation cleanup.
- The worker session layer has a `busy` flag but no cancellation API. If the browser aborts locally, the runtime can continue because no worker-owned cancellation signal is propagated.
- Client Sentry reporting exists for component boundaries and diagnostics, but chat stream errors are only tracked through product analytics and visible UI suppresses `TypeError` network errors.
- The default Sentry DSN exists in `apps/web/src/lib/sentry-public-config.ts`; the Sentry API token is available after sourcing `~/.zshrc`.
- Sentry issue `7491322966` is relevant to SEC-139. It is titled `Error: Timeout waiting for ack`, has culprit `GET /api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/stream`, is unresolved, and had 50 events between `2026-05-19T06:48:31.321000Z` and `2026-05-19T06:52:23Z`.
- Recent Sentry events came from release `0.1.25`, runtime `node v22.14.0`, browser tag `Chrome 147`, OS tag `macOS 26.3`, and a local URL shape for workspace `syntaxgtm` with object IDs scrubbed by the Sentry helper. The error originates in `resumable-stream/src/runtime.ts` with value `Timeout waiting for ack`.
- Sentry issue `7492038617` is the follow-up regression from stopping during early "Working" initialization. It is titled `TypeError: fetch failed`, points at `streamFromWorker` on the chat POST, and had 9 events between `2026-05-19T13:16:19.319000Z` and `2026-05-19T13:23:46Z`. The implementation was still able to call the worker after `/chat/stop` had marked the run stopped, and the worker stream could enqueue an error into a canceled stream during that race.


## Decision Log


- 2026-05-19 - Plan the fix as a state-machine and cancellation hardening effort, not only as UI error reporting. Rationale: the root bug is server/worker state getting wedged; UI-only handling would leave the agent running and the run locked.
- 2026-05-19 - Keep stale-run recovery out of GET/read routes. Rationale: repository instructions and docs require read paths to stay read-only, and recovery is a mutation with audit/Sentry side effects.
- 2026-05-19 - Persist compact failure metadata on builder runs. Rationale: after reload, `status: "failed"` alone is insufficient for user support or UI copy, but storing prompts or full errors would violate privacy and hot-path constraints.
- 2026-05-19 - Use stream leases/generation checks for terminal writes. Rationale: stale worker streams must not overwrite a recovered run after the user retries.
- 2026-05-19 - Treat Stop as a server/worker cancellation request. Rationale: aborting the browser fetch stops rendering, not necessarily execution.


## Plan of Work


The implementation should introduce a clear run-stream state contract:

- A chat turn has a stream lease or generation token created before the run is claimed.
- Only the holder of the current lease can attach `activeStreamId`, complete, or fail the run.
- Claim rejection returns a typed reason instead of `false`.
- Stale `streaming` state is recoverable through a scoped mutation that marks the prior lease failed and publishes compact terminal events.
- Stop cancels the current lease and worker turn rather than only aborting the client fetch.
- Retry is an explicit product path: retryable failures should produce a visible "retry" state, preserve the user's last attempted message, and send a fresh POST only after the backend terminal/recovery state is durable.

The plan should also introduce a small error-reporting layer for the chat path:

- Server helper for Sentry capture with redacted context and hashed identifiers.
- Client reporting for `useChat` stream errors, including network-looking `TypeError` failures, with route shape and browser online/visibility state.
- Audit events for claim rejection, stale recovery, user stop, and worker stream failure. Audit metadata should be bounded and sanitized through existing audit redaction.

Performance safety checklist:

- Hot-path data shape: add only compact fields such as `failure.code`, `failure.phase`, `failure.message`, `failure.occurredAt`, `streamLease.id`, and throttled heartbeat timestamps. Do not store full messages beyond existing `messages`, source files, prompts, stacks, headers, cookies, or secrets.
- Read-vs-write behavior: `GET /chat`, `GET /chat/stream`, workspace events, and sidebar/status reads must not repair runs. POST chat and explicit stop/recovery paths may mutate after authorization.
- Realtime invalidation source: publish `run.starting`, `run.stream_ready`, `run.completed`, and `run.failed` only after successful Mongo mutations. Events remain scoped and compact.
- Duplicate-request prevention: preserve no-duplicate-worker behavior for Strict Mode, route remounts, browser back/forward, and multi-tab POST races.
- Multi-tab/multi-user streaming behavior: one active worker stream per run; observers attach through replay/resume; Stop by one collaborator should move all observers to terminal stopped/failed state.
- Tenant isolation: every mutation uses `{ workspaceId, appId, runId }` from `requireWorkspaceContext`/`resolveAppAccess`; worker cancellation requests must not accept app/run ids without a trusted web route.
- Staging validation: validate with stale Mongo state, worker failure, client network abort, Stop, reload, and multi-tab attach scenarios using `.second-dev.txt` as the dev URL source of truth.


## Phased Implementation Plan


### Phase 1 - Add Typed Run Failure and Claim Results


Purpose: Make the repository expose enough state to handle failures deliberately.

Files and code areas:

- `apps/web/src/lib/db/types.ts`
- `apps/web/src/lib/db/repositories/agent-runs.ts`
- `apps/web/src/lib/events/workspace-events.ts`
- `apps/web/src/lib/audit/event-explanations.ts`

Implementation scope:

- Add a compact optional `failure` field to `AgentRunDocument`, for example:
  - `code`: `worker_stream_failed`, `claim_rejected`, `stale_stream_recovered`, `user_stopped`, `worker_cancel_failed`, or similar stable strings.
  - `phase`: `claim`, `attach`, `worker_stream`, `persistence`, `client_stop`, `watchdog`.
  - `message`: short sanitized user-safe text.
  - `retryable`: boolean.
  - `occurredAt`: `Date`.
  - optional `reported`: `{ sentryEventId?: string; auditEventId?: string }` if needed, without making Sentry success a hard dependency.
- Add a stream lease/generation shape, either as explicit fields (`activeStreamLeaseId`, `streamStartedAt`, `streamHeartbeatAt`) or a small `streamLease` object.
- Replace `startRunStream(): Promise<boolean>` with a typed result such as `claimed`, `already_streaming`, `stale_streaming`, `stale_input`, or `not_found`.
- Scope terminal updates by `{ _id, workspaceId, appId }` and the expected lease where applicable.
- Extend `failRun()` to accept failure metadata and an expected lease id.
- Ensure successful new claims clear prior `failure` where appropriate.
- Keep all new fields compact and indexed only if later query patterns require it. Do not add broad indexes unless profiling proves a need.

Why ordered here:

The route and UI should not guess about repository state. They need typed outcomes before behavior can be fixed safely.

Verification:

- Inspect the repository methods and types.
- Run `npm run typecheck` from repo root after implementation.
- Manually construct a stuck `streaming` run in a local database later during QA and verify the repository returns a stale/rejected result rather than a boolean.

Observable success:

- The chat route can distinguish active streaming, stale streaming, duplicate stale input, and successful claims.
- Terminal writes from an old stream cannot overwrite a later claimed stream.

Rollback/safety:

- Because MongoDB is schemaless, optional fields can be added safely. Existing runs without `failure` or lease fields must continue to load.


### Phase 2 - Replace Silent Claim Failure With Explicit Outcomes


Purpose: Make every chat POST claim failure visible, recoverable, and reportable.

Files and code areas:

- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/route.ts`
- `apps/web/src/lib/db/repositories/agent-runs.ts`
- `apps/web/src/lib/audit/record.ts`
- new `apps/web/src/lib/server-error-reporting.ts` or similar

Implementation scope:

- On `already_streaming` with an attachable stream, return a typed response/header that tells the client to resume instead of starting a duplicate worker query. Preserve the intended duplicate POST protection, but avoid pretending the send succeeded silently.
- On `already_streaming` with a new user message while the run is truly active, return a clear error part or 409 body that the client can render without losing the draft/optimistic message.
- On stale streaming, atomically mark the stale run failed with `failure.code = "stale_stream_recovered"` and either:
  - claim the new message in the same mutation flow, if it is safe and message count increased, or
  - return a clear recoverable error instructing the client to retry after state refresh.
- Include a retryable error contract in the response/failure metadata. The client should be able to tell whether the failed turn can be retried automatically, retried by button, or should require a new user message.
- Write an AI SDK `error` part for unrecoverable claim failures so the UI can display it.
- Record audit events such as `builder_run.claim_rejected` and `builder_run.stale_stream_recovered` with sanitized metadata: status, hadActiveStream, age bucket, runtime id/model, message counts, and hashed stream lease.
- Capture Sentry messages/exceptions for unexpected claim failures and stale recovery with hashed ids and no prompt/message content.
- Return `failure` in `GET /chat` so reloads can render the last known failure.

Why ordered here:

This directly fixes the silent empty-stream symptom from the attached file and Linear screenshot.

Verification:

- Force `startRunStream()` to reject in a local test or manual setup and confirm the response is not empty.
- Verify Sentry capture calls are guarded and redacted.
- Confirm duplicate remounts still do not start extra worker queries.

Observable success:

- A stuck run no longer shows endless "Working" with no explanation.
- Support can tell whether a run was busy, stale, stopped, or failed from the run's compact failure metadata and Sentry/audit events.

Rollback/safety:

- If client handling of typed headers/409s creates compatibility issues, keep the AI SDK error stream fallback because it stays within the existing transport protocol.


### Phase 3 - Implement Real Stop/Cancellation


Purpose: Ensure the Stop button stops the server/worker turn and clears durable run state.

Files and code areas:

- `apps/web/src/components/app-chat.tsx`
- new or existing route under `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/...`
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/route.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/session-manager.ts`
- `apps/worker/src/runner.ts`
- `apps/worker/src/runtimes/*`

Implementation scope:

- Add an authenticated, workspace-scoped stop route, for example `POST /chat/stop`, that verifies `{ workspaceId, appId, runId }` and app collaboration access.
- The stop route should:
  - load the current run state by `{ workspaceId, appId, runId }`;
  - call a worker cancellation endpoint for the current app/session;
  - mark the current stream lease failed/stopped with `failure.code = "user_stopped"`;
  - clear `activeStreamId`;
  - mark replay terminal as failed/stopped;
  - publish compact `run.failed`;
  - record audit event `builder_run.stopped`;
  - capture Sentry only for cancellation errors, not for successful user-initiated stops.
- Add worker endpoint such as `POST /sessions/:appId/cancel` or `DELETE /sessions/:appId/current-message`, authenticated by `INTERNAL_API_TOKEN`.
- Add `Session.cancelCurrentRun(reason)` and make `sendMessage()` create an `AbortController` for the active turn.
- Pass the abort signal into runtime adapters:
  - Claude: close the active query and stop yielding.
  - Codex app-server: terminate the active turn or close the app-server process if the protocol has no softer turn cancel.
  - OpenCode/command-backed runtimes: terminate child process and return a bounded cancellation error.
- Change the AppChat Stop button so it calls the stop route first, then calls `stop()` to release local UI observers. Do not abort the authoritative POST as the primary cancellation mechanism.
- Handle stop failures visibly. If the worker cancellation endpoint fails but Mongo state is moved terminal, show that the run was stopped locally and report the worker cancel failure separately.

Why ordered here:

Stop currently creates one of the most damaging states: UI stops, backend keeps working, and later messages can be lost or ignored.

Verification:

- Start a long builder run, press Stop, and verify:
  - worker runtime stops;
  - sidebar leaves "working";
  - `GET /chat` returns terminal failed/stopped metadata;
  - a subsequent message starts a new stream;
  - reload does not resume the stopped answer.

Observable success:

- Pressing Stop is a durable product action, not just local fetch cancellation.

Rollback/safety:

- Keep route-change observer abort logic separate from Stop. If cancellation is unstable for one runtime, gate provider-specific cancellation but still clear web run state with an explicit reported failure so the user is not wedged.


### Phase 4 - Add Stale Stream Heartbeat and Recovery


Purpose: Recover from crashes, killed processes, lost worker streams, and Redis/resumable stream gaps.

Files and code areas:

- `apps/web/src/lib/streams/run-replay.ts`
- `apps/web/src/lib/db/repositories/agent-runs.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/stream/route.ts`
- optionally startup code in `apps/web/src/instrumentation.ts`

Implementation scope:

- Add a low-frequency heartbeat for active streams. Prefer Redis for high-frequency liveness and throttle Mongo updates if a persisted `streamHeartbeatAt` is needed.
- Update heartbeat from replay capture or bridge progress at most every 10-30 seconds, never on every token/chunk.
- Define stale thresholds:
  - short "starting" timeout for `status: streaming` with no `activeStreamId`;
  - longer idle timeout for `status: streaming` with no heartbeat and no complete replay.
- Add a mutation helper `recoverStaleBuilderRun()` scoped by `{ workspaceId, appId, runId }` and expected old lease/status.
- Trigger recovery from chat POST claim handling and optionally from a startup/maintenance sweep. Do not trigger from GET routes.
- `GET /chat/stream` can include diagnostic headers or trace logs for no-active-stream, but it must remain read-only.

Why ordered here:

Explicit claim errors prevent silence; heartbeat/recovery prevents the same stuck state from recurring after process death.

Verification:

- Manually set a run to stale `streaming` with old heartbeat and verify the next POST recovers it.
- Kill a worker mid-stream in a local environment later during QA and verify the run becomes failed/retryable rather than permanently streaming.
- Confirm normal long-running tool calls do not get falsely failed while chunks/heartbeat continue.

Observable success:

- A worker crash or lost stream results in a bounded failed/recoverable state, not a permanent lock.

Rollback/safety:

- Start with conservative thresholds and prefer user-visible retry over aggressive automatic restart if heartbeat data is ambiguous.


### Phase 5 - Harden Sentry and Client Error UI


Purpose: Make failures visible to users and operators without leaking tenant data.

Files and code areas:

- `apps/web/src/lib/client-error-reporting.ts`
- `apps/web/src/components/app-chat.tsx`
- `apps/web/src/lib/sentry-public-config.ts`
- `apps/web/src/sentry.server.config.ts`
- `apps/web/src/instrumentation.ts`
- new `apps/web/src/lib/server-error-reporting.ts`

Implementation scope:

- Add a server helper around `@sentry/nextjs` that accepts a known error source and sanitized context.
- Use route shapes and hashed `workspaceId`, `appId`, `runId`, `streamLeaseId`; do not send raw messages, prompts, source files, headers, cookies, request body, full tool inputs/outputs, or secret-looking keys.
- Capture:
  - worker stream exceptions;
  - claim rejection anomalies;
  - stale stream recovery;
  - replay/attach failures that become terminal;
  - stop/cancel failures;
  - post-stream persistence failures when they can leave user-visible inconsistency.
- Update AppChat to report `useChat` errors through `reportClientError`, including `TypeError`, but dedupe to avoid storms.
- Render a restrained shadcn-style chat error row for network/stream errors instead of suppressing `TypeError`. Suggested copy should be short and actionable, such as "The stream disconnected. Reconnecting..." or "The run failed. Send another message to retry."
- For retryable failures, render a compact Retry action in the transcript at the failed turn, directly below the last user message or failed assistant/stream placeholder where `Working` or `Connecting to stream...` would otherwise remain. Use a small inline error row with status text on the left and a `RotateCcw`/Retry button on the right, matching the restrained chat/tool-call style. Do not hide the primary retry action only inside the composer or sidebar; the action should be spatially tied to the failed turn. Clicking Retry should resubmit the preserved last user message, or restore it into the composer if automatic retry is unsafe. The action must be disabled while a run is already `submitted`/`streaming` and must not create duplicate worker queries across tabs.
- Use existing `PartErrorBoundary` and `RecoverableErrorBoundary` patterns; do not add decorative UI.

Why ordered here:

Once the backend has clear failure states, client error UI and Sentry can report accurate causes instead of vague network symptoms.

Verification:

- Temporarily set Sentry DSN in a safe environment and trigger synthetic chat errors; verify events are created with redacted context.
- Confirm analytics consent and `SECOND_SENTRY_DISABLED` / `SECOND_ERROR_REPORTING_DISABLED` / `SECOND_TELEMETRY_DISABLED` still disable client/server capture as designed.
- Inspect event payloads before sending in development logs or test mocks to ensure no prompt/source/secret leakage.

Observable success:

- A user-visible chat failure produces either a Sentry event or an explicit disabled-reporting reason, and the UI does not look like an unexplained silent stall.

Rollback/safety:

- Sentry capture must be best-effort only. Failures to report must never break chat, stop, or recovery.


### Phase 6 - Validate End-to-End


Purpose: Prove the system behaves correctly under normal, stopped, failed, stale, and multi-tab flows.

Files and code areas:

- `QA/` docs if the user asks for QA documentation or browser QA.
- Existing source files touched by phases 1-5.

Implementation scope:

- Run `npm run typecheck` from the repo root.
- If adding a test harness or focused scripts, keep them scoped to repository/run state helpers and worker cancellation behavior.
- Manual QA only after explicit user permission:
  - If no matching dev server is running, start `npm run dev`.
  - Read `.second-dev.txt` and use `url=` as the only source of truth.
  - Use the in-app browser for QA.
  - Use the default QA identity from repo instructions if onboarding is needed.
  - Keep build prompts tiny.

Manual verification scenarios:

- Normal builder run completes and persists messages/source as before.
- Duplicate tab/remount does not start a second worker query and attaches to the active stream.
- Worker stream throws; run becomes failed, Sentry/audit record exists, UI shows error.
- `status: streaming` with no attachable stream and stale heartbeat recovers on next POST.
- Retry after a stale/recoverable failure starts a fresh stream and does not require page reload.
- The retry control appears inline at the failed chat turn, replacing the indefinite loader/error bar state, and is not only exposed through the composer.
- Stop during Claude run stops worker, clears sidebar working state, and allows follow-up.
- Stop during Codex run stops worker, clears sidebar working state, and allows follow-up.
- Reload after Stop does not resume the stopped answer.
- A second tab watching the same run receives terminal state through workspace realtime.
- Cross-workspace and cross-app attempts still return 404/403 as currently documented.

Observable success:

- The exact class of failure in the attached Markdown is no longer possible without a visible terminal state and reported diagnostic evidence.

Rollback/safety:

- If a runtime-specific cancellation path is risky, ship the repository/route/Sentry/stale recovery improvements first, then gate cancellation by runtime while preserving terminal state cleanup.


## Concrete Steps and Commands


Implementation commands, to run only when the user asks to proceed:

    cd /Users/omervexler/.codex/worktrees/b1aa/second
    npm run typecheck

Optional Sentry inspection once a read-only token is set locally:

    cd /Users/omervexler/.codex/worktrees/b1aa/second
    export SENTRY_API="/Users/omervexler/.codex/plugins/cache/openai-curated/sentry/eed16198/skills/sentry/scripts/sentry_api.py"
    python3 "$SENTRY_API" --org second-9r issue-detail 7491322966
    python3 "$SENTRY_API" --org second-9r issue-events 7491322966 --time-range 14d --limit 10

Manual QA commands, only with explicit QA permission:

    cd /Users/omervexler/.codex/worktrees/b1aa/second
    npm run dev
    sed -n '1,80p' .second-dev.txt

Then open the `url=` value from `.second-dev.txt` in the in-app browser.


## Validation and Acceptance


Acceptance criteria:

- No chat POST claim failure returns an unmarked empty stream.
- A stale `streaming` run is eventually marked terminal and recoverable without direct Mongo edits.
- Retryable failures show a retry affordance or restored composer state, preserve the user's last attempted message, and start a fresh stream after retry.
- The primary retry affordance is visible in the chat transcript at the failed turn, directly where the user observed the failure.
- A failed worker stream writes an AI SDK error part or clear transport error, persists compact failure metadata, clears `activeStreamId`, publishes `run.failed`, and reports to Sentry when enabled.
- Pressing Stop stops the worker/runtime work, clears the sidebar working state, and allows a new message without reload.
- Reloading after a failed or stopped run shows the terminal state and does not resume a stopped answer.
- Multi-tab observers update through compact workspace realtime events without local polling storms.
- Sentry/audit metadata contains no prompts, source files, full messages, secrets, cookies, auth headers, request bodies, or full stack traces in persisted DB records.
- Tenant boundaries are preserved for every new route and mutation.

Automated validation:

- `npm run typecheck` must pass.
- Add focused tests or small deterministic scripts if implementation introduces pure helpers for claim-state decisions, failure sanitization, or cancellation state transitions.

Manual validation:

- Run the scenarios listed in Phase 6 after explicit QA permission.
- Record results in a date-prefixed QA file only if the user asks for QA docs or an end-to-end QA pass.


## Idempotence and Recovery


- Optional Mongo fields make the migration additive. Existing runs without `failure` or stream lease fields should continue working.
- Stale recovery must be compare-and-set: only recover a run if it still matches the stale status/lease that was inspected.
- `failRun`/`completeRun` with expected lease should be safe to retry; if the lease no longer matches, the method should no-op and report that the caller lost ownership.
- Stop route should be idempotent: stopping an already terminal run returns success with current terminal status.
- Sentry and audit writes are best-effort and must not prevent run cleanup.
- If worker cancellation fails, web must still move the authorized run out of permanent `streaming` and record a compact `worker_cancel_failed` failure/report.
- If a stale recovery falsely marks a long-running stream failed, the lease guard prevents old completion from overwriting the recovered run; the user can retry from the terminal state.


## Interfaces and Dependencies


Interfaces likely to change:

- `AgentRunDocument` in `apps/web/src/lib/db/types.ts`
- `startRunStream()` return type and call sites
- `failRun()` and `completeRun()` signatures to accept `{ workspaceId, appId, expectedLeaseId, failure }`
- `GET /chat` response shape to include `failure`
- New authenticated chat stop route
- New worker cancellation endpoint
- `Session` / `SessionImpl` interface in `apps/worker/src/session-manager.ts`
- Runtime adapter function options to accept `AbortSignal`
- `AppChat` transport/stop behavior and error rendering
- Sentry server helper API

Dependencies and services:

- MongoDB `agent_runs`
- Redis resumable stream context, replay buffer, and workspace event pub/sub
- Worker HTTP API authenticated by `INTERNAL_API_TOKEN`
- Sentry via `@sentry/nextjs`
- Vercel AI SDK UIMessageStream protocol
- Claude Agent SDK, Codex CLI app-server, and OpenCode command runtime behavior


## Artifacts and Notes


Linear verification notes:

- Issue `SEC-139` is readable.
- The issue is urgent and in progress in the Second Linear team.
- The screenshot is readable and shows chat stuck around "Working" and "Connecting to stream..." after reconnect/error messages.
- The attached file `stuck-streaming-run-empty-stream-fallback.md` is readable. It identifies a stale `status: "streaming"` plus stale `activeStreamId` run state, an empty stream on claim failure in the chat route, and lack of watchdog/TTL recovery.
- The issue links Sentry issue `7491322966` in org `second-9r`, project id `4511401492217856`.
- Sentry issue `7491322966` was queried after sourcing `~/.zshrc`. Summary: `Error: Timeout waiting for ack`; culprit `GET /api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/stream`; project `second-next`; status `unresolved`; count `50`; first seen `2026-05-19T06:48:31.321000Z`; last seen `2026-05-19T06:52:23Z`; metadata points to `resumable-stream/src/runtime.ts`.

Representative current code behavior:

- `startRunStream()` claims only `pending` runs or terminal runs with longer posted message lists.
- On `!claimedRun`, the chat route currently creates `createUIMessageStream({ execute: async () => {} })` and returns it.
- AppChat Stop currently calls `chatPostAbortRef.current?.abort(); chatPostAbortRef.current = null; stop();`.
- Worker `SessionImpl.sendMessage()` throws when busy but has no cancellation method.


## Outcomes & Retrospective


Planning outcome:

- A root-cause-oriented implementation path is documented.
- Implementation is complete for the scoped backend state-machine, stop/cancel, reporting, and retry UI work.
- Direct Sentry event inspection succeeded after sourcing `~/.zshrc`.
- Automated type validation passes. Browser/manual QA was not run because the user did not request QA or permit starting the dev server.


## Change Notes


- 2026-05-19 - Initial plan created from SEC-139, Linear screenshot, attached Markdown analysis, project docs, and local code inspection.
- 2026-05-19 - Updated plan with Sentry issue details after sourcing the token from `~/.zshrc`.
- 2026-05-19 - Made retry an explicit sub-goal, response contract, UI requirement, manual QA scenario, and acceptance criterion.
- 2026-05-19 - Specified retry button placement: inline in the chat transcript at the failed turn, not hidden in the composer/sidebar.
- 2026-05-19 - Implemented the plan across the builder chat route, run repository, worker session/runtime cancellation, Sentry reporting helpers, AppChat failure/retry UI, and audit event descriptions.
- 2026-05-19 - Added defensive early-stop race handling: the chat POST now re-checks lease ownership immediately before worker connection, worker SSE enqueue/close is safe after cancellation, AppChat uses the AI SDK abort signal for intentional Stop without a second custom abort controller, stopped runs suspend live reconnect observers until the next send, and reconnect sync fetches run state before showing "Connecting to stream...".
- 2026-05-19 - Simplified the product behavior after regression review: Stop is not available during the unsafe initialization window. The button remains disabled while the latest turn has only the user message; it becomes available once an assistant stream part exists. This avoids racing a half-created worker turn.
- 2026-05-19 - Ignored stale failed snapshots when the local chat has already advanced past their message count, preventing the previous stopped failure from flashing after a later successful retry.
- 2026-05-19 - Changed the stopped response row to a neutral "Second's response was stopped by the user." callout with a "Try again" action that removes the interrupted local user/assistant turn and resends it. Typing in the composer remains an append-new-message path.
- 2026-05-19 - Made "Try again" an explicit retry contract. The client sends the persisted stopped user message id, and the repository permits a retryable failed run to be claimed again when that id matches the latest persisted user message and the request does not truncate history.
- 2026-05-19 - Fixed the retry contract implementation: the client now resubmits with the original user `messageId`, letting the AI SDK truncate the interrupted assistant response while preserving the message id expected by the server.
- 2026-05-19 - Relaxed the retry claim predicate: explicit retry now requires `status: failed`, `failure.retryable: true`, request history length at least the persisted history length, and the request's latest user message id matching `retryLastMessageId`; it no longer requires the persisted latest user id to match.
- 2026-05-19 - Kept local composer sends visually local: the composer no longer shows "Connecting to stream..." for run sync loading, and submitted-message renders use live `messages` so the optimistic user bubble appears before the chat-level Working indicator.


## Captured User Intent (Verbatim)


User request:

> Fix agent fail and error reporting. Let's start with the linear issue + sentry. first- can you just verify that you have access to the linear ticket? and that you can read the content, the image, and the attached file? SEC-139 [@linear](plugin://linear@openai-curated) . If yes- create a plan to fix it, the pause.
