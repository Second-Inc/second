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
import {
  listWorkspaceMemberProfiles,
  updateAppCollaboratorUserIds,
} from "@/lib/db";
import type { WorkspaceRole } from "@/lib/db/types";

type CollaboratorsRouteContext = {
  params: Promise<{
    workspaceId: string;
    appId: string;
  }>;
};

function uniqueStringIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

type WorkspaceMemberProfile = Awaited<
  ReturnType<typeof listWorkspaceMemberProfiles>
>[number];

function serializeMember(member: WorkspaceMemberProfile): {
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
} {
  return {
    userId: member.membership.userId,
    displayName:
      member.user?.displayName ??
      member.user?.email ??
      member.membership.userId,
    email: member.user?.email ?? "",
    role: member.membership.role,
  };
}

export async function GET(
  request: Request,
  context: CollaboratorsRouteContext,
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
  if (!access.canManageCollaborators) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const members = await listWorkspaceMemberProfiles(workspaceContext.workspaceId);

  return NextResponse.json(
    {
      members: members.map(serializeMember),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  context: CollaboratorsRouteContext,
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
  if (!access.canManageCollaborators) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { collaboratorUserIds?: unknown }
    | null;
  const requestedIds = uniqueStringIds(body?.collaboratorUserIds);
  const requestedIdSet = new Set(requestedIds);

  const members = await listWorkspaceMemberProfiles(workspaceContext.workspaceId);
  const validCollaboratorIds = members
    .filter((member) => {
      if (member.membership.userId === access.app.createdByUserId) return false;
      return requestedIdSet.has(member.membership.userId);
    })
    .map((member) => member.membership.userId);

  await updateAppCollaboratorUserIds({
    workspaceId: workspaceContext.workspaceId,
    appId,
    collaboratorUserIds: validCollaboratorIds,
  });

  const previousCollaboratorIds = access.app.collaboratorUserIds ?? [];
  const previousSet = new Set(previousCollaboratorIds);
  const nextSet = new Set(validCollaboratorIds);
  const added = validCollaboratorIds.filter((id) => !previousSet.has(id));
  const removed = previousCollaboratorIds.filter((id) => !nextSet.has(id));
  const eventName =
    added.length > 0 && removed.length === 0
      ? "app.collaborator_added"
      : removed.length > 0 && added.length === 0
        ? "app.collaborator_removed"
        : "app.collaborators_changed";

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName,
    category: "apps",
    severity: "info",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request, {
      appId,
      appName: access.app.name,
    }),
    target: { type: "app", id: appId, name: access.app.name },
    action: "collaborators_changed",
    summary: `Updated collaborators for ${access.app.name}.`,
    metadata: {
      addedUserIds: added,
      removedUserIds: removed,
      collaboratorCount: validCollaboratorIds.length,
    },
    changes: { changedFields: ["collaboratorUserIds"] },
    relatedIds: { appId },
  });

  return NextResponse.json({
    collaboratorUserIds: validCollaboratorIds,
  });
}
