import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { failRun, loadRunForApp } from "@/lib/db";
import { getRedisClient, runEventsChannel } from "@/lib/redis";
import { getWorkerUrl, workerFetch } from "@/lib/worker-client";
import { markRunReplayTerminal } from "@/lib/streams/run-replay";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import { auditSha256 } from "@/lib/audit/redaction";
import { reportServerError } from "@/lib/server-error-reporting";
import type { AgentRunFailure } from "@/lib/db/types";

type StopRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
    runId: string;
  }>;
};

function chatStopRouteShape(): string {
  return "/api/workspaces/[workspaceId]/apps/[appId]/runs/[runId]/chat/stop";
}

function stopFailure(input: {
  code: AgentRunFailure["code"];
  message: string;
  sentryEventId?: string | null;
}): AgentRunFailure {
  return {
    code: input.code,
    phase: "client_stop",
    message: input.message.replace(/\s+/g, " ").trim().slice(0, 240),
    retryable: true,
    occurredAt: new Date(),
    ...(input.sentryEventId
      ? { reported: { sentryEventId: input.sentryEventId } }
      : {}),
  };
}

async function cancelWorkerTurn(input: {
  workerUrl: string;
  appId: string;
  runId: string;
}): Promise<{ ok: boolean; cancelled: boolean; status?: number; error?: string }> {
  try {
    const response = await workerFetch(`/sessions/${input.appId}/cancel`, {
      workerUrl: input.workerUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "user_stopped",
        runId: input.runId,
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        cancelled: false,
        status: response.status,
        error: `Worker cancel returned ${response.status}`,
      };
    }
    const body = (await response.json().catch(() => null)) as
      | { cancelled?: unknown }
      | null;
    return {
      ok: true,
      cancelled: body?.cancelled === true,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      cancelled: false,
      error: error instanceof Error ? error.message : "Worker cancel failed",
    };
  }
}

export async function POST(request: Request, context: StopRouteContext) {
  const { workspaceId, appId, runId } = await context.params;
  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;

  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) {
      return guardErrorToApiResponse(error);
    }
    throw error;
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }
  if (!access.canCollaborate) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  const run = await loadRunForApp(runId, workspaceContext.workspaceId, appId);
  if (!run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  if (run.status !== "streaming") {
    return NextResponse.json({
      ok: true,
      status: run.status,
      alreadyTerminal: run.status === "completed" || run.status === "failed",
      workerCancelled: false,
      failure: run.failure ?? null,
    });
  }

  const workerCancel = await cancelWorkerTurn({
    workerUrl: getWorkerUrl(),
    appId,
    runId,
  });
  const sentryEventId = workerCancel.ok
    ? null
    : reportServerError({
        source: "agent_chat_stop",
        message: workerCancel.error ?? "Worker cancel failed",
        route: chatStopRouteShape(),
        level: "warning",
        context: {
          workspaceId: workspaceContext.workspaceId,
          appId,
          runId,
          leaseId: run.streamLease?.id ?? null,
          workerStatus: workerCancel.status,
        },
      });

  const failure = stopFailure({
    code: workerCancel.ok ? "user_stopped" : "worker_cancel_failed",
    message: workerCancel.ok
      ? "Run stopped by the user."
      : "Run stopped locally, but the worker cancel request failed.",
    sentryEventId,
  });
  const stopped = await failRun({
    runId,
    workspaceId: workspaceContext.workspaceId,
    appId,
    messages: run.messages,
    expectedLeaseId: run.streamLease?.id ?? null,
    failure,
  });

  await markRunReplayTerminal({ runId, status: "failed" }).catch(() => {});
  getRedisClient()
    .publish(runEventsChannel(runId), JSON.stringify({ type: "failed" }))
    .catch(() => {});

  void recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "builder_run.stopped",
    category: "apps",
    severity: workerCancel.ok ? "notice" : "warning",
    outcome: stopped ? "success" : "failure",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      kind: "web_server",
      trust: "server_trusted",
      appId,
      appName: access.app.name,
      runId,
    }),
    target: { type: "run", id: runId, parentType: "app", parentId: appId },
    action: "stopped",
    summary: `Stopped builder run for ${access.app.name}.`,
    metadata: {
      workerCancelled: workerCancel.cancelled,
      workerStatus: workerCancel.status,
      streamLeaseHash: auditSha256(run.streamLease?.id ?? "none"),
    },
    relatedIds: { appId, runId },
  });

  return NextResponse.json({
    ok: true,
    status: "failed",
    stopped,
    workerCancelled: workerCancel.cancelled,
    failure,
  });
}
