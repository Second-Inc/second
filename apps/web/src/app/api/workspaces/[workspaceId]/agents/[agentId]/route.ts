import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  isWorkspaceAdminRole,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  deleteWorkspaceAgent,
  findWorkspaceAgentBySlugForViewer,
  findWorkspaceAgentForViewer,
  resolveRuntimeSkillsForViewer,
  updateWorkspaceAgent,
} from "@/lib/db";
import {
  createWorkspaceResourceViewer,
  normalizeString,
  normalizeStringList,
  normalizeVisibility,
  serializeWorkspaceAgent,
  validateWorkspaceResourceTeamScope,
} from "@/lib/workspace-resources";
import type {
  WorkspaceAgentApprovalStatus,
  WorkspaceAgentStatus,
} from "@/lib/db/types";

type AgentDetailRouteContext = {
  params: Promise<{ workspaceId: string; agentId: string }>;
};

async function findRouteAgentForViewer(input: {
  workspaceId: string;
  agentId: string;
  viewer: Awaited<ReturnType<typeof createWorkspaceResourceViewer>>;
}) {
  return (
    (await findWorkspaceAgentBySlugForViewer({
      workspaceId: input.workspaceId,
      slug: input.agentId,
      viewer: input.viewer,
    })) ??
    (await findWorkspaceAgentForViewer({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      viewer: input.viewer,
    }))
  );
}

function parseStatus(value: unknown): WorkspaceAgentStatus | undefined {
  return value === "published" || value === "draft" || value === "archived"
    ? value
    : undefined;
}

function parseApprovalStatus(
  value: unknown,
): WorkspaceAgentApprovalStatus | undefined {
  return value === "approved" ||
    value === "stale" ||
    value === "pending" ||
    value === "none"
    ? value
    : undefined;
}

export async function GET(request: Request, context: AgentDetailRouteContext) {
  const { workspaceId, agentId } = await context.params;
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

  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const agent = await findRouteAgentForViewer({
    workspaceId: workspaceContext.workspaceId,
    agentId,
    viewer,
  });
  if (!agent) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  return NextResponse.json(serializeWorkspaceAgent(agent));
}

export async function PATCH(
  request: Request,
  context: AgentDetailRouteContext,
) {
  const { workspaceId, agentId } = await context.params;
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

  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const existing = await findRouteAgentForViewer({
    workspaceId: workspaceContext.workspaceId,
    agentId,
    viewer,
  });
  if (!existing) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  const canManage =
    isWorkspaceAdminRole(workspaceContext.membership.role) ||
    existing.createdByUserId === workspaceContext.user._id;
  if (!canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const selectedToolIds = Array.isArray(body?.selectedToolIds)
    ? normalizeStringList(body.selectedToolIds, 50, 80)
    : undefined;
  if (selectedToolIds && selectedToolIds.length > 0) {
    return NextResponse.json(
      { error: "workspace_tools_out_of_scope" },
      { status: 400 },
    );
  }

  const requestedTeamIds = Array.isArray(body?.teamIds)
    ? normalizeStringList(body.teamIds, 50, 80)
    : undefined;
  const requestedVisibility =
    body?.visibility === "workspace" || body?.visibility === "teams"
      ? normalizeVisibility(body.visibility)
      : requestedTeamIds
        ? requestedTeamIds.length > 0
          ? "teams"
          : "workspace"
        : undefined;

  let scoped:
    | {
        visibility?: typeof existing.visibility;
        teamIds?: string[];
      }
    | null = {};
  if (requestedVisibility || requestedTeamIds) {
    const scope = await validateWorkspaceResourceTeamScope({
      workspaceContext,
      visibility: requestedVisibility ?? existing.visibility,
      teamIds: requestedTeamIds ?? existing.teamIds,
    });
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    scoped = {
      visibility: scope.visibility,
      teamIds: scope.teamIds,
    };
  }

  const selectedSkillIds = Array.isArray(body?.selectedSkillIds)
    ? normalizeStringList(body.selectedSkillIds, 50, 80)
    : undefined;
  let validatedSkillIds: string[] | undefined;
  if (selectedSkillIds) {
    const selectedSkills = await resolveRuntimeSkillsForViewer({
      workspaceId: workspaceContext.workspaceId,
      skillIds: selectedSkillIds,
      viewer,
      requirePublished: true,
    });
    if (!selectedSkills) {
      return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
    }
    validatedSkillIds = selectedSkills.map((skill) => skill.skillId);
  }

  const displayName =
    typeof body?.displayName === "string"
      ? normalizeString(body.displayName, 80)
      : undefined;
  const systemPrompt =
    typeof body?.systemPrompt === "string"
      ? normalizeString(body.systemPrompt, 50_000)
      : undefined;
  if (displayName === "" || systemPrompt === "") {
    return NextResponse.json({ error: "invalid_agent" }, { status: 400 });
  }

  const updated = await updateWorkspaceAgent({
    workspaceId: workspaceContext.workspaceId,
    agentId: existing._id,
    avatarGradientSeed:
      typeof body?.avatarGradientSeed === "string"
        ? normalizeString(body.avatarGradientSeed, 80)
        : undefined,
    displayName,
    description:
      typeof body?.description === "string"
        ? normalizeString(body.description, 240)
        : undefined,
    systemPrompt,
    visibility: scoped?.visibility,
    teamIds: scoped?.teamIds,
    selectedSkillIds: validatedSkillIds,
    selectedToolIds: selectedToolIds ? [] : undefined,
    builtinTools: Array.isArray(body?.builtinTools)
      ? normalizeStringList(body.builtinTools, 8, 80)
      : undefined,
    status: parseStatus(body?.status),
    approvalStatus: isWorkspaceAdminRole(workspaceContext.membership.role)
      ? parseApprovalStatus(body?.approvalStatus)
      : undefined,
  });

  if (!updated) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  return NextResponse.json(serializeWorkspaceAgent(updated));
}

export async function DELETE(
  request: Request,
  context: AgentDetailRouteContext,
) {
  const { workspaceId, agentId } = await context.params;
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

  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const existing = await findRouteAgentForViewer({
    workspaceId: workspaceContext.workspaceId,
    agentId,
    viewer,
  });
  if (!existing) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  const canManage =
    isWorkspaceAdminRole(workspaceContext.membership.role) ||
    existing.createdByUserId === workspaceContext.user._id;
  if (!canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deleted = await deleteWorkspaceAgent({
    workspaceId: workspaceContext.workspaceId,
    agentId: existing._id,
  });
  if (!deleted) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
