import { after, NextResponse } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  type UIMessage,
} from "ai";
import { createResumableStreamContext } from "resumable-stream";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  clearAppAgentRunActiveStream,
  failAppAgentRun,
  findUserById,
  findWorkspaceById,
  getAppSourceFilesForVersion,
  loadAppAgentRunForApp,
  saveAppAgentRunMessages,
  setAppAgentRunActiveStream,
  startAppAgentRunStream,
  updateAppAgentRunStatus,
} from "@/lib/db";
import type { AppMetadata } from "@/lib/db";
import { appendOnboardingContextSection } from "@/lib/agent/onboarding-context-prompt";
import { streamAgentRunFromWorker } from "@/lib/agent/worker-bridge";
import { normalizeRuntimeSettings } from "@/lib/agent/runtime-registry";
import { getRedisClient, runEventsChannel } from "@/lib/redis";
import { getWorkerUrl, workerFetch } from "@/lib/worker-client";
import {
  captureRunReplayStream,
  createRunReplayResponseStream,
  hasCompleteRunReplay,
  markRunReplayTerminal,
} from "@/lib/streams/run-replay";
import { createPerfTrace } from "@/lib/perf/trace";

type StreamRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
    runId: string;
  }>;
};

type AgentsJsonToolDef = {
  type: "builtin" | "custom";
  name: string;
  displayName?: string;
  enabled: boolean;
};

type AgentsJson = {
  agents: Array<{
    id: string;
    name: string;
    systemPrompt: string;
    tools: AgentsJsonToolDef[];
    dataCollections?: string[];
  }>;
};

const APP_AGENT_TOOL_FAILURE_RECOVERY_PROMPT = [
  "CUSTOM TOOL FAILURE RECOVERY:",
  "- If a custom app tool returns output beginning with `Tool execution failed:`, continue any parts of the user's task that do not depend on that tool.",
  "- Do not write placeholder records such as \"task failed\", \"could not complete\", or fake fallback data into app data just to satisfy the UI.",
  "- If the failed custom tool blocks the requested task, call `mcp__app_tools__report_tool_call_failed` near the end of the run with a concise description and attempted task. Omit `toolName` unless several custom tools failed; if you include it, prefer the generated custom tool name such as `exa_search` rather than the full MCP name.",
  "- After reporting the failure, tell the user that the builder agent has been asked to repair the tool configuration.",
].join("\n");

function isWorkerTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && "cause" in error
      ? String((error as Error & { cause?: unknown }).cause)
      : "";
  return /terminated|fetch failed|ECONNREFUSED|UND_ERR_SOCKET|Worker events returned (404|5\d\d)/i.test(
    `${message} ${cause}`,
  );
}

async function resolveSourceFilesForRun(input: {
  app: AppMetadata;
  canCollaborate: boolean;
  workspaceId: string;
  appId: string;
  sourceVersion?: "draft" | "published";
}): Promise<Record<string, string> | null> {
  const sourceVersion =
    input.sourceVersion === "draft" && input.canCollaborate
      ? "draft"
      : "published";
  return getAppSourceFilesForVersion({
    workspaceId: input.workspaceId,
    appId: input.appId,
    version: sourceVersion,
  });
}

function getBuiltinToolNames(tools: AgentsJsonToolDef[]): string[] {
  return tools
    .filter((t) => t.type === "builtin" && t.enabled)
    .map((t) => t.name);
}

