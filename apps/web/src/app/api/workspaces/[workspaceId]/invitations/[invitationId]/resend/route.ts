import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  normalizeObjectId,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  findInvitationByIdForWorkspace,
  touchWorkspaceInvitation,
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

  if (!capability.supported) {
    return NextResponse.json(
      {
        error: "workspace_invitations_unavailable",
        reason: capability.reason,
      },
      { status: 400 },
    );
  }

  if (invitation.externalInvitationId) {
    await invitationProvider.resendWorkspaceInvitation({
      externalInvitationId: invitation.externalInvitationId,
    });
  }

  await touchWorkspaceInvitation({
    workspaceId: workspaceContext.workspaceId,
    invitationId,
  });

  return NextResponse.json({ ok: true });
}
