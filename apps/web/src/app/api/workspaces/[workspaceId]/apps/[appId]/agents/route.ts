import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { tryReadAgentsJsonSnapshot } from "@/lib/agents/agents-governance";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  getAppSourceFilesForVersion,
  markAppDraftEdited,
  markPendingAppReviewRequestSuperseded,
  saveAppSourceFiles,
} from "@/lib/db";

type AgentsRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

const REVIEW_INVALIDATED_MESSAGE =
  "This app changed after it was sent for review. The review was closed automatically; send it for review again when it is ready.";

async function supersedePendingReview(input: {
  workspaceId: string;
  appId: string;
}): Promise<{ reviewInvalidated: boolean; draftCreatedFromPublished: boolean }> {
  const result = await markAppDraftEdited(input);
  if (result.reviewInvalidated) {
    await markPendingAppReviewRequestSuperseded({
      ...input,
      message: REVIEW_INVALIDATED_MESSAGE,
    });
  }
  return result;
}

export async function GET(request: Request, context: AgentsRouteContext) {
  const { workspaceId, appId } = await context.params;

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }
  const sourceFiles = await getAppSourceFilesForVersion({
    workspaceId: workspaceContext.workspaceId,
    appId,
    version: access.canCollaborate ? "draft" : "published",
  });
  const agentsJsonRaw = sourceFiles?.["agents.json"];

  if (!agentsJsonRaw) {
    return NextResponse.json({ agents: [] });
  }

  try {
    const agentsJson = JSON.parse(agentsJsonRaw);
    return NextResponse.json(agentsJson);
  } catch {
    return NextResponse.json({ agents: [] });
  }
}

export async function PATCH(request: Request, context: AgentsRouteContext) {
  const { workspaceId, appId } = await context.params;

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) return guardErrorToApiResponse(error);
    throw error;
  }

  const access = await resolveAppAccess({ workspaceContext, appId });
  if (!access) {
    return NextResponse.json({ error: "app_not_found" }, { status: 404 });
  }
  if (!access.canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await request.json();

  // Validate it has the agents array
  if (!body || !Array.isArray(body.agents)) {
    return NextResponse.json({ error: "invalid_agents_json" }, { status: 400 });
  }

  const sourceFiles =
    (await getAppSourceFilesForVersion({
      workspaceId: workspaceContext.workspaceId,
      appId,
      version: "draft",
    })) ?? {};

  const updatedSourceFiles = {
    ...sourceFiles,
    "agents.json": JSON.stringify(body, null, 2),
  };
  const previousAgentsApprovalHash = access.app.agentsJsonApprovalHash ?? null;
  const nextAgentsSnapshot = tryReadAgentsJsonSnapshot(updatedSourceFiles);
  const agentsApprovalBecameStale = Boolean(
    previousAgentsApprovalHash &&
      (!nextAgentsSnapshot ||
        nextAgentsSnapshot.hash !== previousAgentsApprovalHash),
  );

  const draftEditResult = await supersedePendingReview({
    workspaceId: workspaceContext.workspaceId,
    appId,
  });

  await saveAppSourceFiles({
    workspaceId: workspaceContext.workspaceId,
    appId,
    sourceFiles: updatedSourceFiles,
  });
  if (agentsApprovalBecameStale) {
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "app.agents_config.stale",
      category: "agents",
      severity: "notice",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId,
        appName: access.app.name,
      }),
      target: {
        type: "agent",
        id: nextAgentsSnapshot?.hash ?? appId,
        name: `${access.app.name} agents.json`,
        parentType: "app",
        parentId: appId,
      },
      action: "stale",
      summary: `Marked app-agent runtime policy stale for ${access.app.name}.`,
      metadata: {
        reason: "agents_json_updated",
        nextAgentsJsonValid: Boolean(nextAgentsSnapshot),
      },
      changes: {
        changedFields: [
          "agentsJsonApprovalHash",
          "agentsJsonApprovedPayload",
        ],
        beforeHash: previousAgentsApprovalHash ?? undefined,
        afterHash: nextAgentsSnapshot?.hash,
      },
      relatedIds: { appId },
    });
  }

  return NextResponse.json({ ok: true, ...draftEditResult });
}