function createAgentRunViewerResponse(input: {
  runId: string;
  originalMessages: UIMessage[];
  workerUrl: string;
  workerAppId: string;
  streamId: string;
  signal: AbortSignal;
}) {
  const redis = getRedisClient();
  let terminalStatus: "completed" | "failed" = "completed";
  let clientAborted = input.signal.aborted;
  const onAbort = () => {
    clientAborted = true;
  };
  input.signal.addEventListener("abort", onAbort, { once: true });
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        await streamAgentRunFromWorker(writer, {
          workerUrl: input.workerUrl,
          workerAppId: input.workerAppId,
          runId: input.runId,
          signal: input.signal,
        });
      } catch (err) {
        if (clientAborted || input.signal.aborted) {
          return;
        }
        terminalStatus = "failed";
        console.error("[agent-run] stream error:", err);
        if (isWorkerTransportError(err)) {
          await failAppAgentRun(
            input.runId,
            "Agent run failed because the worker stream was interrupted. Please retry the run.",
          ).catch((failErr) =>
            console.error("[agent-run] failed to mark run failed:", failErr),
          );
        }
      }
    },
    originalMessages: input.originalMessages,
    onFinish: async ({ messages: finalMessages }) => {
      input.signal.removeEventListener("abort", onAbort);
      if (clientAborted || input.signal.aborted) {
        await clearAppAgentRunActiveStream(
          input.runId,
          input.streamId,
        ).catch(() => {});
        return;
      }
      if (finalMessages?.length) {
        await saveAppAgentRunMessages(input.runId, finalMessages, null).catch(
          (err) =>
            console.error("[agent-run] message persistence error:", err),
        );
      }
      await markRunReplayTerminal({
        runId: input.runId,
        status: terminalStatus,
      }).catch(() => {});
    },
  });

  const resumableStreamContext = createResumableStreamContext({
    waitUntil: after,
    subscriber: redis.duplicate(),
    publisher: redis.duplicate(),
  });

  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: async ({ stream: sseStream }) => {
      await resumableStreamContext.createNewResumableStream(
        input.streamId,
        () => captureRunReplayStream({ runId: input.runId, stream: sseStream }),
      );
      const streamAttached = await setAppAgentRunActiveStream(
        input.runId,
        input.streamId,
      );
      if (streamAttached) {
        redis
          .publish(
            runEventsChannel(input.runId),
            JSON.stringify({ type: "stream_started", streamId: input.streamId }),
          )
          .catch(() => {});
      }
    },
  });
}

function createReplayResponse(input: {
  runId: string;
  cursor: number;
  signal: AbortSignal;
}) {
  return new Response(
    createRunReplayResponseStream({
      runId: input.runId,
      cursor: input.cursor,
      signal: input.signal,
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1",
        "x-second-stream-replay": "1",
      },
    },
  );
}

/**
 * POST — Start the agent in the worker (fire-and-forget) and stream SSE to the client.
 * The worker runs the agent independently — if the client disconnects, the agent
 * keeps running and calls the completion callback when done.
 */
