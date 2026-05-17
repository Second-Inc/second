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
  ensureWorkspaceHasAnotherOwner,
  findMembership,
  findWorkspaceById,
  isWorkspaceRole,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  type WorkspaceMembershipDocument,
} from "@/lib/db";
import { loadWorkspaceInvitationProvider } from "@/lib/invitations";

type WorkspaceMemberRouteContext = {
  params: Promise<{
    workspaceId: string;
    userId: string;
  }>;
};

async function resolveExternalMembershipTarget(
  membership: WorkspaceMembershipDocument,
): Promise<{
  externalOrganizationId: string | null;
  externalOrganizationMembershipId: string | null;
} | null> {
  if (membership.externalProvider && membership.externalProvider !== "workos") {
    return null;
  }

  if (
    membership.externalOrganizationId ||
    membership.externalOrganizationMembershipId
  ) {
    return {
      externalOrganizationId: membership.externalOrganizationId ?? null,
      externalOrganizationMembershipId:
        membership.externalOrganizationMembershipId ?? null,
    };
  }

  const workspace = await findWorkspaceById(membership.workspaceId);
  if (workspace?.externalOrganizationProvider !== "workos") {
    return null;
  }

  return {
    externalOrganizationId: workspace.externalOrganizationId ?? null,
    externalOrganizationMembershipId: null,
  };
}

async function syncExternalRoleUpdate(input: {
  membership: WorkspaceMembershipDocument;
  role: Exclude<WorkspaceMembershipDocument["role"], undefined>;
}): Promise<NextResponse | null> {
  const externalTarget = await resolveExternalMembershipTarget(input.membership);
  if (!externalTarget) return null;

  const provider = loadWorkspaceInvitationProvider();
  const capability = provider.getCapability();

  if (!capability.supported) {
    return NextResponse.json(
      {
        error: "workspace_membership_provider_unavailable",
        reason: capability.reason,
      },
      { status: 400 },
    );
  }

  await provider.updateWorkspaceMemberRole({
    workspaceId: input.membership.workspaceId,
    externalOrganizationId: externalTarget.externalOrganizationId,
    externalOrganizationMembershipId:
      externalTarget.externalOrganizationMembershipId,
    userId: input.membership.userId,
    role: input.role,
  });

  return null;
}

async function syncExternalMemberRemoval(
  membership: WorkspaceMembershipDocument,
): Promise<NextResponse | null> {
  const externalTarget = await resolveExternalMembershipTarget(membership);
  if (!externalTarget) return null;

  const provider = loadWorkspaceInvitationProvider();
  const capability = provider.getCapability();

  if (!capability.supported) {
    return NextResponse.json(
      {
        error: "workspace_membership_provider_unavailable",
        reason: capability.reason,
      },
      { status: 400 },
    );
  }

  await provider.removeWorkspaceMember({
    workspaceId: membership.workspaceId,
    externalOrganizationId: externalTarget.externalOrganizationId,
    externalOrganizationMembershipId:
      externalTarget.externalOrganizationMembershipId,
    userId: membership.userId,
  });

  return null;
}

