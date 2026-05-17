import { NextResponse } from "next/server";
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
import { createRun } from "@/lib/db";

type RunsRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export async function POST(request: Request, context: RunsRouteContext) {
  const { workspaceId, appId } = await context.params;

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
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const run = await createRun({
    appId,
    workspaceId: workspaceContext.workspaceId,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "builder_run.created",
    category: "apps",
    severity: "info",
    outcome: "started",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId,
      appName: access.app.name,
      runId: run._id,
    }),
    target: { type: "run", id: run._id, parentType: "app", parentId: appId },
    action: "created",
    summary: `Created builder run for ${access.app.name}.`,
    metadata: {
      status: run.status,
      messageCount: run.messages.length,
    },
    relatedIds: { appId, runId: run._id },
  });

  return NextResponse.json(
    { id: run._id, appId: run.appId, status: run.status },
    { status: 201 },
  );
}
