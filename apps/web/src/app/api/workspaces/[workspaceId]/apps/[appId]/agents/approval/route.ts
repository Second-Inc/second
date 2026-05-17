import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  requireWorkspaceContext,
  resolveAppAccess,
} from "@/lib/auth";
import { InvalidAgentsJsonError } from "@/lib/agents/agents-governance";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  approveAppAgentsJsonPayload,
  approveCurrentAppAgentsJson,
} from "@/lib/db";

type AgentsApprovalRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

export async function POST(
  request: Request,
  context: AgentsApprovalRouteContext,
) {
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
  if (!access.canCollaborate) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const canApproveLiveRuntime = isWorkspaceAdminRole(
    workspaceContext.membership.role,
  );

  try {
    const body = (await request.json().catch(() => null)) as
      | { agentsJson?: unknown }
      | null;
    const approval = body?.agentsJson
      ? await approveAppAgentsJsonPayload({
          workspaceId: workspaceContext.workspaceId,
          appId,
          payload: body.agentsJson,
          approvedByUserId: workspaceContext.user._id,
          approvedByUserName: workspaceContext.user.displayName,
          source: canApproveLiveRuntime ? "build_chat" : "build_chat_mock",
        })
      : await approveCurrentAppAgentsJson({
          workspaceId: workspaceContext.workspaceId,
          appId,
          approvedByUserId: workspaceContext.user._id,
          approvedByUserName: workspaceContext.user.displayName,
          source: canApproveLiveRuntime ? "build_chat" : "build_chat_mock",
        });

    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "app.agents_config.approved",
      category: "agents",
      severity: canApproveLiveRuntime ? "notice" : "info",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request, {
        appId,
        appName: access.app.name,
      }),
      target: {
        type: "agent",
        id: approval.hash ?? appId,
        name: `${access.app.name} agents.json`,
        parentType: "app",
        parentId: appId,
      },
      action: "approved",
      summary: canApproveLiveRuntime
        ? `Approved app-agent runtime policy for ${access.app.name}.`
        : `Approved mock-only app-agent policy for ${access.app.name}.`,
      metadata: {
        approvalSource: canApproveLiveRuntime ? "build_chat" : "build_chat_mock",
        mockOnly: !canApproveLiveRuntime,
        hasAgentsJson: approval.hasAgentsJson,
        agentsJsonHash: approval.hash,
      },
      changes: { changedFields: ["agentsJsonApprovalHash"] },
      relatedIds: { appId },
    });

    return NextResponse.json({
      ok: true,
      mockOnly: !canApproveLiveRuntime,
      ...approval,
    });
  } catch (error) {
    if (error instanceof InvalidAgentsJsonError) {
      return NextResponse.json(
        { error: "invalid_agents_json", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}