export async function POST(request: Request, context: StreamRouteContext) {
  const { workspaceId, appId, runId } = await context.params;
  const url = new URL(request.url);
  const startOnly = url.searchParams.get("startOnly") === "1";
  const trace = createPerfTrace({
    route:
      "POST /api/workspaces/[workspaceId]/apps/[appId]/agent-runs/[runId]/stream",
    workspaceId,
    appId,
    runId,
  });
  trace.log("app_agent.stream_post.request_start");

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await trace.time("auth.workspace", () =>
      requireWorkspaceContext({
        headers: request.headers,
        pathname: url.pathname,
        workspaceId,
      }),
    );
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  // useChat sends messages, but app-agent execution uses the stored run data.
  const body = (await request.json().catch(() => null)) as
    | { messages?: UIMessage[] }
    | null;

  const access = await trace.time("auth.app_access", () =>
    resolveAppAccess({ workspaceContext, appId }),
  );
  if (!access) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }
  const app = access.app;

  const run = await loadAppAgentRunForApp(
    runId,
    workspaceContext.workspaceId,
    appId,
  );
  if (!run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }
  if (run.sourceVersion === "draft" && !access.canCollaborate) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  // Load agent definition
  const sourceFiles = await resolveSourceFilesForRun({
    app,
    canCollaborate: access.canCollaborate,
    workspaceId: workspaceContext.workspaceId,
    appId,
    sourceVersion: run.sourceVersion,
  });

  const agentsJsonRaw = sourceFiles?.["agents.json"];
  if (!agentsJsonRaw) {
    return NextResponse.json({ error: "no_agents_defined" }, { status: 400 });
  }

  let agentsJson: AgentsJson;
  try {
    agentsJson = JSON.parse(agentsJsonRaw) as AgentsJson;
  } catch {
    return NextResponse.json({ error: "invalid_agents_json" }, { status: 400 });
  }

  const agentDef = agentsJson.agents.find((a) => a.id === run.agentId);
  if (!agentDef) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  const builtinTools = getBuiltinToolNames(agentDef.tools ?? []);
  const workerUrl = getWorkerUrl();
  const webUrl =
    process.env.WEB_URL ?? process.env.SECOND_PUBLIC_URL ?? "http://localhost:3000";
  const streamId = generateId();
  const workerAppId = `${appId}__agent__${run._id}`;
  const runtimeSettings = normalizeRuntimeSettings({
    runtimeId: app.runtimeId,
    model: app.runtimeModel,
    params: app.runtimeParams,
  });
  const [workspace, triggeringUser] = await Promise.all([
    findWorkspaceById(workspaceContext.workspaceId),
    run.triggeredByUserId ? findUserById(run.triggeredByUserId) : null,
  ]);
  const agentSystemPrompt = appendOnboardingContextSection({
    systemPrompt: [
      `Important: CURRENT RUNTIME MODEL ID / SLUG: ${runtimeSettings.model}.`,
      "If asked for your model ID / slug, return the current runtime model ID / slug above exactly.",
      "If the user has not configured an integration yet, integration tools may return mock data. This is expected behavior; do not treat it as a problem or report it as a failure.",
      "",
      agentDef.systemPrompt,
      "",
      APP_AGENT_TOOL_FAILURE_RECOVERY_PROMPT,
    ].join("\n"),
    workspace,
    user: triggeringUser ?? workspaceContext.user,
  });

  const claimedRun = await startAppAgentRunStream({
    runId: run._id,
    workspaceId: workspaceContext.workspaceId,
    appId,
  });
  if (!claimedRun) {
    trace.log("app_agent.stream_post.already_claimed", {
      runStatus: run.status,
      startOnly,
    });
    if (startOnly) {
      return NextResponse.json(
        { status: "already_started" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const stream = createUIMessageStream({
      originalMessages: body?.messages ?? [],
      execute: async () => {},
    });
    return createUIMessageStreamResponse({ stream });
  }
  trace.log("app_agent.stream_post.claimed");

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "app_agent_run.started",
    category: "agents",
    severity: "info",
    outcome: "started",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      kind: "app_iframe",
      trust: "client_untrusted",
      appId,
      appName: app.name,
      sourceVersion: run.sourceVersion ?? "published",
      runId: run._id,
    }),
    target: {
      type: "run",
      id: run._id,
      name: agentDef.name,
      parentType: "app",
      parentId: appId,
    },
    action: "started",
    summary: `Started app-agent run for ${agentDef.name}.`,
    metadata: {
      agentId: agentDef.id,
      agentName: agentDef.name,
      builtinTools,
      sourceVersion: run.sourceVersion ?? "published",
    },
    relatedIds: { appId, agentRunId: run._id },
  });

  // Start the agent in the worker (fire-and-forget)
  const startRes = await trace.time("worker.agent_run_start", () =>
    workerFetch(`/sessions/${workerAppId}/agent-run`, {
      workerUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: run._id,
        prompt: run.prompt,
        systemPrompt: agentSystemPrompt,
        agentConfig: {
          id: agentDef.id,
          name: agentDef.name,
          systemPrompt: agentSystemPrompt,
          tools: agentDef.tools ?? [],
          dataCollections: agentDef.dataCollections,
        },
        allowedTools: builtinTools,
        runtimeId: runtimeSettings.runtimeId,
        runtimeModel: runtimeSettings.model,
        runtimeParams: runtimeSettings.params,
        workspaceId: workspaceContext.workspaceId,
        appId,
        sourceVersion: run.sourceVersion ?? "published",
        sourceFiles: sourceFiles ?? undefined,
        callbackUrl: `${webUrl}/api/internal/agent-run-complete`,
      }),
    }),
  );

  if (!startRes.ok) {
    trace.log("app_agent.stream_post.worker_start_failed", {
      workerStatus: startRes.status,
    });
    await updateAppAgentRunStatus(run._id, "failed", {
      error: "failed_to_start_agent",
    }).catch(() => {});
    return NextResponse.json(
      { error: "failed_to_start_agent" },
      { status: 502 },
    );
  }

  if (startOnly) {
    trace.log("app_agent.stream_post.start_only_started");
    return NextResponse.json(
      { status: "started" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return createAgentRunViewerResponse({
    runId: run._id,
    originalMessages: [],
    workerUrl,
    workerAppId,
    streamId,
    signal: request.signal,
  });
}

/**
 * GET — Resume an existing stream (for page reloads / reconnects).
 */
export async function GET(request: Request, context: StreamRouteContext) {
  const { workspaceId, appId, runId } = await context.params;
  const url = new URL(request.url);
  const cursor = Number(url.searchParams.get("cursor") ?? "0");
  const replayCursor = Number.isFinite(cursor) ? cursor : 0;
  const trace = createPerfTrace({
    route:
      "GET /api/workspaces/[workspaceId]/apps/[appId]/agent-runs/[runId]/stream",
    workspaceId,
    appId,
    runId,
  });
  trace.log("app_agent.stream_get.request_start", { cursor: replayCursor });
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;

  try {
    workspaceContext = await trace.time("auth.workspace", () =>
      requireWorkspaceContext({
        headers: request.headers,
        pathname: url.pathname,
        workspaceId,
      }),
    );
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const access = await trace.time("auth.app_access", () =>
    resolveAppAccess({ workspaceContext, appId }),
  );
  if (!access) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }

  const run = await loadAppAgentRunForApp(
    runId,
    workspaceContext.workspaceId,
    appId,
  );
  if (!run) {
    return new Response(null, { status: 404 });
  }
  if (run.sourceVersion === "draft" && !access.canCollaborate) {
    return new Response(null, { status: 404 });
  }

  const canUseReplay =
    ((run.status === "completed" || run.status === "failed") &&
      run.messages.length === 0);
  if (canUseReplay) {
    const hasReplay = await hasCompleteRunReplay(runId).catch(() => false);
    if (hasReplay) {
      trace.log("app_agent.stream_get.terminal_replay", {
        cursor: replayCursor,
        runStatus: run.status,
      });
      return createReplayResponse({
        runId,
        cursor: replayCursor,
        signal: request.signal,
      });
    }
  }

  const activeStreamId = run.status === "streaming" ? run.activeStreamId : null;
  if (!activeStreamId) {
    if (
      run.status === "streaming" ||
      run.status === "running" ||
      (run.status === "completed" && run.messages.length === 0)
    ) {
      trace.log("app_agent.stream_get.worker_rebuild", {
        runStatus: run.status,
        hasMessages: run.messages.length > 0,
      });
      return createAgentRunViewerResponse({
        runId: run._id,
        originalMessages: (run.messages ?? []) as UIMessage[],
        workerUrl: getWorkerUrl(),
        workerAppId: `${appId}__agent__${run._id}`,
        streamId: generateId(),
        signal: request.signal,
      });
    }

    return new Response(null, { status: 204 });
  }

  const redis = getRedisClient();
  const resumableStreamContext = createResumableStreamContext({
    waitUntil: after,
    subscriber: redis.duplicate(),
    publisher: redis.duplicate(),
  });

  const resumedStream = await trace
    .time("app_agent.stream_get.resumable_resume", () =>
      resumableStreamContext.resumeExistingStream(activeStreamId),
    )
    .catch((error) => {
      trace.log("app_agent.stream_get.resumable_resume_failed", {
        error: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    });

  if (!resumedStream) {
    const replayAvailable = await hasCompleteRunReplay(runId).catch(() => false);
    if (replayAvailable) {
      trace.log("app_agent.stream_get.replay_after_resumable_miss", {
        cursor: replayCursor,
      });
      return createReplayResponse({
        runId,
        cursor: replayCursor,
        signal: request.signal,
      });
    }
    trace.log("app_agent.stream_get.worker_rebuild_after_resumable_miss");
    return createAgentRunViewerResponse({
      runId: run._id,
      originalMessages: (run.messages ?? []) as UIMessage[],
      workerUrl: getWorkerUrl(),
      workerAppId: `${appId}__agent__${run._id}`,
      streamId: generateId(),
      signal: request.signal,
    });
  }

  trace.log("app_agent.stream_get.resumable");
  return new Response(resumedStream.pipeThrough(new TextEncoderStream()), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
