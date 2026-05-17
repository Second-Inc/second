import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  normalizeObjectId,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  findInvitationByIdForWorkspace,
  markInvitationRevoked,
} from "@/lib/db";
import { loadWorkspaceInvitationProvider } from "@/lib/invitations";

type WorkspaceInvitationActionRouteContext = {
  params: Promise<{
    workspaceId: string;
    invitationId: string;
  }>;
};

export async function POST(
  request: Request,
  context: WorkspaceInvitationActionRouteContext,
) {
  const { workspaceId, invitationId: rawInvitationId } = await context.params;
  const invitationId = normalizeObjectId(rawInvitationId);

  if (!invitationId) {
    return NextResponse.json(
      { error: "workspace_invitation_not_found" },
      { status: 404 },
    );
  }

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

  if (!hasWorkspacePermission(workspaceContext.membership, "members:invite")) {
    return NextResponse.json(
      { error: "workspace_invitations_forbidden" },
      { status: 403 },
    );
  }

  const invitation = await findInvitationByIdForWorkspace({
    workspaceId: workspaceContext.workspaceId,
    invitationId,
  });

  if (!invitation || invitation.status !== "pending") {
    return NextResponse.json(
      { error: "workspace_invitation_not_found" },
      { status: 404 },
    );
  }

  const invitationProvider = loadWorkspaceInvitationProvider();
  const capability = invitationProvider.getCapability();

  if (capability.supported && invitation.externalInvitationId) {
    await invitationProvider.revokeWorkspaceInvitation({
      externalInvitationId: invitation.externalInvitationId,
    });
  }

  await markInvitationRevoked({
    workspaceId: workspaceContext.workspaceId,
    invitationId,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "member.invitation_revoked",
    category: "members",
    severity: "info",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: {
      type: "invitation",
      id: invitation._id,
      name: invitation.email,
    },
    action: "invitation_revoked",
    summary: `Revoked invitation for ${invitation.email}.`,
    metadata: {
      role: invitation.role,
      provider: invitation.provider,
    },
  });

  return NextResponse.json({ ok: true });
}
