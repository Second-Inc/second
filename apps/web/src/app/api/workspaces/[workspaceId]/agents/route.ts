import { NextResponse } from "next/server";
import {
  guardErrorToApiResponse,
  isRequestGuardError,
  requireWorkspaceContext,
} from "@/lib/auth";
import {
  createWorkspaceAgent,
  listWorkspaceAgentsForViewer,
  resolveRuntimeSkillsForViewer,
} from "@/lib/db";
import {
  createWorkspaceResourceViewer,
  normalizeString,
  normalizeStringList,
  normalizeVisibility,
  serializeWorkspaceAgent,
  validateWorkspaceResourceTeamScope,
} from "@/lib/workspace-resources";
import type { WorkspaceAgentStatus } from "@/lib/db/types";

type AgentsRouteContext = {
  params: Promise<{ workspaceId: string }>;
};

function parseAgentStatus(value: string | null): WorkspaceAgentStatus | undefined {
  if (value === "published" || value === "draft" || value === "archived") {
    return value;
  }
  return undefined;
}

export async function GET(request: Request, context: AgentsRouteContext) {
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

  const url = new URL(request.url);
  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const agents = await listWorkspaceAgentsForViewer({
    workspaceId: workspaceContext.workspaceId,
    viewer,
    query: url.searchParams.get("query") ?? undefined,
    status: parseAgentStatus(url.searchParams.get("status")),
  });

  return NextResponse.json({
    items: agents.map((agent) => ({
      ...serializeWorkspaceAgent(agent),
      systemPrompt: "",
    })),
  });
}

export async function POST(request: Request, context: AgentsRouteContext) {
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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const displayName = normalizeString(body?.displayName, 80);
  const description = normalizeString(body?.description, 240);
  const systemPrompt = normalizeString(body?.systemPrompt, 50_000);
  const teamIds = normalizeStringList(body?.teamIds, 50, 80);
  const visibility = normalizeVisibility(body?.visibility);
  const selectedSkillIds = normalizeStringList(body?.selectedSkillIds, 50, 80);
  const selectedToolIds = normalizeStringList(body?.selectedToolIds, 50, 80);
  const builtinTools = normalizeStringList(body?.builtinTools, 8, 80);
  const model = normalizeString(body?.model, 120) || "workspace-default";
  const slug = normalizeString(body?.slug, 80);
  const avatarGradientSeed = normalizeString(body?.avatarGradientSeed, 80);

  if (!displayName || !systemPrompt) {
    return NextResponse.json({ error: "invalid_agent" }, { status: 400 });
  }
  if (selectedToolIds.length > 0) {
    return NextResponse.json(
      { error: "workspace_tools_out_of_scope" },
      { status: 400 },
    );
  }

  const scope = await validateWorkspaceResourceTeamScope({
    workspaceContext,
    visibility,
    teamIds,
  });
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const viewer = await createWorkspaceResourceViewer(workspaceContext);
  const selectedSkills = await resolveRuntimeSkillsForViewer({
    workspaceId: workspaceContext.workspaceId,
    skillIds: selectedSkillIds,
    viewer,
    requirePublished: true,
  });
  if (!selectedSkills) {
    return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
  }

  const agent = await createWorkspaceAgent({
    workspaceId: workspaceContext.workspaceId,
    displayName,
    slug,
    avatarGradientSeed,
    description,
    systemPrompt,
    visibility: scope.visibility,
    teamIds: scope.teamIds,
    selectedSkillIds: selectedSkills.map((skill) => skill.skillId),
    selectedToolIds: [],
    builtinTools,
    model,
    createdByUserId: workspaceContext.user._id,
    createdByName: workspaceContext.user.displayName,
  });

  return NextResponse.json(serializeWorkspaceAgent(agent), { status: 201 });
}
