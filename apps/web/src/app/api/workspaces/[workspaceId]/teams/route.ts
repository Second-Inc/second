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
  createWorkspaceTeam,
  listWorkspaceTeams,
} from "@/lib/db";
import { createPerfTrace, perfResponseHeaders } from "@/lib/perf/trace";
import {
  dedupeWorkspaceSettingsRequest,
  workspaceSettingsDedupeKey,
} from "@/lib/workspace-settings/request-dedupe";
import { loadTeamsSettingsReadModel } from "@/lib/workspace-settings/read-models";

type TeamsRouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

function serializeTeam(team: Awaited<ReturnType<typeof listWorkspaceTeams>>[number]) {
  return {
    id: team._id,
    name: team.name,
    slug: team.slug,
    isDefault: team.isDefault,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}

export async function GET(request: Request, context: TeamsRouteContext) {
  const { workspaceId } = await context.params;
  const trace = createPerfTrace({
    route: "GET /api/workspaces/[workspaceId]/teams",
    workspaceId,
  });
  trace.log("settings.teams.request_start");

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

  const data = await trace.time("settings.teams.read_model", () =>
    dedupeWorkspaceSettingsRequest(
      workspaceSettingsDedupeKey("teams", workspaceContext),
      750,
      () => loadTeamsSettingsReadModel(workspaceContext, { trace }),
    ),
  );
  trace.log("settings.teams.response", {
    teams: data.teams.length,
    members: data.members.length,
    hasDefaultTeam: Boolean(data.defaultTeam),
    totalElapsedMs: trace.elapsedMs(),
  });
  return NextResponse.json(data, { headers: perfResponseHeaders(trace) });
}

export async function POST(request: Request, context: TeamsRouteContext) {
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

  if (!hasWorkspacePermission(workspaceContext.membership, "members:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { name?: string }
    | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name || name.length > 80) {
    return NextResponse.json({ error: "invalid_team_name" }, { status: 400 });
  }

  try {
    const team = await createWorkspaceTeam({
      workspaceId: workspaceContext.workspaceId,
      name,
      createdByUserId: workspaceContext.user._id,
    });
    await recordAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      eventName: "team.created",
      category: "teams",
      severity: "info",
      outcome: "success",
      actor: auditActorFromWorkspaceContext(workspaceContext),
      source: auditSourceFromRequest(request),
      target: { type: "team", id: team._id, name: team.name },
      action: "created",
      summary: `Created team ${team.name}.`,
      metadata: {
        slug: team.slug,
        isDefault: team.isDefault,
      },
    });
    return NextResponse.json({ team: serializeTeam(team) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "team_name_unavailable" }, { status: 409 });
  }
}
