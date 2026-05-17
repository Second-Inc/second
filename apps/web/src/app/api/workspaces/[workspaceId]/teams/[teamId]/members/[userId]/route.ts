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
  addUserToWorkspaceTeam,
  findMembership,
  findWorkspaceTeamById,
  removeUserFromWorkspaceTeam,
} from "@/lib/db";

type TeamMemberRouteContext = {
  params: Promise<{
    workspaceId: string;
    teamId: string;
    userId: string;
  }>;
};

async function resolveContext(request: Request, context: TeamMemberRouteContext) {
  const { workspaceId, teamId: rawTeamId, userId } = await context.params;
  const teamId = normalizeObjectId(rawTeamId);
  if (!teamId) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }

  let workspaceContext: Awaited<ReturnType<typeof requireWorkspaceContext>>;
  try {
    workspaceContext = await requireWorkspaceContext({
      headers: request.headers,
      pathname: new URL(request.url).pathname,
      workspaceId,
    });
  } catch (error) {
    if (isRequestGuardError(error)) {
      return { error: guardErrorToApiResponse(error) };
    }
    throw error;
  }

  if (!hasWorkspacePermission(workspaceContext.membership, "members:manage")) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  const [team, membership] = await Promise.all([
    findWorkspaceTeamById({
      workspaceId: workspaceContext.workspaceId,
      teamId,
    }),
    findMembership({
      workspaceId: workspaceContext.workspaceId,
      userId,
    }),
  ]);

  if (!team || !membership) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }

  return { workspaceContext, teamId, userId };
}

export async function PUT(request: Request, context: TeamMemberRouteContext) {
  const resolved = await resolveContext(request, context);
  if ("error" in resolved) return resolved.error;

  await addUserToWorkspaceTeam({
    workspaceId: resolved.workspaceContext.workspaceId,
    teamId: resolved.teamId,
    userId: resolved.userId,
  });

  await recordAuditEvent({
    workspaceId: resolved.workspaceContext.workspaceId,
    eventName: "member.team_added",
    category: "members",
    severity: "info",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(resolved.workspaceContext),
    source: auditSourceFromRequest(request),
    target: { type: "member", id: resolved.userId },
    action: "team_added",
    summary: `Added member ${resolved.userId} to team ${resolved.teamId}.`,
    metadata: {
      teamId: resolved.teamId,
      userId: resolved.userId,
    },
    changes: { changedFields: ["teamIds"] },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: TeamMemberRouteContext) {
  const resolved = await resolveContext(request, context);
  if ("error" in resolved) return resolved.error;

  const removed = await removeUserFromWorkspaceTeam({
    workspaceId: resolved.workspaceContext.workspaceId,
    teamId: resolved.teamId,
    userId: resolved.userId,
  });

  if (!removed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await recordAuditEvent({
    workspaceId: resolved.workspaceContext.workspaceId,
    eventName: "member.team_removed",
    category: "members",
    severity: "info",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(resolved.workspaceContext),
    source: auditSourceFromRequest(request),
    target: { type: "member", id: resolved.userId },
    action: "team_removed",
    summary: `Removed member ${resolved.userId} from team ${resolved.teamId}.`,
    metadata: {
      teamId: resolved.teamId,
      userId: resolved.userId,
    },
    changes: { changedFields: ["teamIds"] },
  });

  return NextResponse.json({ ok: true });
}