export async function PATCH(
  request: Request,
  context: WorkspaceMemberRouteContext,
) {
  const { workspaceId, userId: rawUserId } = await context.params;
  const userId = normalizeObjectId(rawUserId);

  if (!userId) {
    return NextResponse.json({ error: "member_not_found" }, { status: 404 });
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

  if (!hasWorkspacePermission(workspaceContext.membership, "members:manage")) {
    return NextResponse.json(
      { error: "workspace_members_forbidden" },
      { status: 403 },
    );
  }

  if (userId === workspaceContext.user._id) {
    return NextResponse.json(
      { error: "cannot_change_own_role" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    role?: unknown;
  } | null;
  const role = body?.role;

  if (!isWorkspaceRole(role)) {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }

  const targetMembership = await findMembership({
    workspaceId: workspaceContext.workspaceId,
    userId,
  });

  if (!targetMembership) {
    return NextResponse.json({ error: "member_not_found" }, { status: 404 });
  }

  if (
    (targetMembership.role === "owner" || role === "owner") &&
    !hasWorkspacePermission(workspaceContext.membership, "members:manage-owner")
  ) {
    return NextResponse.json(
      { error: "workspace_owner_management_forbidden" },
      { status: 403 },
    );
  }

  if (targetMembership.role === "owner" && role !== "owner") {
    const hasAnotherOwner = await ensureWorkspaceHasAnotherOwner({
      workspaceId: workspaceContext.workspaceId,
      excludedUserId: userId,
    });

    if (!hasAnotherOwner) {
      return NextResponse.json(
        { error: "workspace_must_have_owner" },
        { status: 400 },
      );
    }
  }

  const externalSyncError = await syncExternalRoleUpdate({
    membership: targetMembership,
    role,
  });
  if (externalSyncError) return externalSyncError;

  const updatedMembership = await updateWorkspaceMemberRole({
    workspaceId: workspaceContext.workspaceId,
    userId,
    role,
  });

  if (!updatedMembership) {
    return NextResponse.json({ error: "member_not_found" }, { status: 404 });
  }

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "member.role_changed",
    category: "members",
    severity: "notice",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: { type: "member", id: userId },
    action: "role_changed",
    summary: `Changed member role from ${targetMembership.role} to ${role}.`,
    metadata: {
      targetUserId: userId,
      fromRole: targetMembership.role,
      toRole: role,
      externalProvider: targetMembership.externalProvider ?? null,
    },
    changes: { changedFields: ["role"] },
  });

  return NextResponse.json({
    ok: true,
    member: {
      userId: updatedMembership.userId,
      role: updatedMembership.role,
      updatedAt:
        updatedMembership.updatedAt?.toISOString() ??
        updatedMembership.createdAt.toISOString(),
    },
  });
}

export async function DELETE(
  request: Request,
  context: WorkspaceMemberRouteContext,
) {
  const { workspaceId, userId: rawUserId } = await context.params;
  const userId = normalizeObjectId(rawUserId);

  if (!userId) {
    return NextResponse.json({ error: "member_not_found" }, { status: 404 });
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

  if (!hasWorkspacePermission(workspaceContext.membership, "members:manage")) {
    return NextResponse.json(
      { error: "workspace_members_forbidden" },
      { status: 403 },
    );
  }

  if (userId === workspaceContext.user._id) {
    return NextResponse.json(
      { error: "cannot_remove_self" },
      { status: 400 },
    );
  }

  const targetMembership = await findMembership({
    workspaceId: workspaceContext.workspaceId,
    userId,
  });

  if (!targetMembership) {
    return NextResponse.json({ error: "member_not_found" }, { status: 404 });
  }

  if (
    targetMembership.role === "owner" &&
    !hasWorkspacePermission(workspaceContext.membership, "members:manage-owner")
  ) {
    return NextResponse.json(
      { error: "workspace_owner_management_forbidden" },
      { status: 403 },
    );
  }

  if (targetMembership.role === "owner") {
    const hasAnotherOwner = await ensureWorkspaceHasAnotherOwner({
      workspaceId: workspaceContext.workspaceId,
      excludedUserId: userId,
    });

    if (!hasAnotherOwner) {
      return NextResponse.json(
        { error: "workspace_must_have_owner" },
        { status: 400 },
      );
    }
  }

  const externalSyncError = await syncExternalMemberRemoval(targetMembership);
  if (externalSyncError) return externalSyncError;

  await removeWorkspaceMember({
    workspaceId: workspaceContext.workspaceId,
    userId,
  });

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "member.removed",
    category: "members",
    severity: "warning",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: { type: "member", id: userId },
    action: "removed",
    summary: `Removed member ${userId} from the workspace.`,
    metadata: {
      targetUserId: userId,
      previousRole: targetMembership.role,
      externalProvider: targetMembership.externalProvider ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
