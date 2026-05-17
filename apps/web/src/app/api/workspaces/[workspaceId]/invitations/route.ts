import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  hasWorkspacePermission,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  auditActorFromWorkspaceContext,
  auditSourceFromRequest,
  recordAuditEvent,
} from "@/lib/audit/record";
import {
  createWorkspaceInvitation,
  ensureDefaultWorkspaceTeam,
  findMembership,
  findPendingInvitationByEmail,
  findUserByEmail,
  findWorkspaceById,
  isWorkspaceRole,
  listWorkspaceInvitations,
  updateWorkspaceExternalOrganization,
} from "@/lib/db";
import { loadWorkspaceInvitationProvider } from "@/lib/invitations";
import { createPerfTrace, perfResponseHeaders } from "@/lib/perf/trace";
import { validateEmail } from "@/lib/validation";
import {
  dedupeWorkspaceSettingsRequest,
  workspaceSettingsDedupeKey,
} from "@/lib/workspace-settings/request-dedupe";
import { loadMembersSettingsInvitations } from "@/lib/workspace-settings/read-models";

type WorkspaceInvitationsRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

function serializeInvitation(
  invitation: Awaited<ReturnType<typeof listWorkspaceInvitations>>[number],
) {
  return {
    id: invitation._id,
    email: invitation.email,
    role: invitation.role,
    teamIds: invitation.teamIds,
    status: invitation.status,
    provider: invitation.provider,
    invitedByUserId: invitation.invitedByUserId,
    invitedByUserName: invitation.invitedByUserName,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
    expiresAt: invitation.expiresAt?.toISOString() ?? null,
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
  };
}

export async function GET(
  request: Request,
  context: WorkspaceInvitationsRouteContext,
) {
  const { workspaceId } = await context.params;
  const trace = createPerfTrace({
    route: "GET /api/workspaces/[workspaceId]/invitations",
    workspaceId,
  });
  trace.log("settings.members.invitations.request_start");

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await trace.time("auth.workspace", () =>
      requireWorkspaceContext({
        headers: request.headers,
        pathname: new URL(request.url).pathname,
        workspaceId,
      }),
    );
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

  const invitations = await trace.time("settings.members.invitations", () =>
    dedupeWorkspaceSettingsRequest(
      workspaceSettingsDedupeKey("invitations", workspaceContext),
      750,
      () => loadMembersSettingsInvitations(workspaceContext, { trace }),
    ),
  );
  trace.log("settings.members.invitations.response", {
    invitations: invitations.length,
    totalElapsedMs: trace.elapsedMs(),
  });

  return NextResponse.json(
    {
      invitationCapability:
        loadWorkspaceInvitationProvider().getCapability(),
      invitations,
    },
    { headers: perfResponseHeaders(trace) },
  );
}

export async function POST(
  request: Request,
  context: WorkspaceInvitationsRouteContext,
) {
  const { workspaceId } = await context.params;

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

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    role?: unknown;
  } | null;
  const email = validateEmail(
    typeof body?.email === "string" ? body.email : null,
  );
  const role = body?.role;

  if (!email) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  if (!isWorkspaceRole(role)) {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }

  if (
    role === "owner" &&
    !hasWorkspacePermission(workspaceContext.membership, "members:manage-owner")
  ) {
    return NextResponse.json(
      { error: "workspace_owner_invite_forbidden" },
      { status: 403 },
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

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    const existingMembership = await findMembership({
      workspaceId: workspaceContext.workspaceId,
      userId: existingUser._id,
    });

    if (existingMembership) {
      return NextResponse.json(
        { error: "workspace_member_already_exists" },
        { status: 409 },
      );
    }
  }

  const pendingInvitation = await findPendingInvitationByEmail({
    workspaceId: workspaceContext.workspaceId,
    email,
  });

  if (pendingInvitation) {
    return NextResponse.json(
      { error: "workspace_invitation_already_pending" },
      { status: 409 },
    );
  }

  const [workspace, defaultTeam] = await Promise.all([
    findWorkspaceById(workspaceContext.workspaceId),
    ensureDefaultWorkspaceTeam({
      workspaceId: workspaceContext.workspaceId,
      createdByUserId: workspaceContext.user._id,
    }),
  ]);

  if (!workspace) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let externalOrganizationId = workspace.externalOrganizationId ?? null;
  let externalProvider = workspace.externalOrganizationProvider ?? null;

  if (!externalOrganizationId || !externalProvider) {
    const externalOrganization =
      await invitationProvider.ensureWorkspaceExternalOrganization({
        workspaceId: workspaceContext.workspaceId,
        workspaceName: workspace.name,
        createdByUserId: workspaceContext.user._id,
      });
    externalOrganizationId = externalOrganization.externalOrganizationId;
    externalProvider = externalOrganization.provider;
    await updateWorkspaceExternalOrganization({
      workspaceId: workspaceContext.workspaceId,
      externalOrganizationId,
      externalOrganizationProvider: externalProvider,
    });
  }

  const sentInvitation = await invitationProvider.sendWorkspaceInvitation({
    workspaceId: workspaceContext.workspaceId,
    workspaceName: workspace.name,
    externalOrganizationId,
    email,
    role,
    teamIds: [defaultTeam._id],
    inviterUserId: workspaceContext.user._id,
  });

  const invitation = await createWorkspaceInvitation({
    workspaceId: workspaceContext.workspaceId,
    email,
    role,
    teamIds: [defaultTeam._id],
    provider: sentInvitation.provider,
    externalInvitationId: sentInvitation.externalInvitationId,
    externalOrganizationId,
    invitedByUserId: workspaceContext.user._id,
    invitedByUserName: workspaceContext.user.displayName,
    expiresAt: sentInvitation.expiresAt ?? null,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "member.invited",
    category: "members",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: {
      type: "invitation",
      id: invitation._id,
      name: invitation.email,
    },
    action: "invited",
    summary: `Invited ${invitation.email} as ${invitation.role}.`,
    metadata: {
      role: invitation.role,
      teamIds: invitation.teamIds,
      provider: invitation.provider,
      expiresAt: invitation.expiresAt?.toISOString() ?? null,
    },
    relatedIds: {},
  });

  return NextResponse.json(
    { invitation: serializeInvitation(invitation) },
    { status: 201 },
  );
}
