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
  deleteWorkspaceTeam,
  findWorkspaceTeamById,
  updateWorkspaceTeamName,
} from "@/lib/db";

type TeamRouteContext = {
  params: Promise<{
    workspaceId: string;
    teamId: string;
  }>;
};

export async function PATCH(request: Request, context: TeamRouteContext) {
  const { workspaceId, teamId: rawTeamId } = await context.params;
  const teamId = normalizeObjectId(rawTeamId);
  if (!teamId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
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
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const existing = await findWorkspaceTeamById({
    workspaceId: workspaceContext.workspaceId,
    teamId,
  });
  if (!existing || existing.isDefault) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { name?: string }
    | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    return NextResponse.json({ error: "invalid_team_name" }, { status: 400 });
  }

  const team = await updateWorkspaceTeamName({
    workspaceId: workspaceContext.workspaceId,
    teamId,
    name,
  });

  if (!team) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "team.renamed",
    category: "teams",
    severity: "info",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: { type: "team", id: teamId, name: team.name },
    action: "renamed",
    summary: `Renamed team from ${existing.name} to ${team.name}.`,
    metadata: {
      previousName: existing.name,
      newName: team.name,
      slug: team.slug,
    },
    changes: { changedFields: ["name", "slug"] },
  });

  return NextResponse.json({
    team: {
      id: team._id,
      name: team.name,
      slug: team.slug,
      isDefault: team.isDefault,
    },
  });
}

export async function DELETE(request: Request, context: TeamRouteContext) {
  const { workspaceId, teamId: rawTeamId } = await context.params;
  const teamId = normalizeObjectId(rawTeamId);
  if (!teamId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
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
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deleted = await deleteWorkspaceTeam({
    workspaceId: workspaceContext.workspaceId,
    teamId,
  });

  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await recordAuditEvent({
    workspaceId: workspaceContext.workspaceId,
    eventName: "team.deleted",
    category: "teams",
    severity: "warning",
    outcome: "success",
    actor: auditActorFromWorkspaceContext(workspaceContext),
    source: auditSourceFromRequest(request),
    target: { type: "team", id: teamId },
    action: "deleted",
    summary: `Deleted team ${teamId}.`,
    metadata: { teamId },
  });

  return NextResponse.json({ ok: true });
}
